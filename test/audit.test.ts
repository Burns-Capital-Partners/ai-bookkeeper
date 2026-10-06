import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BookkeeperState } from "../src/db.js";
import { acceptSourceLedger, acknowledgeAuditChange, auditSourceLedgers, compareMovements } from "../src/audit.js";
import type { CompanyConfig, JournalEntry } from "../src/types.js";
import type { LedgerMovement, ZohoBooksClient } from "../src/zoho.js";
const config = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
const source = { id: "rent", date: "2026-09-01", amount: 2000, description: "Fixture rent" };
const ledger: LedgerMovement = { id: "journal", date: source.date, amount: 2000, description: "Fixture", reference: "", journalId: "journal" };
const packet = { id: "statement", complete: true, accountName: config.accounts.tdBank!, from: "2026-09-01", to: "2026-09-30", opening: 1000, closing: 3000,
  source: "Fixture complete bank export", reviewer: "Muse fixture", rows: [source] };
test("offsetting errors and repeated equal deposits cannot pass source transaction checks", () => {
  const wrong = compareMovements([source], [{ ...ledger, amount: 3000 }, { ...ledger, id: "extra", amount: -1000 }]);
  assert.ok(wrong.issues.some(i => i.startsWith("Missing"))); assert.ok(wrong.issues.some(i => i.startsWith("Unmatched")));
  const repeated = compareMovements([source, { ...source, id: "legitimate-second" }], [ledger, { ...ledger, id: "journal-2" }]);
  assert.ok(repeated.issues.some(i => i.startsWith("Ambiguous"))); assert.equal(repeated.matches.length, 0);
  assert.equal(compareMovements([{ ...source, zohoId: ledger.id }, { ...source, id: "second", zohoId: "journal-2" }], [ledger, { ...ledger, id: "journal-2" }]).issues.length, 0);
});
test("complete source arithmetic rejects omitted activity and handles credit-card signs", t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close());
  assert.throws(() => acceptSourceLedger({ ...packet, closing: 5000 }, config, state), /does not bridge/);
  assert.throws(() => acceptSourceLedger({ ...packet, complete: false }, config, state), /complete source/);
  acceptSourceLedger({ ...packet, accountName: config.accounts.quicksilver, opening: 100, closing: 2100, rows: [{ ...source, amount: -2000 }] }, config, state);
});
test("cash tie-out and changed historical tenant tags are checked independently and retained until confirmation", async t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close()); acceptSourceLedger(packet, config, state);
  const journal: JournalEntry = { date: source.date, notes: "Fixture", lines: [{ accountName: config.accounts.tdBank!, debit: 2000 }, { accountName: config.accounts.rentalIncome!, credit: 2000, customerId: config.units[0]!.customerId }] };
  const api = { listAccountActivity: async () => [ledger], getLedgerBalance: async (_name: string, date: string) => date === "2026-08-31" ? 1000 : 3000,
    getJournalSnapshot: async () => structuredClone(journal) } as unknown as ZohoBooksClient;
  assert.equal((await auditSourceLedgers(config, state, api))[0]!.status, "verified");
  journal.lines[1]!.customerId = "";
  const changed = (await auditSourceLedgers(config, state, api))[0]!;
  assert.equal(changed.status, "discrepancy"); assert.ok(changed.issues.some(i => i.includes("Historical journal")));
  assert.equal((await auditSourceLedgers(config, state, api))[0]!.status, "discrepancy");
  acknowledgeAuditChange({ packetId: packet.id, snapshotHash: changed.snapshotHash, confirmedBy: "owner", reviewer: "Owner", ownerMessage: "I verified this metadata change." }, config, state);
  assert.equal((await auditSourceLedgers(config, state, api))[0]!.status, "verified");
});
test("a missing opening balance is a discrepancy even when closing activity matches", async t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close()); acceptSourceLedger(packet, config, state);
  const api = { listAccountActivity: async () => [{ ...ledger, journalId: undefined }], getLedgerBalance: async () => 3000 } as unknown as ZohoBooksClient;
  const result = (await auditSourceLedgers(config, state, api))[0]!;
  assert.equal(result.status, "discrepancy"); assert.ok(result.issues.some(i => i.includes("Opening balance")));
});
test("replacing a historical journal with equal cash does not silently accept a new baseline", async t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close()); acceptSourceLedger(packet, config, state);
  let id = "journal";
  const api = { listAccountActivity: async () => [{ ...ledger, id, journalId: id }],
    getLedgerBalance: async (_name: string, date: string) => date === "2026-08-31" ? 1000 : 3000,
    getJournalSnapshot: async () => ({ date: source.date, notes: "Fixture", lines: [
      { accountName: config.accounts.tdBank, debit: 2000 }, { accountName: config.accounts.rentalIncome, credit: 2000 }] }) } as unknown as ZohoBooksClient;
  assert.equal((await auditSourceLedgers(config, state, api))[0]!.status, "verified");
  id = "replacement";
  for (let i = 0; i < 2; i++) assert.ok((await auditSourceLedgers(config, state, api))[0]!.issues.some(s => s.includes("no longer in this cutoff")));
});
test("source-backed owner funding expectation rejects rent classification despite identical bank cash", async t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close());
  const expected: JournalEntry = { date: source.date, notes: "Fixture", lines: [
    { accountName: config.accounts.tdBank!, debit: 2000 }, { accountName: config.accounts.ownerContributions!, credit: 2000 }] };
  acceptSourceLedger({ ...packet, rows: [{ ...source, zohoId: ledger.id, expectedJournal: expected }] }, config, state);
  const api = { listAccountActivity: async () => [ledger], getLedgerBalance: async (_n: string, date: string) => date === "2026-08-31" ? 1000 : 3000,
    getJournalSnapshot: async () => expected, verifyExistingJournal: async () => { throw new Error("Actual credit was Rental Income"); } } as unknown as ZohoBooksClient;
  const result = (await auditSourceLedgers(config, state, api))[0]!;
  assert.equal(result.status, "discrepancy"); assert.equal(result.classificationsExpected, 1); assert.equal(result.classificationsVerified, 0);
});
