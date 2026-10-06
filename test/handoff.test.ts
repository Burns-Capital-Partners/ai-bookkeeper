import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BookkeeperState, transactionFingerprint } from "../src/db.js";
import { categorizeTransactions } from "../src/categorizer.js";
import { exportPending, importInbox, validateMonthlyEvidence, type MonthlyEvidence } from "../src/handoff.js";
import type { BankTransaction, CompanyConfig, JournalEntry } from "../src/types.js";
import type { ZohoBooksClient } from "../src/zoho.js";

const template = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
function fixture(t: TestContext, transactions: BankTransaction[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "bookkeeper-handoff-"));
  const state = new BookkeeperState(join(directory, "state.db"));
  t.after(() => state.close());
  const config = structuredClone(template), journals: JournalEntry[] = [];
  const zoho = { listBankTransactions: async () => transactions, matchBankTransaction: async () => {},
    checkSourceForPosting: async () => {}, checkStatementSourceForPosting: async () => {}, getBankTransaction: async (source: BankTransaction) => source,
    verifyExistingJournal: async (_entry: JournalEntry, id: string) => id,
    createJournal: async (entry: JournalEntry) => { journals.push(entry); return `journal-${journals.length}`; } } as unknown as ZohoBooksClient;
  const write = (value: unknown, name = "input.json") => writeFileSync(join(directory, name), JSON.stringify(value));
  return { directory, state, config, journals, transactions, zoho, write,
    run: () => categorizeTransactions(config, zoho, state), import: () => importInbox(config, state, directory) };
}
function transaction(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return { transactionId: "source", accountName: "Operating Checking", date: "2026-09-08", amount: -100,
    description: "NEW PROPERTY VENDOR", status: "uncategorized", ...overrides };
}
function decision(txn: BankTransaction, extra = {}) {
  return { version: 1, kind: "decision", id: "answer-1", organizationId: template.company.zohoOrgId,
    reviewer: "Owner via Muse", ownerMessage: "That vendor repaired the downstairs unit. It is entirely rental.",
    transactionId: txn.transactionId, fingerprint: transactionFingerprint(txn), decision: "categorize",
    action: "splitExpense", accountKey: "repairsMaintenance", rentalShare: 1, ...extra };
}
function statement(extra = {}): MonthlyEvidence {
  return { version: 1, kind: "monthly-evidence", id: "statement-1", organizationId: template.company.zohoOrgId,
    period: "2026-09", source: "Test fixture Example Mortgage statement", reviewer: "Muse", note: "Actual payment breakdown extracted",
    mortgagePayments: [{ id: "freedom-september-payment", date: "2026-09-08", amount: 5700, principal: 900, interest: 2800, escrow: 2000 }], ...extra };
}

test("Muse answer posts the source and learns a future exact vendor rule", async t => {
  const txn = transaction(); const f = fixture(t, [txn]);
  await f.run(); f.write(decision(txn));
  assert.deepEqual(f.import().accepted, ["answer-1"]);
  await f.run();
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === "Repairs and Maintenance")!.debit, 100);
  f.transactions.push(transaction({ transactionId: "later", date: "2026-09-20", amount: -500 }));
  await f.run();
  assert.equal(f.journals.length, 2);
  assert.deepEqual(f.import().unchanged, ["answer-1"]);
});

test("learned rules retain threshold review for large new transactions", async t => {
  const txn = transaction(); const f = fixture(t, [txn]);
  await f.run(); f.write(decision(txn)); f.import(); await f.run();
  f.transactions.push(transaction({ transactionId: "large", date: "2026-09-20", amount: -4000 }));
  assert.ok((await f.run()).flagsRaised.some(flag => flag.type === "amount-threshold"));
  assert.equal(f.journals.length, 1);
});

test("stale source decisions are rejected and have no rule side effects", async t => {
  const txn = transaction(); const f = fixture(t, [txn]); await f.run();
  const stale = decision(txn); txn.amount = -101; await f.run();
  f.write(stale);
  assert.equal(f.import().errors.length, 1);
  assert.equal(f.state.getLearnedRules(f.config.company.name).length, 0);
  assert.equal(f.journals.length, 0);
});

test("an incomplete file cannot partially apply a decision", async t => {
  const f = fixture(t); writeFileSync(join(f.directory, "incomplete.json"), '{"version":1,');
  assert.equal(f.import().errors.length, 1);
  assert.equal(f.state.getLearnedRules(f.config.company.name).length, 0);
});

test("accepted message IDs cannot be reused with modified content", async t => {
  const txn = transaction(); const f = fixture(t, [txn]); await f.run();
  f.write(decision(txn)); assert.equal(f.import().accepted.length, 1);
  f.write(decision(txn, { rentalShare: 0 }));
  assert.match(f.import().errors[0]!.error, /different content/);
});

