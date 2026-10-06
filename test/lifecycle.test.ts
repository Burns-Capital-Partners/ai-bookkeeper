import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { BookkeeperState } from "../src/db.js";
import { categorizeTransactions } from "../src/categorizer.js";
import { runMonthlyClose, type CloseInputs } from "../src/closer.js";
import { reconcile } from "../src/reconciler.js";
import { buildFlagNotification, buildCloseNotification, pendingEscalations } from "../src/notifier.js";
import type { BankTransaction, CompanyConfig, JournalEntry } from "../src/types.js";
import { ExistingBankMatchError, type ZohoBooksClient } from "../src/zoho.js";

const template = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
test("a possible manual posting is held without creating an uncertain write claim", async t => {
  const f = setup(t, [txn()]); f.client.checkSourceForPosting = async () => { throw new ExistingBankMatchError(); };
  const result = await f.run(); assert.equal(f.journals.length, 0);
  assert.equal(f.state.getPosting(f.config.company.name, "test-1"), undefined);
  assert.ok(result.flagsRaised.some(flag => flag.type === "existing-match"));
  f.client.getBankTransaction = async source => ({ ...source, status: "categorized" });
  await f.run();
  assert.equal(f.state.isProcessed("test-1"), true);
  assert.equal(f.state.getOpenFlags(f.config.company.name).length, 0);
});
test("wrong-sign mortgage balance cannot pass reconciliation", async t => {
  const f = setup(t); f.balances["Mortgage Payable"] = -303600;
  const report = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  assert.equal(report.complete, false); assert.ok(report.flagsRaised.some(f => f.title === "Mortgage Payable tie-out failed"));
});
test("a later-period exception does not block an earlier month close", async t => {
  const f = setup(t, [txn({ date: "2026-10-03", description: "Unknown vendor" })]);
  await f.run(); f.client.listBankTransactions = async () => [];
  assert.equal((await runMonthlyClose(f.config, f.zoho, f.state, inputs())).complete, true);
});
type Transfer = Parameters<ZohoBooksClient["createTransfer"]>[0];
function setup(t: TestContext, transactions: BankTransaction[] = [], dbPath = ":memory:") {
  const config = structuredClone(template);
  const state = new BookkeeperState(dbPath);
  let closed = false;
  const close = () => { if (!closed) { state.close(); closed = true; } };
  t.after(close);
  const journals: JournalEntry[] = [], transfers: Transfer[] = [], reads: unknown[][] = [];
  const balances: Record<string, number> = { "Operating Checking": 10000, "Property Card": 0, "Mortgage Payable": 303600, "Mortgage Escrow": 5060 };
  const client = {
    matchBankTransaction: async () => {},
    checkSourceForPosting: async () => {},
    getBankTransaction: async (source: BankTransaction) => source,
    listBankTransactions: async () => transactions,
    createJournal: async (entry: JournalEntry) => { journals.push(entry); return `journal-${journals.length}`; },
    createTransfer: async (entry: Transfer) => { transfers.push(entry); return `transfer-${transfers.length}`; },
    getAccountBalance: async (name: string, asOf?: string) => { reads.push([name, asOf]); return balances[name] ?? 0; },
    getLedgerBalance: async (name: string, asOf?: string) => { reads.push([name, asOf]); return balances[name] ?? 0; },
    getProfitAndLoss: async () => ({ "Rental Income": 4000 }),
  };
  const zoho = client as unknown as ZohoBooksClient;
  return { config, state, client, zoho, journals, transfers, reads, balances, close,
    run: () => categorizeTransactions(config, zoho, state) };
}
function txn(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return { transactionId: "test-1", date: "2026-09-15", description: "EXAMPLE UTILITY", amount: -100,
    accountName: "Operating Checking", status: "uncategorized", ...overrides };
}
function inputs(overrides: Partial<CloseInputs> = {}): CloseInputs {
  return { year: 2026, month: 9, asOfDay: 30,
    statementBalances: { "Operating Checking": 10000, "Property Card": 0 },
    freedomLoanBalance: 600000, freedomEscrowBalance: 10000,
    rentReceived: { "unit-down": 2000, "unit-up": 2000 },
    manualReview: { period: "2026-09", reviewer: "Test reviewer", note: "Source records checked",
      steps: ["import-complete", "mortgage-split", "escrow-recorded", "owner-accounts-reviewed"] }, ...overrides };
}
function transferPair(): BankTransaction[] {
  return [txn({ transactionId: "source", description: "EXAMPLE CARD MOBILE PMT", amount: -1000 }),
    txn({ transactionId: "counterpart", description: "EXAMPLE CARD PAYMENT", amount: 1000, accountName: "Property Card" })];
}

