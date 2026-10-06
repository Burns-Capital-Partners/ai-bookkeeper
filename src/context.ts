import { createHash } from "node:crypto";
import type { BookkeeperState } from "./db.js";
import type { CompanyConfig } from "./types.js";

export interface ContextFact {
  id: string;
  topic: string;
  explanation: string;
  ownerMessage: string;
  reviewer: string;
  source: string;
  effectiveFrom: string;
  accountName?: string;
  unitId?: string;
  supersedes?: string;
  recordedAt: string;
}
export interface ContextHistory { revision: number; facts: ContextFact[] }
export const contextKey = (config: CompanyConfig) => `owner-context:${config.company.zohoOrgId}`;
export function nonempty(value: unknown, label: string, limit = 8000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${label} must be nonempty text of at most ${limit} characters.`);
  return value.trim();
}
export function realDate(value: unknown): string {
  const result = nonempty(value, "effectiveFrom", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new Error("A real ISO calendar date is required.");
  return result;
}
export function contextHistory(config: CompanyConfig, state: BookkeeperState): ContextHistory {
  return state.getRuntime<ContextHistory>(contextKey(config)) ?? { revision: 0, facts: [] };
}
export function contextSnapshot(config: CompanyConfig, state: BookkeeperState, asOf?: string) {
  const history = contextHistory(config, state);
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: config.company.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const cutoff = asOf ?? ["year", "month", "day"].map(p => dateParts.find(v => v.type === p)!.value).join("-");
  const eligible = history.facts.filter(f => f.effectiveFrom <= cutoff);
  const superseded = new Set(eligible.map(f => f.supersedes).filter(Boolean));
  const current = eligible.filter(f => !superseded.has(f.id));
  // Configuration is identified as configuration, never fabricated owner testimony.
  const configuration = { company: config.company, accounts: config.accounts, allocation: config.allocation,
    units: config.units, patterns: config.categorizationPatterns, limits: config.flagRules };
  const learnedRules = state.getLearnedRules(config.company.name);
  const version = createHash("sha256").update(JSON.stringify([history, configuration, learnedRules])).digest("hex");
  return { revision: history.revision, version, configuration, learnedRules, facts: current, history: history.facts };
}
export function acceptContext(input: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState, now = new Date()): void {
  if (input.confirmedBy !== "owner") throw new Error("Context changes require the owner's explanation; model assumptions belong on the review ledger.");
  const fact: ContextFact = { id: nonempty(input.id, "id", 200), topic: nonempty(input.topic, "topic", 200),
    explanation: nonempty(input.explanation, "explanation"), ownerMessage: nonempty(input.ownerMessage, "ownerMessage"),
    reviewer: nonempty(input.reviewer, "reviewer", 200), source: nonempty(input.source, "source", 1000),
    effectiveFrom: realDate(input.effectiveFrom), recordedAt: now.toISOString() };
  if (input.accountName !== undefined) {
    fact.accountName = nonempty(input.accountName, "accountName", 200);
    if (!Object.values(config.accounts).includes(fact.accountName)) throw new Error("Unknown context account.");
  }
  if (input.unitId !== undefined) {
    fact.unitId = nonempty(input.unitId, "unitId", 200);
    if (!config.units.some(u => u.id === fact.unitId)) throw new Error("Unknown context rental unit.");
  }
  if (input.supersedes !== undefined) fact.supersedes = nonempty(input.supersedes, "supersedes", 200);
  state.updateRuntime<ContextHistory>(contextKey(config), previous => {
    const history = previous ?? { revision: 0, facts: [] };
    const existing = history.facts.find(f => f.id === fact.id);
    if (existing) {
      if (JSON.stringify({ ...existing, recordedAt: "" }) !== JSON.stringify({ ...fact, recordedAt: "" })) throw new Error("Context id already exists with different content.");
      return history;
    }
    if (input.expectedRevision !== history.revision) throw new Error("Context changed. Read the current shared revision before submitting this explanation.");
    if (fact.supersedes) {
      const old = history.facts.find(f => f.id === fact.supersedes);
      if (!old || history.facts.some(f => f.supersedes === old.id) || old.topic !== fact.topic || fact.effectiveFrom < old.effectiveFrom) throw new Error("Superseded context must be a current fact in the same topic, with a compatible effective date.");
    }
    return { revision: history.revision + 1, facts: [...history.facts, fact] };
  });
}