test("a commingled Venmo answer identifies owner funding without learning all Venmo deposits", async t => {
  const txn = transaction({ description: "VENMO CASHOUT", amount: 1000 }); const f = fixture(t, [txn]);
  await f.run(); f.write(decision(txn, { action: "ownerContribution" })); assert.equal(f.import().errors.length, 0); await f.run();
  f.transactions.push(transaction({ transactionId: "personal", date: "2026-09-20", description: "VENMO CASHOUT", amount: 200 }));
  const next = await f.run();
  assert.equal(f.journals.length, 1);
  assert.ok(next.flagsRaised.some(flag => flag.type === "venmo-ask"));
  assert.equal(f.journals[0]!.lines.find(line => line.accountName === "Owner Contributions")!.credit, 1000);
});

test("an exact statement payment supplies the mortgage split and recurring threshold exception", async t => {
  const txn = transaction({ description: "EXAMPLE MORTGAGE PAYMENT", amount: -5700 }); const f = fixture(t, [txn]);
  await f.run(); assert.equal(f.journals.length, 0);
  f.write(statement()); assert.equal(f.import().accepted.length, 1);
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === "Mortgage Interest Paid")!.debit, 1416.8);
  assert.ok(!f.state.getOpenFlags(f.config.company.name).some(flag => flag.type === "amount-threshold"));
});

