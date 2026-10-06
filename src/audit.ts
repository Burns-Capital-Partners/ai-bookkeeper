import { createHash, randomUUID } from "node:crypto";
import { nonempty, realDate } from "./context.js";
import type { BookkeeperState } from "./db.js";
import type { CompanyConfig, JournalEntry } from "./types.js";
import type { LedgerMovement, ZohoBooksClient } from "./zoho.js";

export interface SourceMovement { id: string; date: string; amount: number; description: string; zohoId?: string; expectedJournal?: JournalEntry; contextFactId?: string }
export interface SourceLedger { id: string; accountName: string; from: string; to: string; opening: number; closing: number; source: string; reviewer: string; rows: SourceMovement[] }
export interface AuditResult { packetId: string; accountName: string; from: string; to: string; checkedAt: string;
  status: "verified" | "discrepancy" | "not-verified"; issues: string[]; matches: { sourceId: string; zohoId: string; basis: "explicit-id" | "date-amount" }[];
  movements?: LedgerMovement[]; journalHashes?: Record<string, string>; snapshotHash?: string;
  scope: "cash movements and balances"; classificationsVerified: number; classificationsExpected: number; }
const cents = (value: number) => Math.round(value * 100);
function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(cents(value)) || Math.abs(value * 100 - cents(value)) > 0.00001) throw new Error("Ledger amounts must be finite cents.");
  return value;
}
export function sourceLedgers(config: CompanyConfig, state: BookkeeperState): SourceLedger[] {
  return state.getRuntime<SourceLedger[]>(`source-ledgers:${config.company.zohoOrgId}`) ?? [];
}
export function acceptSourceLedger(input: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState): void {
  const packet: SourceLedger = { id: nonempty(input.id, "id", 200), accountName: nonempty(input.accountName, "accountName", 200),
    from: realDate(input.from), to: realDate(input.to), opening: money(input.opening), closing: money(input.closing),
    source: nonempty(input.source, "source", 1000), reviewer: nonempty(input.reviewer, "reviewer", 200), rows: [] };
  if (input.complete !== true || packet.from > packet.to || ![config.accounts.tdBank, config.accounts.quicksilver].includes(packet.accountName)) throw new Error("Ledger requires complete source coverage and a configured bank/card account.");
  if (!Array.isArray(input.rows) || input.rows.length > 10000) throw new Error("Ledger rows must be a complete array of at most 10000 entries.");
  const ids = new Set<string>();
  for (const raw of input.rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid source row.");
    const row: SourceMovement = { id: nonempty(raw.id, "source row id", 200), date: realDate(raw.date),
      amount: money(raw.amount), description: nonempty(raw.description, "source description", 1000) };
    if (row.date < packet.from || row.date > packet.to || row.amount === 0 || ids.has(row.id)) throw new Error("Source row has an invalid date, zero amount or duplicate id.");
    ids.add(row.id);
    if (raw.zohoId !== undefined) row.zohoId = nonempty(raw.zohoId, "exact Zoho transaction id", 200);
    if (raw.contextFactId !== undefined) row.contextFactId = nonempty(raw.contextFactId, "contextFactId", 200);
    if (raw.expectedJournal !== undefined) {
      if (!row.zohoId || !raw.expectedJournal || typeof raw.expectedJournal !== "object" || Array.isArray(raw.expectedJournal) || !Array.isArray(raw.expectedJournal.lines)) throw new Error("Expected journal requires an explicit Zoho id and journal lines.");
      const expected: JournalEntry = { date: realDate(raw.expectedJournal.date), notes: "Source-backed audit expectation", lines: [] };
      let total = 0;
      for (const line of raw.expectedJournal.lines) {
        if (!line || !Object.values(config.accounts).includes(line.accountName) || (line.debit === undefined) === (line.credit === undefined)) throw new Error("Invalid expected journal account/direction.");
        const amount = money(line.debit ?? line.credit);
        if (amount <= 0) throw new Error("Expected journal lines must be positive.");
        total += line.debit === undefined ? -cents(amount) : cents(amount);
        if (line.customerId && !config.units.some(u => u.customerId === line.customerId)) throw new Error("Unknown expected unit tag.");
        expected.lines.push({ accountName: line.accountName, ...(line.debit === undefined ? { credit: amount } : { debit: amount }), ...(line.customerId ? { customerId: line.customerId } : {}) });
      }
      if (total !== 0 || expected.lines.length < 2 || expected.date !== row.date) throw new Error("Expected journal must balance on the actual source date.");
      const bankLines = expected.lines.filter(l => l.accountName === packet.accountName);
      if (bankLines.length !== 1 || cents(bankLines[0]!.debit ?? -(bankLines[0]!.credit ?? 0)) !== cents(row.amount)) throw new Error("Expected journal must contain exactly this signed bank source amount.");
      row.expectedJournal = expected;
    }
    packet.rows.push(row);
  }
  const signedChange = packet.rows.reduce((sum, r) => sum + cents(r.amount), 0) * (packet.accountName === config.accounts.quicksilver ? -1 : 1);
  if (cents(packet.opening) + signedChange !== cents(packet.closing)) throw new Error("Source ledger does not bridge its opening and closing balances. Supply all posted activity for the exact cutoff.");
  state.updateRuntime<SourceLedger[]>(`source-ledgers:${config.company.zohoOrgId}`, previous => {
    const all = previous ?? [], existing = all.find(p => p.id === packet.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(packet)) throw new Error("Source ledger id already has different content.");
    return existing ? all : [...all, packet];
  });
}
/** Preserve multiplicity: same date and amount never prove two records are duplicates. */
export function compareMovements(source: SourceMovement[], actual: LedgerMovement[]) {
  const remaining = new Set(actual.map((_, i) => i)), issues: string[] = [], matches: AuditResult["matches"] = [];
  for (const row of source) {
    const candidates = [...remaining].filter(i => {
      const candidate = actual[i]!;
      return row.zohoId ? candidate.id === row.zohoId : candidate.date === row.date && cents(candidate.amount) === cents(row.amount);
    });
    if (candidates.length !== 1) { issues.push(`${candidates.length ? "Ambiguous" : "Missing"} source transaction ${row.id}; candidates=${candidates.length}.`); continue; }
    const i = candidates[0]!, match = actual[i]!;
    if (!row.zohoId && source.filter(r => !r.zohoId && r.date === row.date && cents(r.amount) === cents(row.amount)).length !== 1) {
      issues.push(`Ambiguous repeated source amount/date for ${row.id}; preserve every source record.`); continue;
    }
    remaining.delete(i);
    if (match.date !== row.date || cents(match.amount) !== cents(row.amount)) issues.push(`Date/amount mismatch for source ${row.id}, Zoho ${match.id}.`);
    matches.push({ sourceId: row.id, zohoId: match.id, basis: row.zohoId ? "explicit-id" : "date-amount" });
  }
  for (const i of remaining) issues.push(`Unmatched Zoho movement ${actual[i]!.id} on ${actual[i]!.date}; do not delete without resolving its source.`);
  return { issues, matches };
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function journalAuditHash(journal: JournalEntry): string { return digest([journal.date, journal.lines.map(l => JSON.stringify(l)).sort()]); }
export async function auditSourceLedgers(config: CompanyConfig, state: BookkeeperState, zoho: ZohoBooksClient): Promise<AuditResult[]> {
  // A later packet for the exact same coverage supersedes its prior version, retained in history.
  const active = new Map<string, SourceLedger>();
  for (const packet of sourceLedgers(config, state)) active.set(`${packet.accountName}:${packet.from}:${packet.to}`, packet);
  const results: AuditResult[] = [];
  for (const [coverage, packet] of active) {
    const key = `audit:${config.company.zohoOrgId}:${coverage}`, baseline = state.getRuntime<Record<string, string>>(`${key}:baseline`);
    const result: AuditResult = { packetId: packet.id, accountName: packet.accountName, from: packet.from, to: packet.to,
      checkedAt: new Date().toISOString(), status: "not-verified", issues: [], matches: [], scope: "cash movements and balances",
      classificationsVerified: 0, classificationsExpected: packet.rows.filter(r => r.expectedJournal).length };
    try {
      const movements = await zoho.listAccountActivity(packet.accountName, packet.from, packet.to);
      const priorDay = new Date(Date.parse(packet.from) - 86400000).toISOString().slice(0, 10);
      const opening = await zoho.getLedgerBalance(packet.accountName, priorDay), closing = await zoho.getLedgerBalance(packet.accountName, packet.to);
      if (cents(opening) !== cents(packet.opening)) result.issues.push("Opening balance differs from the source. No balancing entry was generated.");
      if (cents(closing) !== cents(packet.closing)) result.issues.push("Closing balance differs from the source.");
      const comparison = compareMovements(packet.rows, movements);
      result.issues.push(...comparison.issues); result.matches = comparison.matches; result.movements = movements;
      result.journalHashes = {};
      for (const journalId of new Set(movements.map(m => m.journalId).filter((id): id is string => !!id))) {
        const journal = await zoho.getJournalSnapshot(journalId);
        const fingerprint = journalAuditHash(journal);
        result.journalHashes[journalId] = fingerprint;
        if (baseline?.[journalId] && baseline[journalId] !== fingerprint) result.issues.push(`Historical journal ${journalId} changed since the accepted baseline; verify its accounts, date and tenant tags.`);
      }
      for (const id of Object.keys(baseline ?? {})) if (!result.journalHashes[id]) result.issues.push(`Historical journal ${id} is no longer in this cutoff; verify any deletion, replacement or date change.`);
      for (const row of packet.rows.filter(r => r.expectedJournal && r.zohoId)) {
        try { await zoho.verifyExistingJournal(row.expectedJournal!, row.zohoId!); result.classificationsVerified++; }
        catch { result.issues.push(`Source classification/date/unit mismatch for ${row.id}, journal ${row.zohoId}.`); }
      }
      result.status = result.issues.length ? "discrepancy" : "verified";
      result.snapshotHash = digest([result.movements, result.journalHashes]);
      state.setRuntime(`${key}:baseline`, { ...result.journalHashes, ...baseline });
    } catch { result.issues.push("Could not verify complete Zoho activity, balances or journal details. Retry when the source/API is available."); }
    // Retain every changed result, including the original baseline and an unsuccessful read.
    state.updateRuntime<AuditResult[]>(`${key}:history`, all => {
      const history = all ?? [];
      if (!history.length || digest({ ...history.at(-1), checkedAt: "" }) !== digest({ ...result, checkedAt: "" })) history.push(result);
      return history;
    });
    if (result.status !== "not-verified") state.setRuntime(key, result);
    if (result.status === "verified") state.resolveIssue(config.company.name, key);
    else state.saveFlag({ id: randomUUID(), createdAt: result.checkedAt, companyName: config.company.name, key,
      type: "reconciliation-mismatch", severity: "warning", status: "open", escalationLevel: 0, period: packet.to.slice(0, 7),
      title: `${packet.accountName} source audit ${result.status}`, detail: result.issues.join(" ") });
    results.push(result);
  }
  state.setRuntime("source-audit-results", results);
  return results;
}

export function acknowledgeAuditChange(input: Record<string, unknown>, config: CompanyConfig, state: BookkeeperState): void {
  if (input.confirmedBy !== "owner") throw new Error("Historical changes require an owner-confirmed explanation.");
  const packetId = nonempty(input.packetId, "packetId", 200), expectedHash = nonempty(input.snapshotHash, "snapshotHash", 64);
  const current = (state.getRuntime<AuditResult[]>("source-audit-results") ?? []).find(r => r.packetId === packetId);
  if (!current?.journalHashes || current.status === "not-verified" || current.snapshotHash !== expectedHash) throw new Error("Audit snapshot changed or is not verified. Read the current audit before confirming a change.");
  const note = `${nonempty(input.reviewer, "reviewer", 200)}: ${nonempty(input.ownerMessage, "ownerMessage")}`;
  const key = `audit:${config.company.zohoOrgId}:${current.accountName}:${current.from}:${current.to}`;
  state.setRuntime(`${key}:baseline`, current.journalHashes);
  state.updateRuntime<{ at: string; snapshotHash: string; note: string }[]>(`${key}:confirmations`, all => [...(all ?? []), { at: new Date().toISOString(), snapshotHash: expectedHash, note }]);
  // The next audit still checks source rows, balances and expected classifications.
}
