/**
 * Reconciler: verifies the books match reality.
 *
 * Checks:
 *  - Bank book balances vs. statement balances (Operating Bank, Property Card)
 *  - Mortgage Payable ledger vs. Example Mortgage reported balance x rental share
 *  - Mortgage Escrow ledger vs. Example Mortgage reported escrow x rental share
 *  - Rent received vs. expected (respecting each unit's late pattern)
 *
 * Example Mortgage figures are inputs: the worker does not log into Example Mortgage.
 * Pass them in via ReconcileInputs (from the monthly statement cron or manual entry).
 *
 * Any mismatch raises a flag; nothing is auto-corrected.
 */

import { randomUUID } from "node:crypto";
import type { CompanyConfig, Flag } from "./types.js";
import type { ZohoBooksClient } from "./zoho.js";
import { requiredAccount } from "./types.js";
import type { BookkeeperState } from "./db.js";

export interface ReconcileInputs {
  /** Statement balances keyed by account display name. */
  statementBalances: Record<string, number>;
  /** Example Mortgage reported total loan balance (100%, before rental share). */
  freedomLoanBalance?: number;
  /** Example Mortgage reported escrow balance (100%, before rental share). */
  freedomEscrowBalance?: number;
  /** Rent received this month per unit id, e.g. { "unit-down": 2000 }. */
  rentReceived: Record<string, number>;
  /** Day of month the check runs (1-31), used for late-pattern logic. */
  asOfDay: number;
  /**
   * Closing period. When the period being closed is a past month, rent
   * grace periods are evaluated against the END of that month (grace has
   * passed), not the run date. Prevents unpaid September rent from getting
   * a fresh grace period when the close runs on October 1st.
   * Optional: when omitted, asOfDay is used as-is.
   */
  periodYear?: number;
  periodMonth?: number; // 1-12
  /**
   * Month-end cutoff (YYYY-MM-DD) for all balance queries. Balances must
   * be read as of this date so transactions after month-end cannot corrupt
   * a historical reconciliation.
   */
  asOfDate?: string;
}

export interface ReconcileResult {
  passed: string[];
  flagsRaised: Flag[];
  rentPending: string[];
  rentEvidenceMissing: string[];
}

const TOLERANCE = 0.01;

