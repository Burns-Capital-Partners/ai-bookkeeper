import { createHash, randomUUID } from "node:crypto";
import { transactionFingerprint, type BookkeeperState } from "./db.js";
import { contextSnapshot, nonempty } from "./context.js";
import { classification, classificationJournal, clearClassificationFlags, decisionPattern, type Classification } from "./decisions.js";
import type { BankTransaction, CompanyConfig } from "./types.js";
import type { ZohoBooksClient } from "./zoho.js";

export type ReviewStatus = "awaiting-owner" | "ready" | "applied-provisionally" | "confirmed" | "correction-needed" | "superseded";
export interface ReviewEvent { id: string; at: string; action: string; note: string }
export interface Review {
  id: string;
  source: BankTransaction;
  fingerprint: string;
  contextVersion: string;
  classification: Classification;
  rationale: string;
  evidence: string[];
  model: string;
  createdAt: string;
  expiresAt: string;
  status: ReviewStatus;
  events: ReviewEvent[];
  remoteId?: string;
  correction?: Classification;
  resolutionRequest?: { id: string; note: string };
}
export interface ReviewLedger { items: Review[] }
const key = (config: CompanyConfig) => `reviews:${config.company.zohoOrgId}`;
export function reviewLedger(config: CompanyConfig, state: BookkeeperState): Review[] { return state.getRuntime<ReviewLedger>(key(config))?.items ?? []; }
export function reviewSourceVersion(config: CompanyConfig, state: BookkeeperState, source: BankTransaction): string {
  const evidence = (state.getRuntime<{ transactionId: string; fingerprint: string }[]>(`review-evidence:${config.company.zohoOrgId}`) ?? [])
    .filter(e => e.transactionId === source.transactionId && e.fingerprint === transactionFingerprint(source));
  return createHash("sha256").update(JSON.stringify([contextSnapshot(config, state).version, evidence])).digest("hex");
}
export function updateReview(config: CompanyConfig, state: BookkeeperState, id: string, action: (item: Review) => void): void {
  state.updateRuntime<ReviewLedger>(key(config), previous => {
    if (!previous) throw new Error("Unknown review ledger.");
    const item = previous.items.find(i => i.id === id);
    if (!item) throw new Error("Unknown review proposal.");
    action(item); return previous;
  });
}
function event(item: Review, action: string, note: string, now: Date, id: string = randomUUID()) {
  item.events.push({ id, at: now.toISOString(), action, note });
}
export function eligibleForProposal(config: CompanyConfig, state: BookkeeperState, txn: BankTransaction): boolean {
  return !txn.statement && !state.isProcessed(txn.transactionId) && !state.getPosting(config.company.name, txn.transactionId) &&
    Math.abs(txn.amount) <= config.flagRules.amountThreshold && Number.isFinite(txn.amount) && txn.amount !== 0 &&
    [config.accounts.tdBank, config.accounts.quicksilver].includes(txn.accountName) &&
    state.getOpenFlagsForTransaction(txn.transactionId).filter(f => f.companyName === config.company.name && f.severity !== "info")
      .every(f => ["uncategorized", "venmo-ask", "cash-withdrawal"].includes(f.type));
}
export function createReview(config: CompanyConfig, state: BookkeeperState, source: BankTransaction,
  proposed: Record<string, unknown>, model: string, allowedEvidence: string[], now = new Date()): Review {
  if (!eligibleForProposal(config, state, source)) throw new Error("This transaction is not eligible for a routine classification proposal.");
  const fingerprint = transactionFingerprint(source), contextVersion = reviewSourceVersion(config, state, source);
  const observation = state.getObservation(config.company.name, source.transactionId);
  if (observation?.fingerprint !== fingerprint) throw new Error("Proposal requires the current observed source.");
  const evidence = proposed.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 20 || evidence.some(e => typeof e !== "string" || !allowedEvidence.includes(e))) throw new Error("Proposal cites unavailable evidence.");
  const c = classification(proposed, config, source), rationale = nonempty(proposed.rationale, "rationale", 4000);
  const id = `review-${createHash("sha256").update(JSON.stringify([source.transactionId, fingerprint, contextVersion])).digest("hex").slice(0, 32)}`;
  const item: Review = { id, source, fingerprint, contextVersion, classification: c, rationale, evidence, model,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    status: "awaiting-owner", events: [] };
  event(item, "proposed", rationale, now);
  const ledger = state.updateRuntime<ReviewLedger>(key(config), previous => {
    const data = previous ?? { items: [] };
    if (!data.items.some(r => r.id === id)) data.items.push(item);
    return data;
  });
  state.saveFlag({ id: `notice-${id}`, key: `proposal:${id}`, createdAt: now.toISOString(), companyName: config.company.name,
    transactionId: source.transactionId, fingerprint, type: "review-proposal", severity: "info", status: "open", escalationLevel: 0,
    title: `Proposed ${c.action}: ${source.description.slice(0, 60)}`,
    detail: `${rationale} Evidence: ${evidence.join(", ")}. If unanswered, eligible for provisional handling after ${item.expiresAt}. Proposal ${id} stays on the review ledger until owner confirmation.` });
  return ledger.items.find(i => i.id === id)!;
}
/** Applied as a one-source pattern, never inserted in learned_rules. */
export function provisionalPatterns(config: CompanyConfig, state: BookkeeperState) {
  return reviewLedger(config, state).filter(r => r.status === "ready" && r.contextVersion === reviewSourceVersion(config, state, r.source))
    .map(r => decisionPattern(r.classification, config, r.source, `Provisional assumption ${r.id}: ${r.rationale}`));
}
export async function prepareExpiredReviews(config: CompanyConfig, state: BookkeeperState, zoho: ZohoBooksClient, now = new Date()): Promise<string[]> {
  const errors: string[] = [];
  for (const review of reviewLedger(config, state)) {
    if (!["awaiting-owner", "ready"].includes(review.status)) continue;
    if (review.contextVersion !== reviewSourceVersion(config, state, review.source)) {
      updateReview(config, state, review.id, r => { r.status = "superseded"; event(r, "superseded", "Accounting context changed; obtain a fresh proposal.", now); });
      state.resolveIssue(config.company.name, `proposal:${review.id}`);
      continue;
    }
    if (state.isProcessed(review.source.transactionId) || state.getPosting(config.company.name, review.source.transactionId)) continue;
    if (review.status === "awaiting-owner" && now.getTime() < Date.parse(review.expiresAt)) continue;
    try {
      const source = await zoho.getBankTransaction(review.source);
      if (source.status !== "uncategorized" || transactionFingerprint(source) !== review.fingerprint) {
        updateReview(config, state, review.id, r => { r.status = "superseded"; event(r, "superseded", "Source changed or was recorded elsewhere; no provisional posting.", now); });
        state.resolveIssue(config.company.name, `proposal:${review.id}`);
        continue;
      }
      if (!eligibleForProposal(config, state, source)) continue;
      // Preserve any duplicate, receipt, amount or posting-integrity hold.
      if (state.findDuplicates(config.company.name, source).length) continue;
      updateReview(config, state, review.id, r => {
        if (r.status !== "ready") { r.status = "ready"; event(r, "expired", "72 hours elapsed; eligible for one provisional classification, still unconfirmed by owner.", now); }
      });
      clearClassificationFlags(config, state, source, `Provisional proposal ${review.id}; still on the assumptions ledger.`);
    } catch { errors.push(review.id); }
  }
  return errors;
}
export function reconcileReviewPostings(config: CompanyConfig, state: BookkeeperState, now = new Date()): void {
  for (const review of reviewLedger(config, state)) {
    if (!["ready", "confirmed", "awaiting-owner"].includes(review.status)) continue;
    const attempt = state.getPosting(config.company.name, review.source.transactionId);
    if (attempt?.status === "posted" && attempt.fingerprint === review.fingerprint && attempt.remoteId && review.remoteId !== attempt.remoteId) {
      updateReview(config, state, review.id, r => { r.remoteId = attempt.remoteId;
        if (r.status !== "confirmed") r.status = "applied-provisionally";
        event(r, "posted", `Recorded as ${attempt.remoteId}; source matching and independent verification are tracked separately.`, now); });
      state.resolveIssue(config.company.name, `proposal:${review.id}`);
    } else if (state.isProcessed(review.source.transactionId) && !attempt && review.status !== "confirmed") {
      updateReview(config, state, review.id, r => { r.status = "superseded"; event(r, "external", "Recorded outside this proposal. Preserved without claiming the proposed classification was applied.", now); });
      state.resolveIssue(config.company.name, `proposal:${review.id}`);
    }
  }
}
export function answerReview(input: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState, now = new Date()): void {
  const id = nonempty(input.proposalId, "proposalId", 200), messageId = nonempty(input.id, "id", 200);
  const review = reviewLedger(config, state).find(r => r.id === id);
  if (!review) throw new Error("Unknown proposal.");
  if (review.events.some(e => e.id === messageId)) return;
  const note = `${nonempty(input.reviewer, "reviewer", 200)}: ${nonempty(input.ownerMessage, "ownerMessage")}`;
  if (!["confirm", "correct", "resolve"].includes(String(input.decision))) throw new Error("Proposal answer must confirm, correct, or request verification of an existing repair.");
  const current = state.getObservation(config.company.name, review.source.transactionId);
  if (current?.fingerprint !== review.fingerprint || input.fingerprint !== review.fingerprint) throw new Error("Proposal source changed. Refresh the shared ledger.");
  if (input.decision === "resolve") {
    if (review.status !== "correction-needed" || !review.correction || !review.remoteId) throw new Error("Only an existing corrected posting can be submitted for resolution verification.");
    updateReview(config, state, id, r => { r.resolutionRequest = { id: messageId, note }; event(r, "resolution-requested", note, now, messageId); });
    return;
  }
  if (review.status === "superseded" || review.status === "correction-needed") throw new Error("This proposal was superseded or already needs an accounting repair.");
  if (["awaiting-owner", "ready"].includes(review.status) && review.contextVersion !== reviewSourceVersion(config, state, review.source)) throw new Error("Accounting context or evidence changed. Refresh the proposal before answering.");
  const selected = input.decision === "confirm" ? review.correction ?? review.classification : classification(input, config, review.source);
  if (input.learn !== undefined && typeof input.learn !== "boolean") throw new Error("learn must be a boolean.");
  const attempt = state.getPosting(config.company.name, review.source.transactionId);
  if (attempt && attempt.status !== "posted") throw new Error("Posting outcome must be verified before accepting a classification change.");
  const recorded = attempt?.status === "posted" || state.isProcessed(review.source.transactionId);
  if (input.decision === "correct" && recorded) {
    // Learn the owner's correction for future sources without touching the existing journal.
    state.saveLearnedRule(messageId, config.company.name, decisionPattern(selected, config, review.source, note, input.learn !== false), note);
    updateReview(config, state, id, r => { r.status = "correction-needed"; r.correction = selected; event(r, "correction-requested", note, now, messageId); });
    state.saveFlag({ id: `correction-${id}`, key: `correction:${id}`, createdAt: now.toISOString(), companyName: config.company.name,
      transactionId: review.source.transactionId, fingerprint: review.fingerprint, type: "checklist-blocked", severity: "warning",
      title: "Owner corrected a provisional classification", detail: `${note} Repair the existing entry ${attempt?.remoteId ?? "in Zoho"}; do not post this source twice.`, status: "open", escalationLevel: 0 });
    state.resolveIssue(config.company.name, `proposal:${id}`);
    return;
  }
  // Actual owner feedback may establish a narrow learned rule. Timeout never does.
  const pattern = decisionPattern(selected, config, review.source, note, input.learn !== false);
  state.saveLearnedRule(messageId, config.company.name, pattern, note);
  clearClassificationFlags(config, state, review.source, note);
  updateReview(config, state, id, r => { r.status = "confirmed"; if (input.decision === "correct") r.correction = selected;
    event(r, input.decision === "confirm" ? "owner-confirmed" : "owner-corrected-before-posting", note, now, messageId); });
  state.resolveIssue(config.company.name, `proposal:${id}`);
}

