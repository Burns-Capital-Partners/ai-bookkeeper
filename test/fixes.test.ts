/**
 * Regression tests for the 10 PR #98 review findings.
 * Run: npm test
 * Exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BankTransaction,
  CompanyConfig,
  Flag,
  JournalEntry,
} from "../src/types.js";
import { BookkeeperState } from "../src/db.js";
import { categorizeTransactions } from "../src/categorizer.js";
import { reconcile } from "../src/reconciler.js";
import { runMonthlyClose } from "../src/closer.js";
import {
  buildFlagNotification,
  pendingEscalations,
} from "../src/notifier.js";

const ROOT = process.cwd();
const config = JSON.parse(
  readFileSync(join(ROOT, "config", "example-property.json"), "utf-8")
) as CompanyConfig;

/** Minimal mock of ZohoBooksClient that records calls. */
class MockZoho {
  async matchBankTransaction(): Promise<void> {}
  async checkSourceForPosting(): Promise<void> {}
  async getBankTransaction(source: BankTransaction): Promise<BankTransaction> { return source; }
  txns: BankTransaction[] = [];
  journals: JournalEntry[] = [];
  transfers: { fromAccount: string; toAccount: string; amount: number }[] = [];
  balances: Record<string, number> = {};
  ledger: Record<string, number> = {};
  pl: Record<string, number> = {};
  seenAsOf: (string | undefined)[] = [];

  async listBankTransactions(): Promise<BankTransaction[]> {
    return this.txns;
  }
  async createJournal(entry: JournalEntry): Promise<string> {
    this.journals.push(entry);
    return `J-${this.journals.length}`;
  }
  async createTransfer(o: {
    fromAccount: string;
    toAccount: string;
    amount: number;
  }): Promise<string> {
    this.transfers.push(o);
    return `T-${this.transfers.length}`;
  }
  async getAccountBalance(name: string, asOfDate?: string): Promise<number> {
    this.seenAsOf.push(asOfDate);
    return this.balances[name] ?? 0;
  }
  async getLedgerBalance(name: string, asOfDate?: string): Promise<number> {
    this.seenAsOf.push(asOfDate);
    return this.ledger[name] ?? 0;
  }
  async getProfitAndLoss(): Promise<Record<string, number>> {
    return this.pl;
  }
}