export async function reconcile(
  config: CompanyConfig,
  zoho: ZohoBooksClient,
  state: BookkeeperState,
  inputs: ReconcileInputs
): Promise<ReconcileResult> {
  const result: ReconcileResult = { passed: [], flagsRaised: [], rentPending: [], rentEvidenceMissing: [] };
  const period = inputs.periodYear !== undefined && inputs.periodMonth !== undefined
    ? `${inputs.periodYear}-${String(inputs.periodMonth).padStart(2, "0")}` : inputs.asOfDate?.slice(0, 7) ?? "current";
  const issueKey = (name: string) => `reconcile:${period}:${name}`;
  const raise = (
    partial: Omit<Flag, "id" | "createdAt" | "companyName" | "status" | "escalationLevel">
  ): void => {
    const flag: Flag = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      companyName: config.company.name,
      status: "open",
      escalationLevel: 0,
      period,
      ...partial,
    };
    result.flagsRaised.push(state.saveFlag(flag));
  };

  // 1. Bank balances vs. statements (as of month-end cutoff).
  for (const [accountName, statementBalance] of Object.entries(inputs.statementBalances)) {
    const bookBalance = await zoho.getAccountBalance(accountName, inputs.asOfDate);
    finite(statementBalance, accountName);
    finite(bookBalance, accountName);
    if (Math.abs(bookBalance - statementBalance) > TOLERANCE) {
      raise({
        type: "reconciliation-mismatch",
        key: issueKey(`bank:${accountName}`),
        severity: "blocking",
        title: `${accountName} out of balance`,
        detail:
          `Book balance ${fmt(bookBalance)} does not match statement ` +
          `${fmt(statementBalance)} (diff ${fmt(bookBalance - statementBalance)}).`,
        amount: Math.abs(bookBalance - statementBalance),
      });
    } else {
      state.resolveIssue(config.company.name, issueKey(`bank:${accountName}`));
      result.passed.push(`${accountName} reconciled at ${fmt(bookBalance)}`);
    }
  }

  // 2. Mortgage Payable tie-out (ledger vs. Example Mortgage x rental share).
  if (inputs.freedomLoanBalance !== undefined) {
    finite(inputs.freedomLoanBalance, "mortgage statement");
    const expected = round2(inputs.freedomLoanBalance * config.allocation.rentalShare);
    const ledger = await zoho.getLedgerBalance(
        requiredAccount(config.accounts, "mortgagePayable"),
        inputs.asOfDate
      );
    finite(ledger, "mortgage ledger");
    if (Math.abs(ledger - expected) > TOLERANCE) {
      raise({
        type: "reconciliation-mismatch",
        key: issueKey("mortgage"),
        severity: "blocking",
        title: "Mortgage Payable tie-out failed",
        detail:
          `Ledger ${fmt(ledger)} vs. Example Mortgage ${fmt(inputs.freedomLoanBalance)} x ` +
          `${pct(config.allocation.rentalShare)} = ${fmt(expected)} ` +
          `(diff ${fmt(ledger - expected)}).`,
        amount: Math.abs(ledger - expected),
      });
    } else {
      state.resolveIssue(config.company.name, issueKey("mortgage"));
      result.passed.push(`Mortgage Payable ties at ${fmt(ledger)}`);
    }
  }

  // 3. Mortgage Escrow tie-out.
  if (inputs.freedomEscrowBalance !== undefined) {
    finite(inputs.freedomEscrowBalance, "escrow statement");
    const expected = round2(inputs.freedomEscrowBalance * config.allocation.rentalShare);
    const ledger = await zoho.getLedgerBalance(
      requiredAccount(config.accounts, "mortgageEscrow"),
      inputs.asOfDate
    );
    finite(ledger, "escrow ledger");
    if (Math.abs(ledger - expected) > TOLERANCE) {
      raise({
        type: "reconciliation-mismatch",
        key: issueKey("escrow"),
        severity: "blocking",
        title: "Mortgage Escrow tie-out failed",
        detail:
          `Ledger ${fmt(ledger)} vs. Example Mortgage ${fmt(inputs.freedomEscrowBalance)} x ` +
          `${pct(config.allocation.rentalShare)} = ${fmt(expected)} ` +
          `(diff ${fmt(ledger - expected)}).`,
        amount: Math.abs(ledger - expected),
      });
    } else {
      state.resolveIssue(config.company.name, issueKey("escrow"));
      result.passed.push(`Mortgage Escrow ties at ${fmt(ledger)}`);
    }
  }

  // 4. Rent verification per unit, respecting late patterns.
  //
  // BUG FIX (overdue rent gets a new grace period): when closing a PAST
  // month, evaluate grace against the end of the closing month, not the
  // run date. Closing September on October 1st must not give unpaid
  // September rent a fresh grace period.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.company.timezone, year: "numeric", month: "numeric",
  }).formatToParts(new Date());
  const currentYear = Number(parts.find((p) => p.type === "year")!.value);
  const currentMonth = Number(parts.find((p) => p.type === "month")!.value);
  let effectiveAsOfDay = inputs.asOfDay;
  let periodLabel = "current period";
  let isPastPeriod = false;
  if (inputs.periodYear !== undefined && inputs.periodMonth !== undefined) {
    isPastPeriod = inputs.periodYear < currentYear ||
      (inputs.periodYear === currentYear && inputs.periodMonth < currentMonth);
    if (isPastPeriod) {
      effectiveAsOfDay = new Date(inputs.periodYear, inputs.periodMonth, 0).getDate();
    }
    periodLabel = `${inputs.periodYear}-${String(inputs.periodMonth).padStart(2, "0")}`;
  }

  for (const unit of config.units) {
    const received = inputs.rentReceived[unit.id];
    if (received === undefined) {
      result.rentEvidenceMissing.push(unit.name);
      continue;
    }
    finite(received, `rent ${unit.id}`);
    if (received >= unit.monthlyRent - TOLERANCE) {
      state.resolveIssue(config.company.name, issueKey(`rent:${unit.id}`));
      result.passed.push(`${unit.name} rent received: ${fmt(received)}`);
      continue;
    }
    const shortfall = round2(unit.monthlyRent - received);

    // Unit UP's late pattern: do not flag before the grace day.
    const graceDay = unit.latePattern?.doNotFlagBeforeDay ?? 5;
    // A completed historical period cannot retain grace forever (e.g. February < day 30).
    if (!isPastPeriod && effectiveAsOfDay < graceDay) {
      result.rentPending.push(
        `${unit.name} rent pending (${fmt(received)} of ${fmt(unit.monthlyRent)}): ` +
          `within late-pattern grace period (day ${effectiveAsOfDay} < ${graceDay}), not flagged.`
      );
      continue;
    }

    raise({
      type: "rent-missing",
      key: issueKey(`rent:${unit.id}`),
      severity: "warning",
      title: `${unit.name} rent shortfall: ${fmt(shortfall)}`,
      detail:
        `Expected ${fmt(unit.monthlyRent)}, received ${fmt(received)} for ` +
        `${periodLabel} (evaluated as of day ${effectiveAsOfDay}). ` +
        (unit.latePattern ? unit.latePattern.description + " " : "") +
        (isPastPeriod ? "The rental period has ended." : `Grace period (day ${graceDay}) has passed.`),
      amount: shortfall,
    });
  }

  return result;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric balance for ${label}.`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}