test("sequential runs preserve one balanced expense posting", async t => {
  const f = setup(t, [txn()]);
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.equal(f.journals[0]!.lines.reduce((n, l) => n + (l.debit ?? 0) - (l.credit ?? 0), 0), 0);
});
test("receipt resolution and direct requeue preserve a successful posting", async t => {
  const f = setup(t, [txn()]);
  const first = await f.run();
  const receipt = first.flagsRaised.find(f => f.type === "needs-receipt")!;
  f.state.resolveFlagAndRequeue(receipt.id, "Receipt attached");
  f.state.requeueTransaction("test-1");
  await f.run();
  assert.equal(f.journals.length, 1);
  assert.ok(f.state.isProcessed("test-1"));
});
test("amount approval authorizes one posting and persists across restart", async t => {
  const path = join(mkdtempSync(join(tmpdir(), "bookkeeper-approval-")), "state.db");
  const f = setup(t, [txn({ amount: -3000 })], path);
  const first = await f.run();
  f.state.approveFlag(first.flagsRaised[0]!.id, "Reviewer", "Amount verified");
  f.close();
  const resumed = setup(t, [txn({ amount: -3000 })], path);
  await resumed.run(); await resumed.run();
  assert.equal(resumed.journals.length, 1);
});
test("acknowledging or resolving a threshold flag is not posting approval", async t => {
  const f = setup(t, [txn({ amount: -3000 })]);
  const first = await f.run();
  f.state.updateFlag(first.flagsRaised[0]!.id, { status: "acknowledged" });
  await f.run();
  f.state.resolveFlagAndRequeue(first.flagsRaised[0]!.id, "Acknowledged only");
  const next = await f.run();
  assert.equal(f.journals.length, 0);
  assert.ok(next.flagsRaised.some(f => f.type === "amount-threshold"));
});
test("a changed transaction invalidates its earlier approval", async t => {
  const transaction = txn({ amount: -3000 });
  const f = setup(t, [transaction]);
  const first = await f.run();
  f.state.approveFlag(first.flagsRaised[0]!.id, "Reviewer", "3000 approved");
  transaction.amount = -4000;
  const next = await f.run();
  assert.equal(f.journals.length, 0);
  assert.equal(next.flagsRaised.find(f => f.type === "amount-threshold")!.amount, 4000);
});
test("a changed pending transaction receives a current flag and rejects stale approval", async t => {
  const transaction = txn({ amount: -3000 });
  const f = setup(t, [transaction]);
  const first = await f.run();
  transaction.amount = -4000;
  const next = await f.run();
  assert.throws(() => f.state.approveFlag(first.flagsRaised[0]!.id, "Reviewer", "Old amount"));
  assert.equal(next.flagsRaised[0]!.amount, 4000);
});
test("only an explicit exact recurring amount bypasses threshold review", async t => {
  const transaction = txn({ description: "EXAMPLE RENT PAYMENT", amount: 50000 });
  const f = setup(t, [transaction]);
  assert.ok((await f.run()).flagsRaised.some(f => f.type === "amount-threshold"));
  assert.equal(f.journals.length, 0);
  const exact = setup(t, [txn({ description: "EXAMPLE RENT PAYMENT", amount: 4000 })]);
  exact.config.categorizationPatterns.find(p => p.action === "rentalIncome")!.expectedAmount = 4000;
  await exact.run();
  assert.equal(exact.journals.length, 1);
  const different = setup(t, [txn({ description: "EXAMPLE RENT PAYMENT", amount: 4000.01 })]);
  different.config.categorizationPatterns.find(p => p.action === "rentalIncome")!.expectedAmount = 4000;
  await different.run();
  assert.equal(different.journals.length, 0);
});
test("a recurring rent reversal cannot inherit the credit exception", async t => {
  const f = setup(t, [txn({ description: "EXAMPLE RENT PAYMENT", amount: -4000 })]);
  f.config.categorizationPatterns.find(p => p.action === "rentalIncome")!.expectedAmount = 4000;
  await f.run();
  assert.equal(f.journals.length, 0);
});
test("duplicate-looking records require their own approval, including across runs", async t => {
  const records = [txn({ transactionId: "original" })];
  const f = setup(t, records);
  await f.run();
  records.push(txn({ transactionId: "candidate", date: "2026-09-16" }));
  const next = await f.run();
  const duplicate = next.flagsRaised.find(f => f.type === "duplicate")!;
  assert.ok(duplicate);
  assert.equal(f.journals.length, 1);
  f.state.approveFlag(duplicate.id, "Reviewer", "Confirmed two distinct utility payments");
  await f.run(); await f.run();
  assert.equal(f.journals.length, 2);
});
test("overlap on separate SQLite connections produces one external write", async t => {
  const path = join(mkdtempSync(join(tmpdir(), "bookkeeper-overlap-")), "state.db");
  const f = setup(t, [txn()], path);
  const second = new BookkeeperState(path); t.after(() => second.close());
  await Promise.all([f.run(), categorizeTransactions(f.config, f.zoho, second)]);
  assert.equal(f.journals.length, 1);
  assert.equal(f.state.getOpenFlags(f.config.company.name).filter(f => f.type === "posting-uncertain").length, 0);
});
test("lost response holds the write across restart until remote outcome is recorded", async t => {
  const path = join(mkdtempSync(join(tmpdir(), "bookkeeper-uncertain-")), "state.db");
  const f = setup(t, [txn()], path);
  f.client.createJournal = async entry => { f.journals.push(entry); throw new Error("Response lost after remote acceptance"); };
  const first = await f.run();
  assert.ok(first.flagsRaised.some(f => f.type === "posting-uncertain"));
  assert.match(f.journals[0]!.referenceNumber!, /^bk-/);
  f.close();
  const resumed = setup(t, [txn()], path);
  await resumed.run();
  assert.equal(resumed.journals.length, 0);
  resumed.state.recoverPosting(resumed.config.company.name, "test-1", { remoteId: "existing-journal" }, "Reviewer", "Verified reference in Zoho");
  await resumed.run();
  assert.equal(resumed.journals.length, 0);
  assert.ok(resumed.state.isProcessed("test-1"));
});
test("verified no-write recovery permits one retry using the same remote reference", async t => {
  const f = setup(t, [txn()]);
  const original = f.client.createJournal;
  f.client.createJournal = async () => { throw new Error("Connection failed"); };
  await f.run();
  const reference = f.state.getPosting(f.config.company.name, "test-1")!.reference;
  f.state.recoverPosting(f.config.company.name, "test-1", { confirmedNotPosted: true }, "Reviewer", "No matching remote record");
  f.client.createJournal = original;
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.equal(f.journals[0]!.referenceNumber, reference);
});
test("a crash with a pending claim never results in an automatic retry", async t => {
  const f = setup(t, [txn()]);
  f.state.observeTransaction(f.config.company.name, txn());
  f.state.claimPosting(f.config.company.name, txn(), "split-expense", "bk-crash", {});
  await f.run();
  assert.equal(f.journals.length, 0);
  assert.equal(f.state.getPosting(f.config.company.name, "test-1")!.status, "pending");
});
for (const reverse of [false, true]) test(`both transfer sides create one transfer (reverse=${reverse})`, async t => {
  const pair = transferPair();
  const f = setup(t, reverse ? pair.reverse() : pair);
  await f.run(); await f.run();
  assert.equal(f.transfers.length, 1);
  assert.ok(f.state.isProcessed("source"));
  assert.ok(f.state.isProcessed("counterpart"));
});
test("counterpart arriving before source is held, then matched without another transfer", async t => {
  const pair = transferPair(), records = [pair[1]!];
  const f = setup(t, records);
  assert.ok((await f.run()).flagsRaised.some(f => f.type === "transfer-counterpart"));
  assert.equal(f.transfers.length, 0);
  records.push(pair[0]!);
  await f.run();
  assert.equal(f.transfers.length, 1);
  assert.equal(f.state.getOpenFlags(f.config.company.name).length, 0);
});
test("two eligible source payments leave an ambiguous counterpart for review", async t => {
  const pair = transferPair();
  const f = setup(t, [pair[0]!, { ...pair[0]!, transactionId: "second-source", description: "EXAMPLE CARD MOBILE PMT SECOND" }, pair[1]!]);
  const result = await f.run();
  assert.equal(f.transfers.length, 2);
  assert.ok(result.flagsRaised.some(f => f.type === "transfer-counterpart"));
  assert.ok(!f.state.isProcessed("counterpart"));
});
test("a credit on the transfer source account cannot create an outgoing payment", async t => {
  const f = setup(t, [txn({ description: "EXAMPLE CARD REFUND", amount: 1000 })]);
  await f.run();
  assert.equal(f.transfers.length, 0);
});
for (const [year, month] of [[2024, 2], [2025, 2], [2025, 4], [2025, 12]] as const) {
  test(`missing rent in historical ${year}-${month} has no renewed grace`, async t => {
    const f = setup(t);
    const report = await reconcile(f.config, f.zoho, f.state, { statementBalances: {},
      rentReceived: { "unit-down": 2000, "unit-up": 0 }, asOfDay: 1, periodYear: year, periodMonth: month });
    assert.ok(report.flagsRaised.some(f => f.type === "rent-missing"));
  });
}
test("close requires period-specific manual evidence", async t => {
  const f = setup(t);
  const report = await runMonthlyClose(f.config, f.zoho, f.state, inputs({ manualReview: undefined }));
  assert.equal(report.complete, false);
  assert.equal(report.steps.find(s => s.stepId === "owner-accounts-reviewed")!.status, "blocked");
  const stale = inputs(); stale.manualReview!.period = "2026-08";
  assert.equal((await runMonthlyClose(f.config, f.zoho, f.state, stale)).complete, false);
});
test("close flag IDs agree with persisted state and reruns do not multiply blockers", async t => {
  const f = setup(t);
  const missing = inputs({ statementBalances: {}, freedomLoanBalance: undefined, freedomEscrowBalance: undefined, manualReview: undefined });
  const first = await runMonthlyClose(f.config, f.zoho, f.state, missing);
  const again = await runMonthlyClose(f.config, f.zoho, f.state, missing);
  const stored = f.state.getOpenFlags(f.config.company.name);
  assert.equal(stored.length, first.flagsRaised.length);
  const notification = buildCloseNotification(f.config, again, f.state);
  assert.deepEqual(notification.flagIds.sort(), stored.map(f => f.id).sort());
  for (const step of again.steps.filter(s => s.status === "blocked")) assert.equal(step.flagIds.length, 1);
  const complete = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  assert.equal(complete.complete, true);
  assert.equal(f.state.getOpenFlags(f.config.company.name).length, 0);
});
test("pending transactions stay uncategorized on later close runs", async t => {
  const f = setup(t, [txn({ description: "Unknown merchant" })]);
  await f.run();
  const close = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  assert.equal(close.steps.find(s => s.stepId === "all-categorized")!.status, "flagged");
});
test("acknowledgment stops escalation but does not complete unresolved work", async t => {
  const f = setup(t, [txn({ amount: -3000 })]);
  const first = await f.run();
  buildFlagNotification(f.config, first.flagsRaised, f.state);
  f.state.updateFlag(first.flagsRaised[0]!.id, { status: "acknowledged" });
  assert.equal(pendingEscalations(f.config, f.state, new Date(Date.now() + 25 * 3600000)).length, 0);
  assert.equal(f.state.getOpenFlags(f.config.company.name).length, 1);
  assert.equal((await runMonthlyClose(f.config, f.zoho, f.state, inputs())).complete, false);
});
test("nonfinite ledger responses fail closed", async t => {
  const f = setup(t); f.balances["Operating Checking"] = NaN;
  await assert.rejects(runMonthlyClose(f.config, f.zoho, f.state, inputs()), /Invalid numeric balance/);
});
test("nonfinite P&L balances create a persisted close blocker", async t => {
  const f = setup(t);
  f.client.getProfitAndLoss = async () => ({ "Rental Income": NaN });
  const report = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  assert.equal(report.complete, false);
  const step = report.steps.find(s => s.stepId === "pl-review")!;
  assert.equal(step.status, "blocked");
  assert.ok(report.flagsRaised.some(flag => step.flagIds.includes(flag.id)));
  assert.ok(f.state.getFlag(step.flagIds[0]!)?.detail.includes("invalid numeric balances"));
});
test("CLI provides explicit approval without requiring Zoho credentials", async t => {
  const path = join(mkdtempSync(join(tmpdir(), "bookkeeper-cli-")), "state.db");
  const f = setup(t, [txn({ amount: -3000 })], path);
  const first = await f.run();
  const result = spawnSync(process.execPath, ["dist/index.js", "review-flag", "--config", "example-property", "--flag", first.flagsRaised[0]!.id,
    "--decision", "approve", "--reviewer", "Test reviewer", "--note", "Verified amount"], {
    encoding: "utf8", env: { ...process.env, BOOKKEEPER_STATE_PATH: path },
  });
  assert.equal(result.status, 0, result.stderr);
  await f.run();
  assert.equal(f.journals.length, 1);
});