test("one mortgage statement payment cannot authorize two bank debits", async t => {
  const first = transaction({ description: "EXAMPLE MORTGAGE PAYMENT", amount: -5700 });
  const f = fixture(t, [first, { ...first, transactionId: "second", date: "2026-09-13" }]);
  f.write(statement()); f.import(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.equal(f.state.isProcessed("second"), false);
});

test("a used mortgage breakdown cannot be replaced, but other monthly evidence can be added", async t => {
  const txn = transaction({ description: "EXAMPLE MORTGAGE PAYMENT", amount: -5700 }); const f = fixture(t, [txn]);
  f.write(statement()); f.import(); await f.run();
  f.write(statement({ id: "bank-evidence", mortgagePayments: undefined, statementBalances: { "Operating Checking": 1234 } }), "bank.json");
  assert.equal(f.import().errors.length, 0);
  const changed = statement({ id: "changed-statement" }); changed.mortgagePayments![0]!.principal = 1000; changed.mortgagePayments![0]!.interest = 2700;
  f.write(changed, "changed.json");
  assert.match(f.import().errors[0]!.error, /cannot be changed/);
});

test("invalid mortgage arithmetic, dates, and organization are rejected", () => {
  for (const v of [statement({ organizationId: "other" }), statement({ period: "2026-13" }),
    statement({ mortgagePayments: [{ ...statement().mortgagePayments![0], amount: 5701 }] }),
    statement({ mortgagePayments: [{ ...statement().mortgagePayments![0], date: "2026-09-31" }] })]) {
    assert.throws(() => validateMonthlyEvidence(v, template));
  }
});

test("pending handoff exposes source fingerprints and owner-readable rules", async t => {
  const txn = transaction(); const f = fixture(t, [txn]); await f.run();
  const path = join(f.directory, "export", "pending.json"); exportPending(f.config, f.state, path);
  const pending = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(pending.organizationId, template.company.zohoOrgId);
  assert.equal(pending.flags[0].fingerprint, transactionFingerprint(txn));
  assert.equal(pending.flags[0].source.transactionId, txn.transactionId);
});

function escrow(extra = {}) {
  return { version: 1, kind: "escrow-disbursement", id: "escrow-packet", organizationId: template.company.zohoOrgId,
    sourceTransactionId: "freedom-tax-2026-09", date: "2026-09-15", amount: 1000, description: "Village tax disbursement",
    accountKey: "propertyTaxes", source: "Fixture Example Mortgage statement", reviewer: "Muse", note: "Actual paid disbursement", ...extra };
}
test("statement escrow disbursement posts rental share once without touching the bank feed", async t => {
  const f = fixture(t); f.write(escrow()); assert.equal(f.import().errors.length, 0);
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.deepEqual(f.journals[0]!.lines, [{ accountName: "Property Taxes", debit: 506 }, { accountName: "Mortgage Escrow", credit: 506 }]);
  assert.deepEqual(f.state.pendingBankMatches(f.config.company.name), []);
});
test("large statement disbursement keeps exact-source amount review", async t => {
  const f = fixture(t); f.write(escrow({ amount: 3000 })); f.import();
  const result = await f.run(); assert.equal(f.journals.length, 0);
  assert.ok(result.flagsRaised.some(flag => flag.type === "amount-threshold"));
});
test("a verified existing statement journal is preserved without another write", async t => {
  const f = fixture(t); f.write(escrow({ existingJournalId: "123456", amount: 3000 })); f.import();
  const result = await f.run(); assert.equal(f.journals.length, 0); assert.equal(result.journalsCreated.length, 0);
  assert.equal(f.state.getPosting(f.config.company.name, "escrow:freedom-tax-2026-09")?.remoteId, "123456");
});
test("statement corrections cannot replace a posted disbursement", async t => {
  const f = fixture(t); f.write(escrow()); f.import(); await f.run();
  f.write(escrow({ id: "changed", amount: 1100 }), "changed.json");
  assert.match(f.import().errors[0]!.error, /different content/);
  assert.equal(f.journals.length, 1);
});
test("answering a blank bank description cannot create a match-all learned rule", async t => {
  const txn = transaction({ description: "" }), f = fixture(t, [txn]);
  await f.run(); f.write(decision(txn)); f.import(); await f.run();
  f.transactions.push(transaction({ transactionId: "unrelated", date: "2026-09-25", description: "OTHER VENDOR" }));
  await f.run(); assert.equal(f.journals.length, 1);
});

function venmo(extra = {}) {
  return { version: 1, kind: "venmo-rent-receipt", id: "receipt-1", organizationId: template.company.zohoOrgId,
    sourceTransactionId: "provider-receipt-1", date: "2026-09-10", amount: 1000, unitId: "unit-up", payerName: "Sample Tenant D",
    source: "Fixture personal Venmo receipt", reviewer: "Muse", note: "Verified actual tenant payment", ...extra };
}
test("personal Venmo receipt recognizes rent once before any bank cashout", async t => {
  const f = fixture(t); f.write(venmo()); assert.equal(f.import().errors.length, 0);
  await f.run(); await f.run();
  assert.equal(f.journals.length, 1);
  assert.equal(f.journals[0]!.date, "2026-09-10");
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === "Owner Draws")!.debit, 1000);
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === "Rental Income")!.credit, 1000);
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === "Rental Income")!.customerId, template.units[1]!.customerId);
  assert.deepEqual(f.state.pendingBankMatches(f.config.company.name), []);
});
test("existing Venmo rent keeps both unit tags and is reused on the rerun", async t => {
  const f = fixture(t); let verified = 0;
  f.zoho.verifyExistingJournal = async (entry, id) => {
    verified++;
    assert.equal(id, "123456");
    assert.deepEqual(entry.lines.map(line => [line.accountName, line.debit, line.credit, line.customerId]), [
      ["Owner Draws", 1000, undefined, template.units[1]!.customerId],
      ["Rental Income", undefined, 1000, template.units[1]!.customerId],
    ]);
    return id;
  };
  f.write(venmo({ existingJournalId: "123456" }));
  assert.deepEqual(f.import().errors, []);
  const first = await f.run(), second = await f.run();
  assert.equal(verified, 1);
  assert.equal(f.journals.length, 0);
  assert.deepEqual(first.journalsCreated, []);
  assert.deepEqual(second.journalsCreated, []);
  assert.deepEqual(first.pending, []);
  assert.deepEqual(second.pending, []);
  assert.equal(f.state.getPosting(f.config.company.name, "venmo:provider-receipt-1")?.remoteId, "123456");
});
test("later Venmo cashout is owner funding and cannot be counted as rent again", async t => {
  const cashout = transaction({ transactionId: "cashout", date: "2026-09-12", description: "VENMO CASHOUT", amount: 1000 });
  const f = fixture(t, [cashout]); f.write(venmo()); f.import(); await f.run();
  f.write(decision(cashout, { id: "wrong-answer", action: "rentalIncome", unitId: "unit-up" }), "wrong.json");
  assert.match(f.import().errors[0]!.error, /counting rent twice/);
  f.write(decision(cashout, { id: "funding-answer", action: "ownerContribution" }), "right.json"); f.import(); await f.run();
  assert.equal(f.journals.length, 2);
  assert.equal(f.journals.flatMap(j => j.lines).filter(l => l.accountName === "Rental Income").reduce((sum, l) => sum + (l.credit ?? 0), 0), 1000);
  assert.equal(f.journals[1]!.lines.find(l => l.accountName === "Owner Contributions")!.credit, 1000);
});
test("unfamiliar Venmo payers cannot become rent without a configured identity", t => {
  const f = fixture(t); f.write(venmo({ payerName: "Someone else" }));
  assert.match(f.import().errors[0]!.error, /configured tenant/);
  assert.deepEqual(f.state.getStatementTransactions(), []);
});
