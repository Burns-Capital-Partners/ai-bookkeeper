import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BookkeeperState } from "./db.js";
import type { ZohoBooksClient } from "./zoho.js";
import type { CloseReport, CompanyConfig } from "./types.js";
import { categorizeTransactions, type CategorizeResult } from "./categorizer.js";
import { runMonthlyClose } from "./closer.js";
import { closeInputsFromEvidence, exportPending, importInbox, validateMonthlyEvidence, type HandoffResult } from "./handoff.js";
import { buildCloseNotification, buildFlagNotification, pendingEscalations, type NotificationPayload } from "./notifier.js";
import { prepareExpiredReviews, reconcileReviewPostings, verifyReviewResolutions } from "./reviews.js";
import { reviewExceptions, type ReviewerOptions } from "./reviewer.js";
import { importSharedInbox, publishShared, type SharedOptions } from "./shared.js";
import { auditSourceLedgers } from "./audit.js";
import { repairMetadata } from "./repairs.js";

export interface RunSummary {
  startedAt: string;
  finishedAt?: string;
  status: "running" | "complete" | "error";
  error?: string;
  imported?: HandoffResult;
  categorization?: CategorizeResult;
  closePeriods: string[];
}
interface SavedNotice { signature: string; revision: number; payload: NotificationPayload }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function currentPeriod(config: CompanyConfig, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: config.company.timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}
function previousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return month === 1 ? `${year! - 1}-12` : `${year}-${String(month! - 1).padStart(2, "0")}`;
}
function saveCloseNotice(config: CompanyConfig, state: BookkeeperState, report: CloseReport): void {
  const period = `${report.periodYear}-${String(report.periodMonth).padStart(2, "0")}`;
  const key = `close-notice:${period}`;
  // Delivery timestamps and repeated-run timestamps are not a change in the books.
  const signature = hash([report.complete, report.rentOutstanding, report.steps,
    report.flagsRaised.map(f => [f.id, f.title, f.detail, f.amount])]);
  const old = state.getRuntime<SavedNotice>(key);
  if (old?.signature === signature) return;
  const revision = (old?.revision ?? 0) + 1;
  state.setRuntime(key, { signature, revision, payload: buildCloseNotification(config, report, state, `${period}:${revision}`) });
}

export function pendingNotifications(config: CompanyConfig, state: BookkeeperState): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];
  // Includes incomplete months without a statement packet.
  for (const period of state.getRuntime<string[]>("close-notice-periods") ?? []) {
    const saved = state.getRuntime<SavedNotice>(`close-notice:${period}`);
    if (saved?.payload.deliveryId && !state.isDeliveryConfirmed(saved.payload.deliveryId)) payloads.push(saved.payload);
  }
  const included = new Set(payloads.flatMap(p => p.flagIds));
  const initial = buildFlagNotification(config, state.getOpenFlags(config.company.name).filter(f => !included.has(f.id)), state);
  if (initial) payloads.push(initial);
  payloads.push(...pendingEscalations(config, state));
  return payloads;
}

