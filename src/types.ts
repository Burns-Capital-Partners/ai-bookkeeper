/**
 * Shared types for the AI bookkeeper worker.
 * Everything company-specific comes from the JSON config, never hardcoded here.
 */

export type ReportingBasis = "cash" | "accrual";

export interface CompanyConfig {
  company: {
    name: string;
    description: string;
    zohoOrgId: string;
    timezone: string;
    currency: string;
    /** P&L reporting policy. Omission preserves the legacy accrual behavior. */
    reportingBasis?: ReportingBasis;
    /** Fictional examples cannot connect to Zoho or post. */
    example?: boolean;
  };
  bankAccountIds: { tdBank: string; quicksilver: string };
  accounts: Record<string, string>;
  allocation: {
    rentalShare: number;
    personalShare: number;
    note: string;
  };
  units: RentalUnit[];
  categorizationPatterns: CategorizationPattern[];
  flagRules: FlagRules;
  closeChecklist: ChecklistStep[];
  /** Reviewed supplemental ledgers that must also reconcile before a close. */
  supplementalCloseAccounts?: string[];
  escalation: EscalationPolicy;
  depreciation: {
    frequency: "annual" | "monthly";
    note: string;
  };
}

export interface RentalUnit {
  id: string;
  name: string;
  tenants?: string[];
  tenant?: string;
  customerId?: string;
  monthlyRent: number;
  paymentMethod: string;
  paymentDestination: string;
  expectedDay: number;
  latePattern: {
    typicalPaymentDays: number[];
    doNotFlagBeforeDay: number;
    description: string;
    notes: string;
  } | null;
  notes: string;
}

export type PatternAction =
  | "mortgageSplitJournal"
  | "splitExpense"
  | "escrowDisbursement"
  | "rentalIncome"
  | "ownerContribution"
  | "flagForHuman"
  | "interAccountTransfer";

export interface CategorizationPattern {
  /** Explicit recurring exception; amount must match exactly, in cents. */
  expectedAmount?: number;
  match: {
    descriptionContains?: string;
    descriptionEquals?: string;
    transactionId?: string;
    fingerprint?: string;
    account?: string;
    direction?: "credit" | "debit";
    isTransfer?: boolean;
    from?: string;
    to?: string;
    isCashWithdrawal?: boolean;
  };
  action: PatternAction;
  account?: string;
  unit?: string;
  /** An owner-confirmed exception to the shared allocation, such as a unit repair. */
  rentalShare?: number;
  reason?: string;
  notes: string;
}

export interface FlagRules {
  amountThreshold: number;
  amountThresholdNote: string;
  improvementVsRepair: boolean;
  improvementVsRepairNote: string;
  uncategorizedAfterMatching: boolean;
  rentMissing: boolean;
  rentMissingNote: string;
  duplicates: boolean;
  duplicatesNote: string;
  needsReceipt: boolean;
  needsReceiptNote: string;
}

export interface ChecklistStep {
  id: string;
  description: string;
}

export interface EscalationPolicy {
  steps: EscalationStep[];
  note: string;
}

export interface EscalationStep {
  channel: "notification" | "email" | "text";
  description: string;
  to?: string;
}

/** A bank transaction pulled from Zoho Books. */
export interface BankTransaction {
  transactionId: string;
  date: string; // ISO date
  description: string;
  amount: number; // positive = money in, negative = money out
  accountName: string;
  accountId?: string;
  status: "uncategorized" | "categorized";
  reference?: string;
  /** Actual external receipt/disbursement, verified from its source by Muse. */
  statement?: { kind: "escrow" | "venmo-rent"; document: string; expenseAccount?: string; unitId?: string; existingJournalId?: string };
}

/** A flag raised by the worker for human review. */
export interface Flag {
  id: string;
  createdAt: string; // ISO datetime
  companyName: string;
  transactionId?: string;
  type:
    | "amount-threshold"
    | "improvement-vs-repair"
    | "uncategorized"
    | "rent-missing"
    | "duplicate"
    | "needs-receipt"
    | "venmo-ask"
    | "cash-withdrawal"
    | "reconciliation-mismatch"
    | "checklist-blocked"
    | "posting-uncertain"
    | "posted-source-changed"
    | "source-match"
    | "existing-match"
    | "worker-error"
    | "transfer-counterpart"
    | "review-proposal";
  severity: "info" | "warning" | "blocking";
  title: string;
  detail: string;
  amount?: number;
  status: "open" | "acknowledged" | "resolved" | "carried-forward";
  escalationLevel: number; // index into escalation.steps
  lastNotifiedAt?: string;
  notes?: string;
  /** Stable identity for an outstanding issue (not a notification attempt). */
  key?: string;
  period?: string;
  fingerprint?: string;
}

/** Result of a single close-checklist step. */
export interface ChecklistResult {
  stepId: string;
  description: string;
  /**
   * complete: evidence obtained and checks passed.
   * flagged: checks ran but something needs human review.
   * blocked: required evidence was missing, so the check could not run.
   *   A close with any blocked step is NOT complete.
   * skipped: step not applicable.
   */
  status: "complete" | "flagged" | "blocked" | "skipped";
  detail?: string;
  flagIds: string[];
}

/** Result of a monthly close run. */
export interface CloseReport {
  companyName: string;
  periodYear: number;
  periodMonth: number; // 1-12
  ranAt: string;
  steps: ChecklistResult[];
  /** Active flags presented by this close, including earlier unresolved issues. */
  flagsRaised: Flag[];
  complete: boolean;
  /** Bookkeeping may be complete while tenant rent remains outstanding. */
  rentOutstanding?: boolean;
}

/** A journal entry to create in Zoho Books. */
export interface JournalLine {
  accountName: string;
  customerId?: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface JournalEntry {
  date: string;
  notes: string;
  referenceNumber?: string;
  lines: JournalLine[];
}

/** Get a required account display name from config; throws if missing. */
export function requiredAccount(
  accounts: Record<string, string>,
  key: string
): string {
  const name = accounts[key];
  if (!name) throw new Error(`Account "${key}" is not configured.`);
  return name;
}
