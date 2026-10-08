/**
 * Closer: executes the month-end close checklist from the company config,
 * step by step, marking each complete or flagged.
 *
 * It orchestrates the categorizer and reconciler, then runs the remaining
 * review steps (P&L anomaly scan, owner-account review, open-flag check).
 * The result is a CloseReport persisted to state and handed to the notifier.
 *
 * Depreciation is annual per config and is NOT part of the monthly close.
 */

import type {
  ChecklistResult,
  CloseReport,
  CompanyConfig,
  Flag,
} from "./types.js";
import type { ZohoBooksClient } from "./zoho.js";
import type { BookkeeperState } from "./db.js";
import { randomUUID } from "node:crypto";
import { categorizeTransactions } from "./categorizer.js";
import { reconcile, type ReconcileInputs } from "./reconciler.js";
import { auditSourceLedgers, type AuditResult } from "./audit.js";

export interface CloseInputs extends ReconcileInputs {
  requireSourceAudit?: boolean;
  sourceAuditResults?: AuditResult[];
  year: number;
  month: number; // 1-12
  /** Explicit human evidence for checks that the API cannot establish. */
  manualReview?: { period: string; reviewer: string; note: string; steps: string[] };
  /** Explicit review of all movements/classifications plus a source closing balance. */
  supplementalReviews?: {
    accountName: string; from: string; to: string; closingBalance: number;
    reviewer: string; source: string; note: string; transactionsVerified: boolean;
  }[];
}