function txn(
  id: string,
  description: string,
  amount: number,
  accountName = "Property Card",
  date = "2026-09-15"
): BankTransaction {
  return {
    transactionId: id,
    date,
    description,
    amount,
    accountName,
    status: "uncategorized",
  };
}

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? " -- " + detail : ""}`);
  }
}

// ---------- Bug 1: ordinary purchases must not become transfers ----------
console.log("Bug 1: purchases are not transfers");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).txns = [txn("t1", "HOME DEPOT STORE #1234", -100)];
  const r = await categorizeTransactions(config, zoho as never, state);
  check(
    "no transfer created for Home Depot purchase",
    (zoho as MockZoho).transfers.length === 0,
    `transfers=${JSON.stringify((zoho as MockZoho).transfers)}`
  );
  check(
    "no journal posted for unmatched purchase (left pending)",
    (zoho as MockZoho).journals.length === 0
  );
  check(
    "uncategorized flag raised",
    r.flagsRaised.some((f) => f.type === "uncategorized")
  );
  // A real EXAMPLE CARD payment on Operating Checking SHOULD still transfer.
  const zoho2 = new MockZoho() as never;
  const state2 = new BookkeeperState(":memory:");
  (zoho2 as MockZoho).txns = [
    txn("t2", "EXAMPLE CARD MOBILE PMT", -2000, "Operating Checking"),
  ];
  const r2 = await categorizeTransactions(config, zoho2 as never, state2);
  check(
    "genuine Capital One payment still creates transfer",
    (zoho2 as MockZoho).transfers.length === 1,
    `transfers=${(zoho2 as MockZoho).transfers.length}`
  );
  void r2;
  state.close();
  state2.close();
}

// ---------- Bug 3: refunds posted in the right direction ----------
console.log("Bug 3: refund direction");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).txns = [txn("t3", "EXAMPLE UTILITY REFUND", 100)];
  await categorizeTransactions(config, zoho as never, state);
  const j = (zoho as MockZoho).journals[0];
  check("one journal created", (zoho as MockZoho).journals.length === 1);
  const bankLine = j?.lines.find((l) => l.accountName === "Property Card");
  const utilLine = j?.lines.find((l) => l.accountName === "Utilities");
  check("refund debits the bank", bankLine?.debit === 100, JSON.stringify(j?.lines));
  check("refund credits Utilities (rental share)", utilLine?.credit === 50.6, JSON.stringify(j?.lines));
  // Normal purchase direction still works.
  const zoho2 = new MockZoho() as never;
  const state2 = new BookkeeperState(":memory:");
  (zoho2 as MockZoho).txns = [txn("t3b", "EXAMPLE UTILITY", -200)];
  await categorizeTransactions(config, zoho2 as never, state2);
  const j2 = (zoho2 as MockZoho).journals[0];
  const bankLine2 = j2?.lines.find((l) => l.accountName === "Property Card");
  check("purchase credits the bank", bankLine2?.credit === 200, JSON.stringify(j2?.lines));
  state.close();
  state2.close();
}

// ---------- Bug 4: review-required items do not post ----------
console.log("Bug 4: over-threshold does not post");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).txns = [txn("t4", "HOME DEPOT STORE #1234", -3000)];
  const r = await categorizeTransactions(config, zoho as never, state);
  check(
    "amount-threshold flag raised",
    r.flagsRaised.some((f) => f.type === "amount-threshold")
  );
  check(
    "no journal posted",
    (zoho as MockZoho).journals.length === 0,
    `journals=${(zoho as MockZoho).journals.length}`
  );
  check(
    "transaction NOT marked processed (retryable)",
    !state.isProcessed("t4")
  );
  state.close();
}

// ---------- Bug 7: flagged transactions retry, no duplicate flags ----------
console.log("Bug 7: pending retry without duplicate flags");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).txns = [txn("t7", "MYSTERY VENDOR LLC", -50)];
  const r1 = await categorizeTransactions(config, zoho as never, state);
  const r2 = await categorizeTransactions(config, zoho as never, state);
  check("first run flags once", r1.flagsRaised.length === 1, `flags=${r1.flagsRaised.length}`);
  check(
    "second run raises no duplicate flag",
    r2.flagsRaised.length === 0,
    `flags=${r2.flagsRaised.length}`
  );
  check("second run skips pending txn", r2.skipped.includes("t7"));
  // Resolve the flag -> txn requeues and processes again.
  const flag = r1.flagsRaised[0]!;
  state.resolveFlagAndRequeue(flag.id, "owner categorized manually");
  check("flag resolved", state.getOpenFlags(config.company.name).length === 0);
  check("txn requeued", !state.isProcessed("t7"));
  state.close();
}

// ---------- Bug 10: flexible bank-name matching ----------
console.log("Bug 10: mortgage pattern matches 'Operating Checking'");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).txns = [
    txn("t10", "EXAMPLE MORTGAGE PAYMENT", -5777.12, "Operating Checking", "2026-09-05"),
  ];
  const mortgageConfig = structuredClone(config);
  mortgageConfig.categorizationPatterns.find((p) => p.action === "mortgageSplitJournal")!.expectedAmount = 5777.12;
  const r = await categorizeTransactions(mortgageConfig, zoho as never, state);
  const sawUncategorized = r.flagsRaised.some((f) => f.type === "uncategorized");
  const sawAmortFlag = r.flagsRaised.some(
    (f) => f.type === "checklist-blocked" && f.title.includes("statement evidence")
  );
  check(
    "pattern matched (not uncategorized)",
    !sawUncategorized,
    `flags=${r.flagsRaised.map((f) => f.type)}`
  );
  check(
    "missing amortization data flagged (not silently posted)",
    sawAmortFlag
  );
  check(
    "no journal posted without amortization data",
    (zoho as MockZoho).journals.length === 0
  );
  state.close();
}

// ---------- Bug 2: close requires evidence ----------
console.log("Bug 2: close blocked without evidence");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).pl = { "Rental Income": 4000 };
  const report = await runMonthlyClose(config, zoho as never, state, {
    year: 2026,
    month: 9,
    statementBalances: {}, // no evidence
    rentReceived: { "unit-down": 2000, "unit-up": 2000 },
    asOfDay: 15,
  });
  const byId = new Map(report.steps.map((s) => [s.stepId, s]));
  for (const id of [
    "td-reconciled",
    "quicksilver-reconciled",
    "mortgage-split",
    "mortgage-tieout",
    "escrow-recorded",
    "escrow-tieout",
  ]) {
    check(`step ${id} is blocked`, byId.get(id)?.status === "blocked",
      `status=${byId.get(id)?.status}`);
  }
  check("close is NOT complete", report.complete === false);
  state.close();
}

// ---------- Bug 5: rerunning a close does not crash ----------
console.log("Bug 5: close rerun is safe");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).pl = { "Rental Income": 4000 };
  const base = {
    year: 2026,
    month: 9,
    statementBalances: {},
    rentReceived: { "unit-down": 2000, "unit-up": 2000 },
    asOfDay: 15,
  };
  let threw = "";
  try {
    await runMonthlyClose(config, zoho as never, state, base);
    await runMonthlyClose(config, zoho as never, state, base);
  } catch (e) {
    threw = String((e as Error)?.message ?? e);
  }
  check("second close run does not throw", threw === "", threw);
  const saved = state.getCloseRun(config.company.name, 2026, 9);
  check("latest run retrievable", saved !== undefined);
  state.close();
}

// ---------- Bug 6: escalation timestamps ----------
console.log("Bug 6: notification timestamps drive escalation");
{
  const state = new BookkeeperState(":memory:");
  const flag: Flag = {
    id: "f-esc-1",
    createdAt: new Date().toISOString(),
    companyName: config.company.name,
    status: "open",
    escalationLevel: 0,
    type: "uncategorized",
    severity: "warning",
    title: "Test flag",
    detail: "Escalation test",
  };
  state.saveFlag(flag);
  const payload = buildFlagNotification(config, [flag], state);
  check("payload built", payload !== undefined);
  check("generation alone is not delivery", !state.getFlag(flag.id)!.lastNotifiedAt);
  state.confirmDelivery(payload!.deliveryId!, config.company.name, "Test Muse delivery");
  const stored = state.getOpenFlags(config.company.name)[0]!;
  check("lastNotifiedAt recorded", !!stored.lastNotifiedAt,
    `lastNotifiedAt=${stored.lastNotifiedAt}`);
  // 25h later -> email escalation.
  const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const escalated = pendingEscalations(config, state, later);
  check(
    "escalates to email after 25h",
    escalated.length === 1 && escalated[0]!.channel === "email",
    `got ${escalated.length} payload(s)`
  );
  state.close();
}

// ---------- Bug 8: past-period rent has no fresh grace ----------
console.log("Bug 8: overdue rent flagged for past period");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  const now = new Date();
  // Two months ago is definitely a past period.
  const past = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const r = await reconcile(config, zoho as never, state, {
    statementBalances: {},
    rentReceived: { "unit-down": 2000, "unit-up": 0 }, // UP paid nothing
    asOfDay: 1, // run date is the 1st...
    periodYear: past.getFullYear(),
    periodMonth: past.getMonth() + 1, // ...but closing a past month
  });
  check(
    "Unit UP shortfall flagged (no fresh grace)",
    r.flagsRaised.some(
      (f) => f.type === "rent-missing" && f.title.includes("Unit UP")
    ),
    `flags=${r.flagsRaised.map((f) => f.title)}`
  );
  state.close();
}

// ---------- Bug 9: as-of date reaches balance queries ----------
console.log("Bug 9: asOfDate threaded to balance queries");
{
  const zoho = new MockZoho() as never;
  const state = new BookkeeperState(":memory:");
  (zoho as MockZoho).balances["Operating Checking"] = 12345.67;
  await reconcile(config, zoho as never, state, {
    statementBalances: { "Operating Checking": 12345.67 },
    rentReceived: { "unit-down": 2000, "unit-up": 2000 },
    asOfDay: 30,
    asOfDate: "2026-09-30",
  });
  check(
    "balance query received asOfDate",
    (zoho as MockZoho).seenAsOf.includes("2026-09-30"),
    `seen=${JSON.stringify((zoho as MockZoho).seenAsOf)}`
  );
  state.close();
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