test("identifying a vendor and resolving its flag retries the unposted transaction", async t => {
  const f = setup(t, [txn({ description: "NEW UTILITY" })]);
  const first = await f.run();
  f.config.categorizationPatterns.unshift({ match: { descriptionContains: "NEW UTILITY" }, action: "splitExpense", account: "Utilities", notes: "Vendor verified" });
  f.state.resolveFlagAndRequeue(first.flagsRaised[0]!.id, "Vendor identified");
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
});
test("a missing remote posting ID is treated as uncertain, never as success", async t => {
  const f = setup(t, [txn()]);
  f.client.createJournal = async () => "";
  const result = await f.run();
  assert.ok(result.flagsRaised.some(f => f.type === "posting-uncertain"));
  assert.equal(f.state.isProcessed("test-1"), false);
});
test("close reruns retain escalation deadlines and current mismatch details", async t => {
  const f = setup(t); f.balances["Operating Checking"] = 11000;
  const first = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  const delivered = buildCloseNotification(f.config, first, f.state);
  f.state.confirmDelivery(delivered.deliveryId!, f.config.company.name, "Test delivery");
  const mismatch = first.flagsRaised.find(f => f.type === "reconciliation-mismatch")!;
  const before = new Date(Date.now() - 25 * 3600000).toISOString();
  f.state.updateFlag(mismatch.id, { lastNotifiedAt: before });
  f.balances["Operating Checking"] = 12000;
  const second = await runMonthlyClose(f.config, f.zoho, f.state, inputs());
  buildCloseNotification(f.config, second, f.state);
  assert.equal(f.state.getFlag(mismatch.id)!.lastNotifiedAt, before);
  assert.equal(f.state.getFlag(mismatch.id)!.amount, 2000);
  assert.ok(pendingEscalations(f.config, f.state).some(p => p.flagIds.includes(mismatch.id)));
});
test("same-batch duplicates are flagged without suppressing the original payment", async t => {
  const f = setup(t, [txn({ transactionId: "original" }), txn({ transactionId: "duplicate" })]);
  const result = await f.run();
  assert.equal(f.journals.length, 1);
  assert.ok(result.flagsRaised.some(f => f.type === "duplicate"));
});
test("ordinary card purchases do not require a bank receipt flag", async t => {
  const f = setup(t, [txn({ accountName: "Property Card" })]);
  const result = await f.run();
  assert.equal(result.flagsRaised.filter(f => f.type === "needs-receipt").length, 0);
});

