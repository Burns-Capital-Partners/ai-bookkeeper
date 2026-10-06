/**
 * Notifier: turns flags and close reports into structured output for delivery.
 *
 * This module does NOT send notifications itself. It produces a
 * NotificationPayload that the parent agent (Muse) delivers: first as a
 * chat notification, then escalating to email, then to text per the
 * company config's escalation policy.
 *
 * Escalation timing is tracked in state (lastNotifiedAt, escalationLevel).
 * The scheduler calls `pendingEscalations()` to find flags whose current
 * level has gone unanswered and bumps them to the next channel.
 */

import type {
  CloseReport,
  CompanyConfig,
  EscalationStep,
  Flag,
} from "./types.js";
import type { BookkeeperState } from "./db.js";
import { createHash } from "node:crypto";

export interface NotificationPayload {
  deliveryId?: string;
  companyName: string;
  generatedAt: string;
  channel: EscalationStep["channel"];
  to?: string;
  subject: string;
  body: string;
  flagIds: string[];
  closeReport?: CloseReportSummary;
}

export interface CloseReportSummary {
  period: string;
  complete: boolean;
  stepsComplete: number;
  stepsTotal: number;
  flagsRaised: number;
}

/** First escalation step; throws on malformed config. */
function firstStep(config: CompanyConfig): EscalationStep {
  const step = config.escalation.steps[0];
  if (!step) throw new Error(`No escalation steps configured for ${config.company.name}`);
  return step;
}
export function buildFlagNotification(
  config: CompanyConfig,
  flags: Flag[],
  state?: BookkeeperState
): NotificationPayload | undefined {
  if (flags.length === 0) return undefined;
  const step = firstStep(config);
  flags = flags.filter(f => f.status === "open" && !f.lastNotifiedAt);
  if (!flags.length) return undefined;
  const now = new Date().toISOString();
  const lines = flags.map(
    (f) =>
      `- [${f.severity.toUpperCase()}] ${f.title}\n  ${f.detail}` +
      (f.amount !== undefined ? ` (${fmt(f.amount)})` : "")
  );
  return queued({
    companyName: config.company.name,
    generatedAt: now,
    channel: step.channel,
    to: step.to,
    subject: `Bookkeeper: ${flags.length} item(s) need your review (${config.company.name})`,
    body:
      `The bookkeeper flagged ${flags.length} item(s) for ${config.company.name}:\n\n` +
      lines.join("\n\n") +
      `\n\nReply in chat with your decision on each, or they will escalate ` +
      `per your escalation policy.`,
    flagIds: flags.map((f) => f.id),
  }, state, 0, flags);
}

/** Build the notification for a completed monthly close. */
export function buildCloseNotification(
  config: CompanyConfig,
  report: CloseReport,
  state?: BookkeeperState,
  revision?: string
): NotificationPayload {
  const step = firstStep(config);
  const period = `${report.periodYear}-${String(report.periodMonth).padStart(2, "0")}`;
  const done = report.steps.filter((s) => s.status === "complete").length;
  const stepLines = report.steps.map(
    (s) => `${s.status === "complete" ? "✓" : "✗"} ${s.description}` + (s.detail ? `\n  ${s.detail}` : "")
  );
  return queued({
    companyName: config.company.name,
    generatedAt: new Date().toISOString(),
    channel: step.channel,
    to: step.to,
    subject:
      `Month-end close ${report.complete ? "complete" : "needs attention"}: ` +
      `${period} (${config.company.name})${report.rentOutstanding ? " — rent outstanding" : ""}`,
    body:
      `Close checklist for ${period}:\n\n` +
      stepLines.join("\n\n") +
      `\n\n${done}/${report.steps.length} steps complete.` +
      (report.complete
        ? (report.rentOutstanding
          ? "\n\nBookkeeping is complete for the month. Unpaid rent remains open and tracked separately."
          : "\n\nThe books are closed for the month.")
        : "\n\nSome steps need your attention before the month is closed."),
    flagIds: report.flagsRaised.map((f) => f.id),
    closeReport: {
      period,
      complete: report.complete,
      stepsComplete: done,
      stepsTotal: report.steps.length,
      flagsRaised: report.flagsRaised.length,
    },
  }, state, 0, report.flagsRaised, revision);
}

/**
 * Find open flags whose current escalation level has gone unanswered and
 * advance them to the next channel. Returns payloads grouped by channel.
 *
 * `unansweredAfterMs`: how long a notification may go unanswered before
 * escalating (default 24h for notification->email, 48h for email->text).
 * Configured per step via `escalateAfterMs` when present.
 */
export function pendingEscalations(
  config: CompanyConfig,
  state: BookkeeperState,
  now: Date = new Date(),
  unansweredAfterMs: number = 24 * 60 * 60 * 1000
): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];
  const open = state.getOpenFlags(config.company.name);
  const steps = config.escalation.steps;

  const byLevel = new Map<number, Flag[]>();
  for (const flag of open) {
    if (flag.status !== "open") continue;
    // Escalation is computed from the last notification time. Fall back to
    // the flag's creation time if it was never formally notified.
    // A generated request is not delivery. Retry the first notification until
    // Muse acknowledges it; only actual delivery starts an escalation timer.
    if (!flag.lastNotifiedAt) continue;
    const referenceTime = flag.lastNotifiedAt;
    const elapsed = now.getTime() - new Date(referenceTime).getTime();
    const nextLevel = Math.min(flag.escalationLevel + 1, steps.length - 1);
    if (nextLevel < 0) continue;
    // Email->text uses a longer window.
    const windowMs =
      nextLevel === flag.escalationLevel ? 7 * 24 * 3600000 : unansweredAfterMs;
    if (elapsed < windowMs) continue;
    const group = byLevel.get(nextLevel) ?? [];
    group.push(flag);
    byLevel.set(nextLevel, group);
  }

  for (const [level, flags] of byLevel) {
    const step = steps[level];
    if (!step) continue;
    const lines = flags.map((f) => `- [${f.severity.toUpperCase()}] ${f.title}\n  ${f.detail}`);
    payloads.push(queued({
      companyName: config.company.name,
      generatedAt: now.toISOString(),
      channel: step.channel,
      to: step.to,
      subject:
        `[Escalated to ${step.channel}] ${flags.length} bookkeeper item(s) ` +
        `awaiting review (${config.company.name})`,
      body:
        `These bookkeeping items remain unanswered. ${step.description}.\n\n` +
        lines.join("\n\n"),
      flagIds: flags.map((f) => f.id),
    }, state, level, flags));
  }

  return payloads;
}

function queued(payload: NotificationPayload, state: BookkeeperState | undefined, level: number, flags: Flag[], revision?: string): NotificationPayload {
  const key = JSON.stringify([payload.companyName, payload.channel, payload.to, payload.subject, payload.body,
    revision ?? flags.map(f => [f.id, f.lastNotifiedAt ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  payload.deliveryId = `delivery-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  state?.queueDelivery(payload.deliveryId, payload.companyName, level, payload.flagIds);
  return payload;
}

function fmt(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}