export async function runMonthlyClose(
  config: CompanyConfig,
  zoho: ZohoBooksClient,
  state: BookkeeperState,
  inputs: CloseInputs
): Promise<CloseReport> {
  const steps: ChecklistResult[] = [];
  const closeFlags: Flag[] = [];
  const company = config.company.name;
  const { start, end } = monthRange(inputs.year, inputs.month);
  const period = start.slice(0, 7);
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.company.timezone, year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const currentPeriod = `${nowParts.find(p => p.type === "year")!.value}-${nowParts.find(p => p.type === "month")!.value}`;
  if (period >= currentPeriod) throw new Error("Only a completed calendar month can be closed.");

  const complete = (
    stepId: string,
    detail?: string
  ): void => {
    const def = config.closeChecklist.find((s) => s.id === stepId)!;
    steps.push({ stepId, description: def.description, status: "complete", detail, flagIds: [] });
    state.resolveIssue(company, `close:${period}:${stepId}`);
  };
  const flagged = (
    stepId: string,
    flagIds: string[],
    detail?: string
  ): void => {
    const def = config.closeChecklist.find((s) => s.id === stepId)!;
    steps.push({ stepId, description: def.description, status: "flagged", detail, flagIds });
  };
  /**
   * BUG FIX (close completes without reconciliation): when required evidence
   * is missing, the step is BLOCKED, not complete. A close with any blocked
   * step is not complete.
   */
  const blocked = (stepId: string, detail: string): void => {
    const def = config.closeChecklist.find((s) => s.id === stepId)!;
    const flag = raiseCloseFlag(config, state, period, stepId, def.description, detail);
    closeFlags.push(flag);
    steps.push({ stepId, description: def.description, status: "blocked", detail, flagIds: [flag.id] });
  };
  const manual = (stepId: string): void => {
    const review = inputs.manualReview;
    if (review?.period === period && review.reviewer.trim() && review.note.trim() && review.steps.includes(stepId)) {
      complete(stepId, `Confirmed by ${review.reviewer}: ${review.note}`);
    } else {
      blocked(stepId, `A reviewer must explicitly confirm this check for ${period}.`);
    }
  };

  // Steps 1-2: categorize everything through month-end.
  const cat = await categorizeTransactions(config, zoho, state, {
    fromDate: start,
    toDate: end,
  });
  manual("import-complete");
  if (inputs.requireSourceAudit) {
    const audits = inputs.sourceAuditResults && !cat.journalsCreated.length && !cat.transfersCreated.length ?
      inputs.sourceAuditResults : await auditSourceLedgers(config, state, zoho);
    const covered = [config.accounts.tdBank, config.accounts.quicksilver].every(account => audits.some(a =>
      a.accountName === account && a.from === start && a.to === end && a.status === "verified"));
    const detail = "Complete source-ledger coverage and transaction/balance comparison are required for both accounts through calendar month-end. Classification coverage is reported separately in each audit.";
    const ids: string[] = [];
    if (!covered) { const flag = raiseCloseFlag(config, state, period, "source-transactions", "Source transactions verified", detail); closeFlags.push(flag); ids.push(flag.id); }
    else state.resolveIssue(company, `close:${period}:source-transactions`);
    steps.push({ stepId: "source-transactions", description: "Source transactions verified", status: covered ? "complete" : "blocked", detail, flagIds: ids });
  }
  if (cat.pending.length === 0) {
    complete("all-categorized", "No uncategorized transactions remain.");
  } else {
    flagged(
      "all-categorized",
      state.getOpenFlags(company).filter((f) => f.transactionId && cat.pending.includes(f.transactionId)).map((f) => f.id),
      `${cat.pending.length} transactions are still unposted or require matching.`
    );
  }

  // Steps 3-9: reconciliation (bank balances, rent, mortgage/escrow tie-outs).
  // Evidence is REQUIRED: a step with no evidence is blocked, never complete.
  const rec = await reconcile(config, zoho, state, {
    ...inputs,
    periodYear: inputs.year,
    periodMonth: inputs.month,
    asOfDate: end, // month-end cutoff for all balance queries
  });

  // Bank steps: require statement balances as evidence.
  const tdAccount = config.accounts["tdBank"];
  const qsAccount = config.accounts["quicksilver"];
  const hasTdStatement = tdAccount !== undefined && inputs.statementBalances[tdAccount] !== undefined;
  const hasQsStatement = qsAccount !== undefined && inputs.statementBalances[qsAccount] !== undefined;
  const bankFlags = rec.flagsRaised.filter((f) => f.title.includes("out of balance"));

  if (!hasTdStatement) {
    blocked("td-reconciled", "No Operating Bank statement balance was provided; reconciliation could not run.");
  } else if (bankFlags.some((f) => f.title === `${tdAccount} out of balance`)) {
    flagged("td-reconciled", bankFlags.map((f) => f.id), "See reconciliation flags.");
  } else {
    complete("td-reconciled", "Book balance matches statement.");
  }

  if (!hasQsStatement) {
    blocked("quicksilver-reconciled", "No Property Card statement balance was provided; reconciliation could not run.");
  } else if (bankFlags.some((f) => f.title === `${qsAccount} out of balance`)) {
    flagged("quicksilver-reconciled", bankFlags.map((f) => f.id), "See reconciliation flags.");
  } else {
    complete("quicksilver-reconciled", "Book balance matches statement.");
  }

  const rentFlags = rec.flagsRaised.filter((f) => f.type === "rent-missing");
  if (rec.rentEvidenceMissing.length) {
    blocked("rent-verified", `Rent records were not provided for ${rec.rentEvidenceMissing.join(", ")}. Missing evidence is not evidence of nonpayment.`);
  } else if (rentFlags.length === 0 && rec.rentPending.length === 0) {
    complete("rent-verified", rec.passed.filter((p) => p.includes("rent")).join("; "));
  } else {
    state.resolveIssue(company, `close:${period}:rent-verified`);
    flagged("rent-verified", rentFlags.map((f) => f.id), "Unpaid rent remains tracked separately and does not prevent bookkeeping completion.");
  }

  const mortgageFlags = rec.flagsRaised.filter((f) =>
    f.title.includes("Mortgage Payable")
  );
  if (inputs.freedomLoanBalance === undefined) {
    blocked("mortgage-split", "No Example Mortgage loan balance provided; P&I tie-out could not run.");
    blocked("mortgage-tieout", "No Example Mortgage loan balance provided; tie-out could not run.");
  } else if (mortgageFlags.length === 0) {
    manual("mortgage-split");
    complete("mortgage-tieout");
  } else {
    flagged("mortgage-split", mortgageFlags.map((f) => f.id));
    flagged("mortgage-tieout", mortgageFlags.map((f) => f.id));
  }

  const escrowFlags = rec.flagsRaised.filter((f) => f.title.includes("Escrow"));
  if (inputs.freedomEscrowBalance === undefined) {
    blocked("escrow-recorded", "No Example Mortgage escrow balance provided; escrow checks could not run.");
    blocked("escrow-tieout", "No Example Mortgage escrow balance provided; tie-out could not run.");
  } else if (escrowFlags.length === 0) {
    manual("escrow-recorded");
    complete("escrow-tieout");
  } else {
    flagged("escrow-recorded", escrowFlags.map((f) => f.id));
    flagged("escrow-tieout", escrowFlags.map((f) => f.id));
  }

  // Supplemental accounts cannot disappear merely because the input omitted them.
  // These remain reviewed ledgers; this does not add automated posting or source intake.
  for (const account of config.supplementalCloseAccounts ?? []) {
    const stepId = `supplemental:${account}`;
    const description = `Supplemental ledger reviewed: ${account}`;
    const reviews = Array.isArray(inputs.supplementalReviews) ? inputs.supplementalReviews.filter(r => r?.accountName === account) : [];
    const review = reviews[0];
    const text = (value: unknown): boolean => typeof value === "string" && Boolean(value.trim());
    let problem: string | undefined;
    if (cat.journalsCreated.length || cat.transfersCreated.length) {
      problem = "Posting changed the ledger during this run; refresh the supplemental review and rerun the close.";
    } else if (reviews.length !== 1 || !review || review.from !== start || review.to !== end ||
        !text(review.reviewer) || !text(review.source) || !text(review.note) || review.transactionsVerified !== true ||
        !Number.isFinite(review.closingBalance) || Math.abs(review.closingBalance * 100 - Math.round(review.closingBalance * 100)) > 1e-6) {
      problem = `Exactly one reviewed source covering ${start} through ${end}, all movements/classifications and a finite closing balance with at most two decimal places is required.`;
    } else {
      try {
        const actual = await zoho.getLedgerBalance(account, end);
        if (!Number.isFinite(actual) || Math.abs(actual - review.closingBalance) > 0.005) {
          problem = "The ledger closing balance does not match the reviewed source to the cent.";
        }
      } catch {
        problem = "The supplemental ledger balance could not be read; source review alone cannot complete this check.";
      }
    }
    if (problem) {
      const flag = raiseCloseFlag(config, state, period, stepId, description, problem);
      closeFlags.push(flag);
      steps.push({ stepId, description, status: "blocked", detail: problem, flagIds: [flag.id] });
    } else {
      state.resolveIssue(company, `close:${period}:${stepId}`);
      steps.push({ stepId, description, status: "complete", detail: `Source ${review!.source}; reviewed by ${review!.reviewer}: ${review!.note}`, flagIds: [] });
    }
  }

  // Step 10: P&L anomaly scan.
  const anomalies = await scanProfitAndLoss(config, zoho, start, end);
  if (anomalies.length === 0) {
    complete("pl-review", "No anomalies detected.");
  } else {
    blocked("pl-review", anomalies.join(" "));
  }

  manual("owner-accounts-reviewed");
  // Step 11: open flags carried forward.
  const openFlags = state.getOpenFlags(company).filter(flag => {
    if (flag.period) return flag.period === period;
    const observed = flag.transactionId && state.getObservation(company, flag.transactionId);
    return !observed || (JSON.parse(observed.transaction_json) as { date: string }).date <= end;
  });
  const accountingFlags = openFlags.filter(f => f.type !== "rent-missing");
  if (accountingFlags.length === 0) {
    complete("flags-resolved", openFlags.length ? "Only unpaid-rent items remain open; tracked separately." : "No open flags.");
  } else {
    flagged(
      "flags-resolved",
      accountingFlags.map((f) => f.id),
      `${accountingFlags.length} bookkeeping item(s) still unresolved.`
    );
  }

  const report: CloseReport = {
    companyName: company,
    periodYear: inputs.year,
    periodMonth: inputs.month,
    ranAt: new Date().toISOString(),
    steps,
    flagsRaised: [...new Map([...cat.flagsRaised, ...rec.flagsRaised, ...closeFlags, ...openFlags].map((f) => [f.id, f])).values()],
    complete: steps.every((s) => s.status === "complete" || (s.stepId === "rent-verified" && s.status === "flagged")),
    rentOutstanding: openFlags.some(f => f.type === "rent-missing") || rec.rentPending.length > 0,
  };
  state.saveCloseRun(report);
  return report;
}