test("bank insurance and tax payments never consume mortgage escrow", async t => {
  for (const description of ["Example Insurance", "Example County", "Example Town"]) {
    const f = setup(t, [txn({ description })]);
    await f.run();
    assert.equal(f.journals.length, 0);
    // The source guard also protects a mistakenly broad imported rule.
    f.config.categorizationPatterns.find(p => p.match.descriptionContains === description)!.match.account = undefined;
    for (const flag of f.state.getOpenFlags(f.config.company.name)) f.state.resolveFlagAndRequeue(flag.id);
    await f.run();
    assert.equal(f.journals.length, 0);
    assert.ok(f.state.getOpenFlags(f.config.company.name).some(f => f.title.includes("source needs review")));
  }
});

test("similar bank names cannot match a mortgage or transfer rule", async t => {
  const f = setup(t, [txn({ description: "EXAMPLE CARD MOBILE PMT", accountName: "Operating Bank Savings" })]);
  await f.run();
  assert.equal(f.transfers.length, 0);
  const exact = setup(t, [transferPair()[0]!]);
  await exact.run();
  assert.equal(exact.transfers[0]!.fromAccount, "Operating Checking");
});

test("a corrected source stays unposted and raises a durable review item", async t => {
  const source = txn();
  const f = setup(t, [source]);
  await f.run();
  const original = f.state.getPosting(f.config.company.name, source.transactionId)!;
  source.amount = -3000;
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  const corrections = f.state.getOpenFlags(f.config.company.name).filter(f => f.type === "posted-source-changed");
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0]!.amount, 3000);
  assert.equal(f.state.getPosting(f.config.company.name, source.transactionId)!.fingerprint, original.fingerprint);
});

