import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BookkeeperState } from "../src/db.js";
import { acceptContext } from "../src/context.js";
import { acceptSourceLedger } from "../src/audit.js";
import { metadataRepairs, repairMetadata } from "../src/repairs.js";
import type { CompanyConfig, JournalEntry } from "../src/types.js";
import type { ZohoBooksClient } from "../src/zoho.js";
const config = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
function fixture(t: TestContext, lostResponse = false) {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close());
  const before: JournalEntry = { date: "2026-09-02", notes: "Original", lines: [
    { accountName: config.accounts.tdBank!, debit: 2000 }, { accountName: config.accounts.rentalIncome!, credit: 2000 }] };
  const expected: JournalEntry = { ...structuredClone(before), date: "2026-09-01" };
  for (const line of expected.lines) line.customerId = config.units[0]!.customerId;
  acceptSourceLedger({ id: "fixture-ledger", complete: true, accountName: config.accounts.tdBank, from: "2026-09-01", to: "2026-09-30",
    opening: 1000, closing: 3000, source: "Fixture bank export", reviewer: "Muse", rows: [{ id: "rent", date: expected.date,
      description: "Tenant payment", amount: 2000, zohoId: "journal-1", expectedJournal: expected, contextFactId: "tenant-context" }] }, config, state);
  let current = structuredClone(before), writes = 0;
  const api = { getJournalSnapshot: async () => structuredClone(current),
    verifyExistingJournal: async (wanted: JournalEntry) => { assert.equal(current.date, wanted.date); assert.deepEqual(current.lines, wanted.lines); return "journal-1"; },
    repairJournalMetadata: async (_id: string, old: JournalEntry, wanted: JournalEntry) => {
      assert.equal(metadataRepairs(config, state)[0]?.status, "pending"); assert.deepEqual(old, before);
      writes++; current = structuredClone(wanted); if (lostResponse) throw new Error("Response lost after write"); return current;
    } } as unknown as ZohoBooksClient;
  return { state, before, expected, api, writes: () => writes, change: (journal: JournalEntry) => { current = journal; },
    confirm: () => acceptContext({ id: "tenant-context", topic: "Fixture tenant", unitId: config.units[0]!.id, accountName: config.accounts.tdBank,
      explanation: "This source is the downstairs tenant.", ownerMessage: "That is downstairs rent.", reviewer: "Owner", source: "Fixture owner reply",
      confirmedBy: "owner", effectiveFrom: "2026-01-01", expectedRevision: 0 }, config, state) };
}
test("metadata repair requires owner unit context, retains preimage and verifies once", async t => {
  const f = fixture(t); await repairMetadata(config, f.state, f.api); assert.equal(f.writes(), 0);
  f.confirm(); await repairMetadata(config, f.state, f.api); await repairMetadata(config, f.state, f.api);
  assert.equal(f.writes(), 1); const record = metadataRepairs(config, f.state)[0]!;
  assert.equal(record.status, "verified"); assert.deepEqual(record.before, f.before); assert.deepEqual(record.after?.lines, f.expected.lines);
});
test("lost repair response is recovered by rereading without a second edit", async t => {
  const f = fixture(t, true); f.confirm(); await repairMetadata(config, f.state, f.api);
  assert.equal(metadataRepairs(config, f.state)[0]!.status, "uncertain");
  await repairMetadata(config, f.state, f.api); assert.equal(f.writes(), 1);
  assert.equal(metadataRepairs(config, f.state)[0]!.status, "verified");
});
test("automatic metadata repair cannot alter accounting amounts or categories", async t => {
  const f = fixture(t); f.confirm(); const changed = structuredClone(f.before); changed.lines[1]!.accountName = config.accounts.ownerContributions!;
  f.change(changed); await repairMetadata(config, f.state, f.api); assert.equal(f.writes(), 0); assert.equal(metadataRepairs(config, f.state).length, 0);
});