/**
 * Raise a blocking flag when a close step cannot run for lack of evidence.
 */
function raiseCloseFlag(
  config: CompanyConfig,
  state: BookkeeperState,
  period: string,
  stepId: string,
  stepDescription: string,
  detail: string
): Flag {
  const flag: Flag = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    companyName: config.company.name,
    status: "open",
    escalationLevel: 0,
    type: "checklist-blocked",
    key: `close:${period}:${stepId}`,
    period,
    severity: "blocking",
    title: `Close blocked: ${stepDescription}`,
    detail: `${detail} (step: ${stepId})`,
  };
  return state.saveFlag(flag);
}

/**
 * Basic income/expense ledger sanity check. This does not claim to replace
 * Zoho's financial statements or an accounting review.
 */
async function scanProfitAndLoss(
  config: CompanyConfig,
  zoho: ZohoBooksClient,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const anomalies: string[] = [];
  let pl: Record<string, number>;
  try {
    pl = await zoho.getProfitAndLoss(fromDate, toDate);
  } catch {
    return ["P&L report unavailable; manual review required."];
  }

  if (Object.values(pl).some((amount) => !Number.isFinite(amount))) {
    return ["P&L report contains invalid numeric balances; correct the source report before closing."];
  }

  // Late rent legitimately reduces cash income. Rent checks track the shortfall;
  // expected rent must not create a second P&L blocker for the same nonpayment.

  // Negative expense balances (other than contra accounts) are suspicious.
  for (const [account, amount] of Object.entries(pl)) {
    if (amount < 0 && !account.toLowerCase().includes("income")) {
      anomalies.push(`Negative balance on expense account ${account}: ${fmt(amount)}.`);
    }
  }
  void config;
  return anomalies;
}

function monthRange(year: number, month: number): { start: string; end: string } {
  if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid close period.");
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function fmt(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}
