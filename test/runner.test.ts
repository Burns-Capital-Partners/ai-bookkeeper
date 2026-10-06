import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BookkeeperState } from "../src/db.js";
import { runDaily, currentPeriod, pendingNotifications } from "../src/runner.js";
import { validateConfig } from "../src/config.js";
import { reviewLedger } from "../src/reviews.js";
import type { BankTransaction } from "../src/types.js";
import type { ZohoBooksClient } from "../src/zoho.js";

const config = validateConfig(JSON.parse(readFileSync("config/example-property.json", "utf8")));
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "bookkeeper-daily-"));
  const state = new BookkeeperState(join(directory, "state.db")); t.after(() => state.close());
  const mock = { listBankTransactions: async (): Promise<BankTransaction[]> => [], getProfitAndLoss: async () => ({}) };
  const zoho = mock as unknown as ZohoBooksClient;
  return { directory, state, mock, run: () => runDaily(config, zoho, state, directory),
    pending: () => JSON.parse(readFileSync(join(directory, "pending.json"), "utf8")) };
}
test("daily run exports missing evidence and retries unchanged undelivered notices", async t => {
  const f = setup(t);
  assert.equal((await f.run()).status, "complete");
  const first = f.pending();
  assert.ok(first.flags.some((v: { type: string }) => v.type === "checklist-blocked"));
  const deliveryIds = first.notifications.map((p: { deliveryId: string }) => p.deliveryId);
  await f.run(); assert.deepEqual(f.pending().notifications.map((p: { deliveryId: string }) => p.deliveryId), deliveryIds);
  for (const id of deliveryIds) f.state.confirmDelivery(id, config.company.name, "Fixture delivered");
  await f.run(); assert.equal(f.pending().notifications.length, 0);
  assert.equal(f.pending().lastRun.status, "complete");
});
test("network failure is persisted for Muse and a successful rerun clears it", async t => {
  const f = setup(t); f.mock.listBankTransactions = async () => { throw new Error("Fixture API unavailable"); };
  const result = await f.run(); assert.equal(result.status, "error");
  assert.ok(f.pending().flags.some((v: { type: string }) => v.type === "worker-error"));
  assert.ok(f.pending().notifications.length);
  f.mock.listBankTransactions = async () => []; await f.run();
  assert.equal(f.state.getOpenFlags(config.company.name).some(v => v.type === "worker-error"), false);
});
test("malformed Muse file is reported while independent bookkeeping continues", async t => {
  const f = setup(t); mkdirSync(join(f.directory, "inbox"));
  writeFileSync(join(f.directory, "inbox", "partial.json"), '{"credential-shaped-content":');
  const result = await f.run();
  assert.equal(result.status, "error"); assert.ok(result.categorization); assert.equal(result.closePeriods.length, 1);
  assert.doesNotMatch(JSON.stringify(f.pending()), /credential-shaped-content/);
});
test("worker lock prevents a second local command from changing the shared inbox", t => {
  const f = setup(t), second = new BookkeeperState(join(f.directory, "state.db")); t.after(() => second.close());
  assert.equal(f.state.acquireWorkerLock(), true); assert.equal(second.acquireWorkerLock(), false);
  second.releaseWorkerLock(); assert.equal(second.acquireWorkerLock(), false);
  f.state.releaseWorkerLock(); assert.equal(second.acquireWorkerLock(), true); second.releaseWorkerLock();
});
test("period calculation uses company timezone across the UTC month boundary", () => {
  assert.equal(currentPeriod(config, new Date("2026-10-01T02:00:00Z")), "2026-09");
});
test("runtime config rejects wrong organization and malformed allocation", () => {
  assert.throws(() => validateConfig({ ...config, company: { ...config.company, zohoOrgId: "other" } }), /organization ID/);
  assert.throws(() => validateConfig({ ...config, allocation: { ...config.allocation, rentalShare: 2 } }), /allocation/);
});
test("notifications remain recoverable independently of a new run", async t => {
  const f = setup(t); await f.run();
  assert.ok(pendingNotifications(config, f.state).length);
});
test("a failed monthly recheck leaves AI review and the final outbox available", async t => {
  const f = setup(t); let reads = 0;
  const source: BankTransaction = { transactionId: "unknown", accountName: config.accounts.tdBank!, date: "2026-09-15",
    amount: -50, description: "UNKNOWN SOURCE", status: "uncategorized" };
  const api = { listBankTransactions: async () => { if (++reads > 1) throw new Error("Close feed unavailable"); return [source]; },
    getBankTransaction: async () => source } as unknown as ZohoBooksClient;
  const result = await runDaily(config, api, f.state, f.directory, { reviewer: { apiKey: "fixture", fetch: async () => new Response(JSON.stringify({
    usage: { prompt_tokens: 1000, completion_tokens: 100 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      verdict: "propose", action: "splitExpense", accountKey: "utilities", rentalShare: 0.506, rationale: "Fixture evidence supports utility expense.", evidence: ["transaction:unknown"] }) } }] }) ) } });
  assert.equal(result.status, "error"); assert.equal(reviewLedger(config, f.state).length, 1);
  assert.ok(f.pending().flags.some((v: { key?: string }) => v.key?.startsWith("worker:close:")));
});
