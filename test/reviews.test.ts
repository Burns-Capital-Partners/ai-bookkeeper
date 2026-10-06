import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BookkeeperState, transactionFingerprint } from "../src/db.js";
import { categorizeTransactions } from "../src/categorizer.js";
import { acceptContext } from "../src/context.js";
import { answerReview, createReview, prepareExpiredReviews, reconcileReviewPostings, reviewLedger, verifyReviewResolutions } from "../src/reviews.js";
import { acceptReviewEvidence, requestReview, reviewBudget, reviewExceptions } from "../src/reviewer.js";
import type { BankTransaction, CompanyConfig, JournalEntry } from "../src/types.js";
import type { ZohoBooksClient } from "../src/zoho.js";

const template = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
const START = new Date("2026-10-06T12:00:00Z"), EXPIRE = new Date("2026-10-09T12:00:00Z");
const proposed = { verdict: "propose", action: "splitExpense", accountKey: "repairsMaintenance", rentalShare: 1,
  rationale: "The supplied repair receipt names the downstairs unit.", evidence: ["transaction:test"] };
async function fixture(t: TestContext) {
  const config = structuredClone(template), state = new BookkeeperState(":memory:"); t.after(() => state.close());
  const source: BankTransaction = { transactionId: "test", accountName: config.accounts.tdBank!, amount: -100,
    date: "2026-09-15", description: "UNFAMILIAR VENDOR", status: "uncategorized" };
  const journals: JournalEntry[] = [];
  const api = { listBankTransactions: async () => [source], getBankTransaction: async () => source,
    checkSourceForPosting: async () => {}, matchBankTransaction: async () => {},
    createJournal: async (entry: JournalEntry) => { journals.push(entry); return `journal-${journals.length}`; } };
  const zoho = api as unknown as ZohoBooksClient;
  const run = async () => { await categorizeTransactions(config, zoho, state); reconcileReviewPostings(config, state); };
  await run();
  return { config, state, source, journals, api, zoho, run,
    propose: () => createReview(config, state, source, proposed, "fixture model", proposed.evidence, START),
    expire: (now = EXPIRE) => prepareExpiredReviews(config, state, zoho, now) };
}
function apiReply(result: unknown = proposed, usage = { prompt_tokens: 1000, completion_tokens: 100 }) {
  return new Response(JSON.stringify({ usage, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] }), { status: 200 });
}