export async function verifyReviewResolutions(config: CompanyConfig, state: BookkeeperState, zoho: ZohoBooksClient): Promise<void> {
  for (const review of reviewLedger(config, state).filter(r => r.status === "correction-needed" && r.resolutionRequest && r.correction && r.remoteId)) {
    try {
      const expected = classificationJournal(review.correction!, config, review.source);
      await zoho.verifyExistingJournal(expected, review.remoteId!);
      updateReview(config, state, review.id, r => { r.status = "confirmed"; event(r, "correction-verified", `Independently reread ${r.remoteId}. ${r.resolutionRequest!.note}`, new Date()); });
      state.resolveIssue(config.company.name, `correction:${review.id}`);
    } catch { /* Keep the correction visible until the actual journal agrees. */ }
  }
}

/** The older decision envelope remains supported and also closes an outstanding proposal. */
export function recordDirectOwnerAnswer(input: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState): void {
  if (input.decision !== "categorize") return;
  for (const review of reviewLedger(config, state).filter(r => r.source.transactionId === input.transactionId &&
    r.fingerprint === input.fingerprint && ["awaiting-owner", "ready"].includes(r.status))) {
    updateReview(config, state, review.id, r => { r.status = "confirmed";
      r.correction = classification(input, config, review.source);
      if (!r.events.some(e => e.id === input.id)) event(r, "owner-classified", String(input.ownerMessage), new Date(), String(input.id)); });
    state.resolveIssue(config.company.name, `proposal:${review.id}`);
  }
}