test("already categorized transactions are preserved even if returned by the adapter", async t => {
  const f = setup(t, [txn({ status: "categorized" })]);
  await f.run();
  assert.equal(f.journals.length, 0);
});

test("repeated transfer counterpart claims succeed only for the same pairing", async t => {
  const pair = transferPair();
  const f = setup(t, [pair[0]!]);
  await f.run();
  const source = f.state.getPosting(f.config.company.name, "source")!;
  assert.equal(f.state.linkTransferCounterpart(f.config.company.name, source, pair[1]!), true);
  assert.equal(f.state.linkTransferCounterpart(f.config.company.name, source, pair[1]!), true);
  assert.equal(f.state.linkTransferCounterpart(f.config.company.name, source, { ...pair[1]!, transactionId: "different-payment" }), false);
});

test("unpaid rent remains visible without blocking otherwise completed bookkeeping", async t => {
  const f = setup(t);
  f.client.getProfitAndLoss = async () => ({ "Rental Income": 0 });
  const report = await runMonthlyClose(f.config, f.zoho, f.state, inputs({ rentReceived: { "unit-down": 0, "unit-up": 0 } }));
  assert.equal(report.complete, true);
  assert.equal(report.rentOutstanding, true);
  assert.equal(report.steps.find(s => s.stepId === "rent-verified")!.status, "flagged");
  assert.equal(f.state.getOpenFlags(f.config.company.name).filter(f => f.type === "rent-missing").length, 2);
  assert.match(buildCloseNotification(f.config, report).body, /Unpaid rent remains open/);
});