/** Caller holds the single-process lock. Always publishes the outcome for Muse. */
export async function runDaily(config: CompanyConfig, zoho: ZohoBooksClient, state: BookkeeperState, directory: string,
  options: { reviewer?: ReviewerOptions; shared?: SharedOptions; repairMetadata?: boolean; now?: Date } = {}): Promise<RunSummary> {
  const run: RunSummary = { startedAt: new Date().toISOString(), status: "running", closePeriods: [] };
  state.setRuntime("last-run", run);
  exportPending(config, state, join(directory, "pending.json"), { lastRun: run, notifications: pendingNotifications(config, state) });
  try {
    if (options.shared) {
      try { importSharedInbox(options.shared, directory); state.resolveIssue(config.company.name, "shared:import"); }
      catch (error) { storageIssue("import", error); }
    }
    run.imported = importInbox(config, state, join(directory, "inbox"));
    const failures = run.imported.errors.map(e => `inbox:${e.file}`);
    for (const key of state.getRuntime<string[]>("inbox-errors") ?? []) if (!failures.includes(key)) state.resolveIssue(config.company.name, key);
    for (const error of run.imported.errors) state.saveFlag({ id: randomUUID(), createdAt: new Date().toISOString(), companyName: config.company.name,
      type: "worker-error", severity: "warning", status: "open", escalationLevel: 0, key: `inbox:${error.file}`,
      title: "Muse handoff needs correction", detail: `${error.file}: ${error.error}` });
    state.setRuntime("inbox-errors", failures);
    await verifyReviewResolutions(config, state, zoho);
    const waitingReviews = await prepareExpiredReviews(config, state, zoho, options.now);
    state.setRuntime("review-source-rechecks-waiting", waitingReviews);
    run.categorization = await categorizeTransactions(config, zoho, state);
    reconcileReviewPostings(config, state, options.now);
    if (options.repairMetadata) await repairMetadata(config, state, zoho);
    const sourceAuditResults = await auditSourceLedgers(config, state, zoho);
    const current = currentPeriod(config), previous = previousPeriod(current);
    const periods = new Set([previous]);
    for (const period of state.getMonthlyEvidencePeriods(config.company.name)) {
      if (period >= current) continue;
      const packet = validateMonthlyEvidence(state.getMonthlyEvidence(config.company.name, period), config);
      // Revisit older months when Muse supplies or corrects evidence. The previous
      // month is checked on every daily run, including after a long Mac sleep.
      const [year, month] = period.split("-").map(Number);
      const previousClose = state.getCloseRun(config.company.name, year!, month!);
      if (state.getRuntime<string>(`closed-evidence:${period}`) !== hash(packet) ||
        (!previousClose?.complete && (run.imported.accepted.length > 0 || run.categorization.journalsCreated.length > 0 || run.categorization.transfersCreated.length > 0))) periods.add(period);
    }
    state.resolveIssue(config.company.name, "worker:run");
    const closeErrors: string[] = [];
    for (const period of [...periods].sort()) {
      try {
      const raw = state.getMonthlyEvidence(config.company.name, period);
      const [year, month] = period.split("-").map(Number);
      const report = await runMonthlyClose(config, zoho, state, { ...(raw ? closeInputsFromEvidence(validateMonthlyEvidence(raw, config)) :
        { year: year!, month: month!, asOfDay: 31, statementBalances: {}, rentReceived: {} }), requireSourceAudit: true, sourceAuditResults });
      saveCloseNotice(config, state, report);
      const noticePeriods = new Set(state.getRuntime<string[]>("close-notice-periods") ?? []); noticePeriods.add(period);
      state.setRuntime("close-notice-periods", [...noticePeriods].sort());
      if (raw) state.setRuntime(`closed-evidence:${period}`, hash(raw));
      run.closePeriods.push(period);
      state.resolveIssue(config.company.name, `worker:close:${period}`);
      } catch {
        closeErrors.push(period);
        state.saveFlag({ id: randomUUID(), createdAt: new Date().toISOString(), companyName: config.company.name,
          type: "worker-error", severity: "warning", status: "open", escalationLevel: 0, period, key: `worker:close:${period}`,
          title: `Month-end check ${period} needs another run`, detail: "The close could not be verified. Other periods and routine AI review continue; no completion was claimed." });
      }
    }
    if (options.reviewer) await reviewExceptions(config, state, options.reviewer);
    run.status = run.imported.errors.length || closeErrors.length ? "error" : "complete";
    if (run.status === "error") run.error = [run.imported.errors.length ? "One or more Muse handoff files were rejected." : "",
      closeErrors.length ? `Month-end checks failed: ${closeErrors.join(", ")}.` : "", "Other work continued."].filter(Boolean).join(" ");
  } catch (error) {
    run.status = "error";
    run.error = error instanceof Error ? error.message : "Bookkeeper run failed.";
    state.saveFlag({ id: randomUUID(), createdAt: new Date().toISOString(), companyName: config.company.name,
      type: "worker-error", severity: "blocking", status: "open", escalationLevel: 0, key: "worker:run",
      title: "Daily bookkeeping run failed", detail: run.error });
  } finally {
    run.finishedAt = new Date().toISOString();
    state.setRuntime("last-run", run);
    if (options.shared) {
      try {
        publishShared(config, state, options.shared, { lastRun: run, notifications: pendingNotifications(config, state) }, options.now);
        state.resolveIssue(config.company.name, "shared:publish");
      } catch (error) { storageIssue("publish", error); }
    }
    exportPending(config, state, join(directory, "pending.json"), { lastRun: run, notifications: pendingNotifications(config, state) });
  }
  return run;
  function storageIssue(stage: string, error: unknown) {
    state.saveFlag({ id: randomUUID(), createdAt: new Date().toISOString(), companyName: config.company.name,
      type: "worker-error", severity: "info", status: "open", escalationLevel: 0, key: `shared:${stage}`,
      title: "Shared accounting storage needs attention", detail: error instanceof Error ? error.message : "Drive handoff failed; local accepted state was preserved." });
  }
}