test("72-hour expiry posts once, retains the assumption and does not learn from silence", async t => {
  const f = await fixture(t); const review = f.propose();
  await f.expire(new Date(EXPIRE.getTime() - 1)); await f.run(); assert.equal(f.journals.length, 0);
  await f.expire(); await f.run(); await f.expire(); await f.run();
  assert.equal(f.journals.length, 1); assert.equal(f.state.getLearnedRules(f.config.company.name).length, 0);
  const saved = reviewLedger(f.config, f.state)[0]!;
  assert.equal(saved.status, "applied-provisionally"); assert.equal(saved.remoteId, "journal-1"); assert.equal(saved.id, review.id);
  assert.ok(saved.events.some(e => e.action === "expired"));
  assert.equal(f.state.getOpenFlags(f.config.company.name).filter(x => x.type === "review-proposal").length, 0);
});
test("an early owner correction overrides the proposal and teaches the narrow rule", async t => {
  const f = await fixture(t), review = f.propose();
  answerReview({ id: "answer", proposalId: review.id, fingerprint: review.fingerprint, reviewer: "Owner", ownerMessage: "That was a personal purchase.",
    decision: "correct", action: "splitExpense", accountKey: "personalExpenses", rentalShare: 0 }, f.config, f.state, START);
  await f.expire(); await f.run();
  assert.equal(f.journals.length, 1); assert.equal(reviewLedger(f.config, f.state)[0]!.status, "confirmed");
  assert.equal(f.journals[0]!.lines.find(l => l.accountName === f.config.accounts.personalExpenses)!.debit, 100);
  assert.equal(f.journals[0]!.lines.some(l => l.accountName === f.config.accounts.ownerDraws), false);
  assert.equal(f.state.getLearnedRules(f.config.company.name).length, 1);
});
test("a late correction stays on the ledger without posting a second journal", async t => {
  const f = await fixture(t), review = f.propose(); await f.expire(); await f.run();
  answerReview({ id: "later", proposalId: review.id, fingerprint: review.fingerprint, reviewer: "Owner", ownerMessage: "Actually personal.",
    decision: "correct", action: "splitExpense", accountKey: "personalExpenses", rentalShare: 0 }, f.config, f.state);
  await f.run(); assert.equal(f.journals.length, 1);
  assert.equal(reviewLedger(f.config, f.state)[0]!.status, "correction-needed");
  assert.ok(f.state.getOpenFlags(f.config.company.name).some(f => f.key === `correction:${review.id}`));
});
test("changed sources and context invalidate pending proposals", async t => {
  const f = await fixture(t); f.propose(); f.source.amount = -101;
  await f.expire(); await f.run(); assert.equal(f.journals.length, 0);
  assert.equal(reviewLedger(f.config, f.state)[0]!.status, "superseded");
  const second = await fixture(t); second.propose();
  acceptContext({ id: "new-fact", topic: "expense", explanation: "Personal vendor", ownerMessage: "Personal", reviewer: "Owner", confirmedBy: "owner",
    source: "fixture", effectiveFrom: "2026-01-01", expectedRevision: 0 }, second.config, second.state);
  await second.expire(); await second.run(); assert.equal(second.journals.length, 0);
  assert.equal(reviewLedger(second.config, second.state)[0]!.status, "superseded");
});
test("expiry cannot bypass amount, duplicate or uncertain-posting holds", async t => {
  for (const type of ["amount-threshold", "duplicate", "posting-uncertain", "improvement-vs-repair"] as const) {
    const f = await fixture(t); f.propose();
    f.state.saveFlag({ id: type, key: type, transactionId: f.source.transactionId, fingerprint: transactionFingerprint(f.source),
      companyName: f.config.company.name, createdAt: START.toISOString(), type, severity: "warning", status: "open", escalationLevel: 0, title: type, detail: type });
    await f.expire(); await f.run(); assert.equal(f.journals.length, 0);
  }
});
test("new receipt evidence invalidates a pending proposal before it can expire", async t => {
  const f = await fixture(t), review = f.propose();
  acceptReviewEvidence({ id: "receipt", transactionId: f.source.transactionId, fingerprint: review.fingerprint,
    source: "Fixture receipt", reviewer: "Muse", summary: "A different purpose is documented." }, f.config, f.state);
  await f.expire(); await f.run();
  assert.equal(f.journals.length, 0); assert.equal(reviewLedger(f.config, f.state)[0]!.status, "superseded");
});
test("a late correction requires rereading the repaired journal and teaches future sources without reposting", async t => {
  const f = await fixture(t), review = f.propose(); await f.expire(); await f.run();
  const answer = { id: "late", proposalId: review.id, fingerprint: review.fingerprint, reviewer: "Owner", ownerMessage: "Personal purchase.",
    decision: "correct", action: "splitExpense", accountKey: "personalExpenses", rentalShare: 0 };
  answerReview(answer, f.config, f.state);
  assert.equal(f.state.getLearnedRules(f.config.company.name).length, 1);
  answerReview({ ...answer, id: "resolution", decision: "resolve", ownerMessage: "The original entry is repaired." }, f.config, f.state);
  let repaired = false;
  const api = { verifyExistingJournal: async (expected: JournalEntry, id: string) => {
    assert.equal(id, "journal-1"); assert.deepEqual(expected.lines, [
      { accountName: f.config.accounts.personalExpenses, debit: 100 }, { accountName: f.config.accounts.tdBank, credit: 100 }]);
    if (!repaired) throw new Error("The actual journal still differs"); return id;
  } } as unknown as ZohoBooksClient;
  await verifyReviewResolutions(f.config, f.state, api);
  assert.equal(reviewLedger(f.config, f.state)[0]!.status, "correction-needed");
  repaired = true; await verifyReviewResolutions(f.config, f.state, api); await f.run();
  assert.equal(reviewLedger(f.config, f.state)[0]!.status, "confirmed"); assert.equal(f.journals.length, 1);
  assert.equal(f.state.getOpenFlags(f.config.company.name).filter(f => f.key === `correction:${review.id}`).length, 0);
});
test("one unreadable pending source does not block an independent approved transaction", async t => {
  const f = await fixture(t);
  const good = { ...f.source, transactionId: "utility", description: "APPROVED UTILITY", amount: -77 };
  f.config.categorizationPatterns.unshift({ match: { descriptionEquals: good.description }, action: "splitExpense", account: f.config.accounts.utilities, notes: "Owner-approved fixture" });
  f.api.listBankTransactions = async () => [good];
  f.api.getBankTransaction = async () => { throw new Error("Individual source unavailable"); };
  await f.run(); assert.equal(f.journals.length, 1);
  assert.ok(f.state.getOpenFlags(f.config.company.name).some(flag => flag.key === "source-read:test"));
});
test("AI requests validate evidence and structured output and account for billed reasoning/output", async t => {
  const f = await fixture(t); let request: Record<string, unknown> | undefined;
  await requestReview(f.config, f.state, f.source, { apiKey: "fixture-not-a-secret", now: () => START,
    fetch: async (_url, opts) => { request = JSON.parse(String(opts?.body)); return apiReply(); } });
  assert.equal(request?.model, "deepseek-v4-pro"); assert.equal(request?.max_tokens, 8192);
  assert.equal(reviewLedger(f.config, f.state).length, 1);
  assert.equal(reviewBudget(f.config, f.state, START).committedDollars, 0.001716);
  const bad = await fixture(t);
  await assert.rejects(requestReview(bad.config, bad.state, bad.source, { apiKey: "fixture", now: () => START,
    fetch: async () => apiReply({ ...proposed, evidence: ["transaction:test", "invented-receipt"] }) }), /unavailable evidence/);
  assert.equal(reviewLedger(bad.config, bad.state).length, 0);
  await assert.rejects(requestReview(bad.config, bad.state, bad.source, { apiKey: "fixture", now: () => START,
    fetch: async () => apiReply({ ...proposed, approval: true }) }), /unsupported fields/);
});
test("a lost response keeps its reservation and a spent budget makes no paid request", async t => {
  const f = await fixture(t);
  await assert.rejects(requestReview(f.config, f.state, f.source, { apiKey: "fixture", now: () => START,
    fetch: async () => { throw new Error("network"); } }), /reservation retained/);
  assert.ok(reviewBudget(f.config, f.state, START).committedDollars > 0);
  f.state.setRuntime(`review-budget:${f.config.company.zohoOrgId}:2026-10`, { limitMicros: 5_000_000,
    calls: [{ id: "prior", reservedMicros: 4_999_999, status: "reserved", at: START.toISOString() }] });
  let called = false;
  await assert.rejects(requestReview(f.config, f.state, f.source, { apiKey: "fixture", now: () => START,
    fetch: async () => { called = true; return apiReply(); } }), /budget exhausted/);
  assert.equal(called, false);
  assert.equal(reviewBudget(f.config, f.state, new Date("2026-11-01T12:00:00Z")).remainingDollars, 5);
});
test("an aborted response body retains its reservation and reports a lost response", async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(requestReview(f.config, f.state, f.source, { apiKey: "fixture", now: () => START,
    fetch: async () => { calls++; return new Response(new ReadableStream({
      start(controller) { controller.error(new DOMException("Response aborted", "AbortError")); }
    })); } }), /timed out or lost its response; cost reservation retained/);
  assert.equal(calls, 1);
  assert.equal(reviewBudget(f.config, f.state, START).calls, 1);
  assert.ok(reviewBudget(f.config, f.state, START).committedDollars > 0);
  assert.equal(reviewLedger(f.config, f.state).length, 0);
});
test("review failures leave ordinary posting independent and retries are bounded per day", async t => {
  const f = await fixture(t); let attempts = 0;
  const options = { apiKey: "fixture", now: () => START, fetch: async () => { attempts++; return new Response("offline", { status: 503 }); } };
  await reviewExceptions(f.config, f.state, options); await reviewExceptions(f.config, f.state, options);
  assert.equal(attempts, 1); assert.equal(f.journals.length, 0);
  assert.equal(reviewLedger(f.config, f.state).length, 0);
  await reviewExceptions(f.config, f.state, { ...options, now: () => new Date(START.getTime() + 86400000) });
  assert.equal(attempts, 2);
});
