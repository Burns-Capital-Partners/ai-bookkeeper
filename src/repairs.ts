import { createHash } from "node:crypto";
import { contextSnapshot } from "./context.js";
import { journalAuditHash, sourceLedgers } from "./audit.js";
import type { BookkeeperState } from "./db.js";
import type { CompanyConfig, JournalEntry } from "./types.js";
import type { ZohoBooksClient } from "./zoho.js";

export interface MetadataRepair {
  id: string; journalId: string; sourcePacketId: string; sourceRowId: string; source: string;
  before: JournalEntry; expected: JournalEntry; after?: JournalEntry; startedAt: string; verifiedAt?: string;
  status: "pending" | "uncertain" | "verified";
}
const key = (config: CompanyConfig) => `metadata-repairs:${config.company.zohoOrgId}`;
export function metadataRepairs(config: CompanyConfig, state: BookkeeperState): MetadataRepair[] { return state.getRuntime<MetadataRepair[]>(key(config)) ?? []; }
/** Uses source-ledger evidence and exact owner context; model output is never an input here. */
export async function repairMetadata(config: CompanyConfig, state: BookkeeperState, zoho: ZohoBooksClient): Promise<void> {
  const packets = new Map<string, ReturnType<typeof sourceLedgers>[number]>();
  for (const p of sourceLedgers(config, state)) packets.set(`${p.accountName}:${p.from}:${p.to}`, p);
  for (const packet of packets.values()) for (const row of packet.rows) {
    if (!row.zohoId || !row.expectedJournal) continue;
    const expected = row.expectedJournal;
    const tagIds = new Set(expected.lines.map(l => l.customerId).filter(Boolean));
    if (tagIds.size) {
      const fact = contextSnapshot(config, state, row.date).facts.find(f => f.id === row.contextFactId);
      const unit = config.units.find(u => u.id === fact?.unitId);
      if (!fact || !unit?.customerId || tagIds.size !== 1 || !tagIds.has(unit.customerId)) continue;
    }
    const id = createHash("sha256").update(JSON.stringify([row.zohoId, row.id, expected])).digest("hex");
    const old = metadataRepairs(config, state).find(r => r.id === id);
    try {
      if (old) {
        if (old.status === "verified") continue;
        // A lost edit response is only re-read, never retried blindly.
        await zoho.verifyExistingJournal(expected, row.zohoId);
        const after = await zoho.getJournalSnapshot(row.zohoId);
        finish(after); continue;
      }
      if (metadataRepairs(config, state).some(r => r.journalId === row.zohoId && r.status !== "verified")) continue;
      const before = await zoho.getJournalSnapshot(row.zohoId);
      if (journalAuditHash(before) === journalAuditHash(expected)) continue;
      if (!tagIds.size && before.lines.some(l => l.customerId)) continue;
      const monetary = (j: JournalEntry) => JSON.stringify(j.lines.map(l => JSON.stringify([l.accountName, l.debit ?? null, l.credit ?? null])).sort());
      if (monetary(before) !== monetary(expected)) continue;
      const record: MetadataRepair = { id, journalId: row.zohoId, sourcePacketId: packet.id, sourceRowId: row.id, source: packet.source,
        before, expected, status: "pending", startedAt: new Date().toISOString() };
      state.updateRuntime<MetadataRepair[]>(key(config), records => [...(records ?? []), record]);
      const after = await zoho.repairJournalMetadata(row.zohoId, before, expected);
      finish(after);
    } catch {
      state.updateRuntime<MetadataRepair[]>(key(config), records => {
        const all = records ?? [], record = all.find(r => r.id === id);
        if (record) record.status = "uncertain";
        return all;
      });
      state.saveFlag({ id: `repair-${id}`, key: `repair:${id}`, createdAt: new Date().toISOString(), companyName: config.company.name,
        type: "checklist-blocked", severity: "warning", status: "open", escalationLevel: 0, period: row.date.slice(0, 7),
        title: "Metadata repair needs verification", detail: `Journal ${row.zohoId}, source ${packet.id}/${row.id}. An edit may not have completed. Further runs re-read it; they do not blindly repeat the write.` });
    }
    function finish(after: JournalEntry) {
      state.updateRuntime<MetadataRepair[]>(key(config), records => {
        const all = records ?? [], record = all.find(r => r.id === id);
        if (!record) throw new Error("Missing durable repair intent.");
        record.status = "verified"; record.after = after; record.verifiedAt = new Date().toISOString(); return all;
      });
      const baselineKey = `audit:${config.company.zohoOrgId}:${packet.accountName}:${packet.from}:${packet.to}:baseline`;
      state.updateRuntime<Record<string, string>>(baselineKey, baseline => ({ ...(baseline ?? {}), [row.zohoId!]: journalAuditHash(after) }));
      state.resolveIssue(config.company.name, `repair:${id}`);
    }
  }
}
