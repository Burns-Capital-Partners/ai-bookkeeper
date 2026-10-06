/** Data-only handoff with Muse on the paired Mac. No shell commands or credentials. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transactionFingerprint, type BookkeeperState } from "./db.js";
import type { BankTransaction, CategorizationPattern, CompanyConfig } from "./types.js";
import { acceptContext, contextSnapshot } from "./context.js";
import { answerReview, recordDirectOwnerAnswer, reviewLedger } from "./reviews.js";
import { acceptReviewEvidence, reviewBudget } from "./reviewer.js";
import { acceptSharedReceipt, sharedState } from "./shared.js";
import { acceptSourceLedger, acknowledgeAuditChange } from "./audit.js";
import { metadataRepairs } from "./repairs.js";
import type { CloseInputs } from "./closer.js";

export interface MortgagePayment {
  id: string;
  date: string;
  amount: number;
  interest: number;
  principal: number;
  escrow: number;
}

export interface MonthlyEvidence {
  version: 1;
  kind: "monthly-evidence";
  id: string;
  organizationId: string;
  period: string;
  source: string;
  reviewer: string;
  note: string;
  statementBalances?: Record<string, number>;
  freedomLoanBalance?: number;
  freedomEscrowBalance?: number;
  rentReceived?: Record<string, number>;
  reviewedSteps?: string[];
  mortgagePayments?: MortgagePayment[];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 5000) throw new Error(`${name} is required and must be text.`);
  return value.trim();
}
function money(value: unknown, name: string, nonnegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001 || (nonnegative && value < 0)) {
    throw new Error(`${name} must be a finite amount in cents${nonnegative ? ", at least zero" : ""}.`);
  }
  return value;
}
function moneyMap(value: unknown, allowed: string[], name: string): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const entries = Object.entries(record(value, name));
  if (entries.some(([key]) => !allowed.includes(key))) throw new Error(`${name} contains an unknown account or unit.`);
  return Object.fromEntries(entries.map(([key, amount]) => [key, money(amount, key)]));
}

export function validateMonthlyEvidence(value: unknown, config: CompanyConfig): MonthlyEvidence {
  const v = record(value, "Monthly evidence");
  const period = text(v.period, "period");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("period must be YYYY-MM.");
  if (v.version !== 1 || v.kind !== "monthly-evidence" || v.organizationId !== config.company.zohoOrgId) throw new Error("Wrong schema, kind, or organization.");
  const payments: MortgagePayment[] = [];
  if (v.mortgagePayments !== undefined) {
    if (!Array.isArray(v.mortgagePayments)) throw new Error("mortgagePayments must be an array.");
    for (const item of v.mortgagePayments) {
      const p = record(item, "mortgage payment");
      const date = text(p.date, "payment date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !date.startsWith(period)) {
        throw new Error("Mortgage payment date must be a real date in this period, not the statement issue date.");
      }
      const payment = { id: text(p.id, "payment id"), date, amount: money(p.amount, "payment amount", true),
        interest: money(p.interest, "interest", true), principal: money(p.principal, "principal", true), escrow: money(p.escrow, "escrow", true) };
      if (payment.amount === 0 || Math.round(payment.amount * 100) !== Math.round((payment.interest + payment.principal + payment.escrow) * 100)) {
        throw new Error("Mortgage components must add to the full payment. Fees or extra principal need explicit review.");
      }
      if (payments.some(existing => existing.id === payment.id)) throw new Error("Duplicate mortgage payment id.");
      payments.push(payment);
    }
  }
  const reviewed = v.reviewedSteps ?? [];
  const allowedSteps = ["import-complete", "mortgage-split", "escrow-recorded", "owner-accounts-reviewed"];
  if (!Array.isArray(reviewed) || reviewed.some(s => typeof s !== "string" || !allowedSteps.includes(s))) throw new Error("Unknown reviewed step.");
  return { version: 1, kind: "monthly-evidence", id: text(v.id, "id"), organizationId: config.company.zohoOrgId,
    period, source: text(v.source, "source document reference"), reviewer: text(v.reviewer, "reviewer"), note: text(v.note, "note"),
    statementBalances: moneyMap(v.statementBalances, [config.accounts.tdBank!, config.accounts.quicksilver!], "statementBalances"),
    rentReceived: moneyMap(v.rentReceived, config.units.map(u => u.id), "rentReceived"),
    freedomLoanBalance: v.freedomLoanBalance === undefined ? undefined : money(v.freedomLoanBalance, "loan balance", true),
    freedomEscrowBalance: v.freedomEscrowBalance === undefined ? undefined : money(v.freedomEscrowBalance, "escrow balance"),
    reviewedSteps: v.reviewedSteps === undefined ? undefined : reviewed as string[],
    mortgagePayments: v.mortgagePayments === undefined ? undefined : payments };
}

export function mortgagePaymentFor(config: CompanyConfig, state: BookkeeperState, txn: BankTransaction): MortgagePayment | undefined {
  const raw = state.getMonthlyEvidence(config.company.name, txn.date.slice(0, 7));
  if (!raw) return undefined;
  const evidence = validateMonthlyEvidence(raw, config);
  const matches = (evidence.mortgagePayments ?? []).filter(p =>
    Math.round(p.amount * 100) === Math.round(Math.abs(txn.amount) * 100) &&
    Math.abs(Date.parse(p.date) - Date.parse(txn.date)) <= 7 * 86400000 &&
    (!state.mortgagePaymentTransaction(config.company.name, p.id) || state.mortgagePaymentTransaction(config.company.name, p.id) === txn.transactionId));
  return matches.length === 1 ? matches[0] : undefined;
}

export function closeInputsFromEvidence(evidence: MonthlyEvidence): CloseInputs {
  const [year, month] = evidence.period.split("-").map(Number);
  return { year: year!, month: month!, asOfDay: 31,
    statementBalances: evidence.statementBalances ?? {}, rentReceived: evidence.rentReceived ?? {},
    freedomLoanBalance: evidence.freedomLoanBalance, freedomEscrowBalance: evidence.freedomEscrowBalance,
    manualReview: { period: evidence.period, reviewer: evidence.reviewer,
      note: `${evidence.note} Source: ${evidence.source}`, steps: evidence.reviewedSteps ?? [] } };
}

function applyDecision(v: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState): void {
  const id = text(v.id, "id"), reviewer = text(v.reviewer, "reviewer"), ownerMessage = text(v.ownerMessage, "ownerMessage");
  const transactionId = text(v.transactionId, "transactionId"), fingerprint = text(v.fingerprint, "fingerprint");
  const observation = state.getObservation(config.company.name, transactionId);
  if (!observation || observation.fingerprint !== fingerprint) throw new Error("Decision refers to an outdated or unknown transaction. Refresh pending.json.");
  const txn = JSON.parse(observation.transaction_json) as BankTransaction;
  if (transactionFingerprint(txn) !== fingerprint || state.getPosting(config.company.name, transactionId)?.status === "posted") throw new Error("This source is already posted or has changed.");
  if (v.decision === "approve") {
    const flag = state.getFlag(text(v.flagId, "flagId"));
    if (!flag || flag.companyName !== config.company.name || flag.transactionId !== transactionId || flag.fingerprint !== fingerprint) throw new Error("Approval must refer to this exact flag and source.");
    state.approveFlag(flag.id, reviewer, ownerMessage);
    return;
  }
  if (v.decision !== "categorize") throw new Error("Decision must be approve or categorize.");
  if (txn.statement) throw new Error("Statement disbursements use the verified expense account in their evidence packet.");
  if (v.action === "rentalIncome" && /\bVENMO\b/i.test(txn.description)) throw new Error("Personal Venmo rent is recorded from the tenant receipt. Categorize its bank cashout as ownerContribution to avoid counting rent twice.");
  if (!["splitExpense", "rentalIncome", "ownerContribution"].includes(String(v.action))) throw new Error("Unsupported categorization action.");
  const accountKey = v.accountKey === undefined ? undefined : text(v.accountKey, "accountKey");
  if (v.action === "splitExpense" && (!accountKey || !["utilities", "insurance", "propertyTaxes", "repairsMaintenance", "personalExpenses"].includes(accountKey) || !Object.hasOwn(config.accounts, accountKey))) throw new Error("Choose a configured expense accountKey.");
  const unit = v.unitId === undefined ? undefined : text(v.unitId, "unitId");
  if (v.action === "rentalIncome" && !config.units.some(u => u.id === unit)) throw new Error("Rent decisions require a configured unitId.");
  const rentalShare = v.rentalShare === undefined ? config.allocation.rentalShare : v.rentalShare;
  if (typeof rentalShare !== "number" || !Number.isFinite(rentalShare) || rentalShare < 0 || rentalShare > 1) throw new Error("rentalShare must be between zero and one.");
  if (v.learn !== undefined && typeof v.learn !== "boolean") throw new Error("learn must be a boolean.");
  // A generic Venmo transfer or cash withdrawal never establishes a reusable
  // counterparty identity. Its owner-confirmed answer still applies to this item.
  const ambiguousSource = /\bVENMO\b|\bATM\b|CASH (WITHDRAWAL|WD)/i.test(txn.description);
  const learn = v.learn !== false && !ambiguousSource && !!txn.description.trim();
  const pattern: CategorizationPattern = {
    action: v.action as CategorizationPattern["action"], account: accountKey ? config.accounts[accountKey] : undefined,
    unit, rentalShare, notes: `${reviewer}: ${ownerMessage}`,
    match: { account: txn.accountName, direction: txn.amount > 0 ? "credit" : "debit",
      descriptionEquals: txn.description.trim().replace(/\s+/g, " "),
      ...(learn ? {} : { transactionId, fingerprint }) } };
  state.saveLearnedRule(id, config.company.name, pattern, `${reviewer}: ${ownerMessage}`);
  for (const flag of state.getOpenFlagsForTransaction(transactionId)) {
    if (flag.companyName === config.company.name && ["uncategorized", "venmo-ask", "cash-withdrawal"].includes(flag.type)) {
      state.resolveFlagAndRequeue(flag.id, `${reviewer}: ${ownerMessage}${learn ? " Rule learned." : " Applied only to this identified transaction."}`);
    }
  }
}

export interface HandoffResult { accepted: string[]; unchanged: string[]; errors: { file: string; error: string }[] }

export function importInbox(config: CompanyConfig, state: BookkeeperState, directory: string): HandoffResult {
  mkdirSync(directory, { recursive: true });
  const result: HandoffResult = { accepted: [], unchanged: [], errors: [] };
  for (const file of readdirSync(directory).filter(name => /^[A-Za-z0-9_.-]+\.json$/.test(name)).sort()) {
    try {
      const path = join(directory, file);
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Handoff must be a regular file.");
      if (metadata.size > 1024 * 1024) throw new Error("Handoff file exceeds 1 MB.");
      const raw = readFileSync(path, "utf8");
      const hash = createHash("sha256").update(raw).digest("hex");
      const v = record(JSON.parse(raw), "Handoff");
      const id = text(v.id, "id");
      if (v.version !== 1 || v.organizationId !== config.company.zohoOrgId) throw new Error("Wrong handoff version or organization.");
      const previous = state.getInboundHash(id);
      if (previous && previous !== hash) throw new Error("This id was already accepted with different content. Submit a new id.");
      if (previous) { result.unchanged.push(id); continue; }
      if (v.kind === "owner-context") acceptContext(v, config, state);
      else if (v.kind === "review-evidence") acceptReviewEvidence(v, config, state);
      else if (v.kind === "shared-receipt") acceptSharedReceipt(v, state);
      else if (v.kind === "source-ledger") acceptSourceLedger(v, config, state);
      else if (v.kind === "audit-change-confirmation") acknowledgeAuditChange(v, config, state);
      else if (v.kind === "monthly-evidence") {
        const packet = validateMonthlyEvidence(v, config);
        const old = state.getMonthlyEvidence(config.company.name, packet.period) as MonthlyEvidence | undefined;
        const merged = { ...old, ...Object.fromEntries(Object.entries(packet).filter(([, value]) => value !== undefined)),
          source: [...new Set([old?.source, packet.source].filter(Boolean))].join("; "),
          statementBalances: { ...old?.statementBalances, ...packet.statementBalances },
          rentReceived: { ...old?.rentReceived, ...packet.rentReceived },
          reviewedSteps: [...new Set([...(old?.reviewedSteps ?? []), ...(packet.reviewedSteps ?? [])])],
          mortgagePayments: packet.mortgagePayments ?? old?.mortgagePayments,
        } as MonthlyEvidence;
        for (const p of old?.mortgagePayments ?? []) {
          if (state.mortgagePaymentTransaction(config.company.name, p.id) && JSON.stringify(p) !== JSON.stringify(merged.mortgagePayments?.find(item => item.id === p.id))) {
            throw new Error("A linked mortgage payment cannot be changed or removed. Review the existing posting first.");
          }
        }
        state.saveMonthlyEvidence(config.company.name, packet.period, merged);
      } else if (v.kind === "escrow-disbursement") {
        const date = text(v.date, "date"), amount = money(v.amount, "full disbursement amount", true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || amount <= 0) throw new Error("Escrow disbursement requires a real date and positive amount.");
        if (!["insurance", "propertyTaxes"].includes(String(v.accountKey))) throw new Error("Escrow disbursement must identify insurance or propertyTaxes.");
        text(v.reviewer, "reviewer"); text(v.note, "note");
        const existingJournalId = v.existingJournalId === undefined ? undefined : text(v.existingJournalId, "existingJournalId");
        if (existingJournalId && !/^\d+$/.test(existingJournalId)) throw new Error("Existing journal ID must be numeric.");
        state.saveStatementTransaction({ transactionId: `escrow:${text(v.sourceTransactionId, "stable sourceTransactionId")}`, date,
          amount: -amount, accountName: config.accounts.mortgageEscrow!, description: text(v.description, "description"), status: "uncategorized",
          statement: { kind: "escrow", document: text(v.source, "source document"), expenseAccount: config.accounts[String(v.accountKey)]!, existingJournalId } });
      } else if (v.kind === "venmo-rent-receipt") {
        const date = text(v.date, "actual receipt date"), amount = money(v.amount, "rent received", true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || amount <= 0) throw new Error("Venmo receipt requires an actual date and positive amount.");
        const unit = config.units.find(u => u.id === v.unitId && u.paymentMethod === "Venmo");
        const payer = text(v.payerName, "payerName");
        const names = [...(unit?.tenants ?? []), ...(unit?.tenant ? [unit.tenant] : [])];
        if (!unit || !names.some(name => name.trim().toUpperCase() === payer.toUpperCase())) throw new Error("Venmo payer must match a configured tenant for this unit; ask the owner about unfamiliar names.");
        text(v.reviewer, "reviewer"); text(v.note, "note");
        const existingJournalId = v.existingJournalId === undefined ? undefined : text(v.existingJournalId, "existingJournalId");
        if (existingJournalId && !/^\d+$/.test(existingJournalId)) throw new Error("Existing journal ID must be numeric.");
        state.saveStatementTransaction({ transactionId: `venmo:${text(v.sourceTransactionId, "stable Venmo transaction ID")}`, date,
          amount, accountName: config.accounts.ownerDraws!, description: `Venmo rent received from ${payer}`, status: "uncategorized",
          statement: { kind: "venmo-rent", document: text(v.source, "source receipt reference"), unitId: unit.id, existingJournalId } });
      } else if (v.kind === "decision") {
        if (v.decision === "categorize") state.atomic(() => { applyDecision(v, config, state); recordDirectOwnerAnswer(v, config, state); });
        else applyDecision(v, config, state);
      }
      else if (v.kind === "proposal-answer") state.atomic(() => answerReview(v, config, state));
      else if (v.kind === "delivery-receipt") {
        state.confirmDelivery(text(v.deliveryId, "deliveryId"), config.company.name, text(v.receipt, "receipt"));
      } else if (v.kind === "flag-review") {
        const flag = state.getFlag(text(v.flagId, "flagId"));
        const note = `${text(v.reviewer, "reviewer")}: ${text(v.ownerMessage, "ownerMessage")}`;
        if (!flag || flag.companyName !== config.company.name) throw new Error("Unknown flag for this organization.");
        if (v.decision === "acknowledge") state.updateFlag(flag.id, { status: "acknowledged", notes: note });
        else if (v.decision === "resolve" && flag.severity === "info") state.resolveFlagAndRequeue(flag.id, note);
        else throw new Error("Use acknowledge, or resolve an informational item. Posting decisions require the transaction snapshot.");
      }
      else throw new Error("Unsupported handoff kind.");
      state.recordInbound(id, hash, v);
      result.accepted.push(id);
    } catch (error) {
      result.errors.push({ file, error: error instanceof SyntaxError ? "Incomplete or invalid JSON; write a complete file and retry." : error instanceof Error ? error.message : "Invalid handoff" });
    }
  }
  return result;
}

export function writeJsonAtomic(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}

export function exportPending(config: CompanyConfig, state: BookkeeperState, path: string, extra: Record<string, unknown> = {}): void {
  const flags = state.getOpenFlags(config.company.name);
  writeJsonAtomic(path, { version: 1, organizationId: config.company.zohoOrgId, generatedAt: new Date().toISOString(),
    flags: flags.map(flag => ({ ...flag, source: flag.transactionId ?
      JSON.parse(state.getObservation(config.company.name, flag.transactionId)?.transaction_json ?? "null") : undefined })),
    context: contextSnapshot(config, state), reviews: reviewLedger(config, state), reviewBudget: reviewBudget(config, state), storage: sharedState(state),
    sourceAudits: state.getRuntime("source-audit-results") ?? [], metadataRepairs: metadataRepairs(config, state),
    learnedRules: state.getLearnedRules(config.company.name), ...extra });
}