test("unknown rent receipts cannot be substituted with zero to complete a month", async t => {
  const f = setup(t);
  const report = await runMonthlyClose(f.config, f.zoho, f.state, inputs({ rentReceived: {} }));
  assert.equal(report.complete, false);
  assert.equal(report.steps.find(s => s.stepId === "rent-verified")!.status, "blocked");
  assert.equal(report.flagsRaised.filter(f => f.type === "rent-missing").length, 0);
});

test("an unfinished month cannot be closed or trigger posting", async t => {
  const f = setup(t, [txn()]);
  await assert.rejects(runMonthlyClose(f.config, f.zoho, f.state, inputs({ year: 9999, month: 1 })), /completed calendar month/);
  assert.equal(f.journals.length, 0);
});

test("a failed bank match survives disappearance from the uncategorized feed without creating another journal", async t => {
  const records = [txn()]; const f = setup(t, records);
  f.client.matchBankTransaction = async () => { throw new Error("Match response lost"); };
  const first = await f.run();
  assert.equal(f.journals.length, 1);
  assert.ok(first.pending.includes("test-1"));
  assert.ok(first.flagsRaised.some(flag => flag.type === "source-match"));
  records.length = 0;
  let matches = 0;
  f.client.matchBankTransaction = async () => { matches++; };
  await f.run(); await f.run();
  assert.equal(matches, 1);
  assert.equal(f.journals.length, 1);
  assert.ok(!f.state.getOpenFlags(f.config.company.name).some(flag => flag.type === "source-match"));
});

test("lost notification output remains retryable and delivery acknowledgments are idempotent", async t => {
  const f = setup(t, [txn({ amount: -3000 })]);
  await f.run();
  const first = buildFlagNotification(f.config, f.state.getOpenFlags(f.config.company.name), f.state)!;
  const retry = buildFlagNotification(f.config, f.state.getOpenFlags(f.config.company.name), f.state)!;
  assert.equal(first.deliveryId, retry.deliveryId);
  assert.equal(f.state.getOpenFlags(f.config.company.name)[0]!.lastNotifiedAt, undefined);
  assert.equal(pendingEscalations(f.config, f.state, new Date(Date.now() + 25 * 3600000)).length, 0);
  f.state.confirmDelivery(first.deliveryId!, f.config.company.name, "Muse message reference");
  const deliveredAt = f.state.getOpenFlags(f.config.company.name)[0]!.lastNotifiedAt;
  f.state.confirmDelivery(first.deliveryId!, f.config.company.name, "Repeated receipt");
  assert.equal(f.state.getOpenFlags(f.config.company.name)[0]!.lastNotifiedAt, deliveredAt);
  const next = pendingEscalations(f.config, f.state, new Date(Date.now() + 25 * 3600000));
  assert.equal(next[0]!.channel, "email");
  assert.equal(f.state.getOpenFlags(f.config.company.name)[0]!.escalationLevel, 0);
});
