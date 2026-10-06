import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { encryptedBackup } from "./backup.js";
import { exportPending } from "./handoff.js";
import { nonempty } from "./context.js";
import type { BookkeeperState } from "./db.js";
import type { CompanyConfig } from "./types.js";

export interface SharedOptions { path: string; localStateDirectory: string; backupKey?: string }
interface SharedState {
  lastPublishedAt?: string;
  snapshotHash?: string;
  cloudReceipt?: { hash: string; receipt: string; at: string };
  backup?: { day: string; file: string; hash: string; createdAt: string; runFinishedAt?: string; cloudReceipt?: string; confirmedAt?: string };
  error?: string;
}
export function sharedState(state: BookkeeperState): SharedState { return state.getRuntime<SharedState>("shared-state") ?? {}; }
export function sharedRoot(options: SharedOptions): string {
  if (!isAbsolute(options.path) || !existsSync(options.path) || !lstatSync(options.path).isDirectory() || lstatSync(options.path).isSymbolicLink()) throw new Error("Configured Drive folder is absent or invalid. Do not create a replacement local folder while Drive is unavailable.");
  const root = realpathSync(options.path), local = existsSync(options.localStateDirectory) ? realpathSync(options.localStateDirectory) : resolve(options.localStateDirectory);
  const rel = relative(root, local);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) throw new Error("Live SQLite state and credentials must remain outside the synced Drive folder.");
  return root;
}
/** Copy immutable inbox records, without trusting sync completion or overwriting local input. */
export function importSharedInbox(options: SharedOptions, localHandoff: string): void {
  const root = sharedRoot(options), inbox = join(root, "inbox");
  if (!existsSync(inbox)) return;
  if (!lstatSync(inbox).isDirectory() || lstatSync(inbox).isSymbolicLink()) throw new Error("Shared inbox must be a regular directory.");
  const local = join(localHandoff, "inbox"); mkdirSync(local, { recursive: true, mode: 0o700 });
  const errors: string[] = [];
  for (const name of readdirSync(inbox).filter(n => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(n)).sort()) {
    try {
    const path = join(inbox, name), metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) throw new Error("Shared inbox contains an invalid or oversized file.");
    const raw = readFileSync(path, "utf8");
    try { JSON.parse(raw); } catch { continue; } // A partial upload will be reconsidered next run.
    const target = join(local, `drive-${name}`);
    if (existsSync(target)) {
      if (readFileSync(target, "utf8") !== raw) throw new Error("An immutable Drive inbox file changed. Submit a new filename and id.");
    } else writeFileSync(target, raw, { mode: 0o600, flag: "wx" });
    } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : "copy failed"}`); }
  }
  if (errors.length) throw new Error(errors.join("; "));
}
export function publishShared(config: CompanyConfig, state: BookkeeperState, options: SharedOptions, extra: Record<string, unknown> = {}, now = new Date()): void {
  const root = sharedRoot(options), saved = sharedState(state), current = join(root, "current.json");
  for (const name of ["inbox", "backups"]) {
    const path = join(root, name);
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error("Shared subdirectories must be regular directories.");
  }
  mkdirSync(join(root, "inbox"), { recursive: true, mode: 0o700 });
  if (options.backupKey) {
    try {
      const day = now.toISOString().slice(0, 10);
      const run = extra.lastRun as { status?: string; finishedAt?: string } | undefined;
      const runFinishedAt = run && ["complete", "error"].includes(run.status ?? "") && typeof run.finishedAt === "string"
        ? run.finishedAt : undefined;
      // A same-day launch, rerun or login can change accepted state. Save each
      // finished run once; publishing the same handoff again keeps its backup.
      if (saved.backup?.day !== day || (runFinishedAt && saved.backup?.runFinishedAt !== runFinishedAt)) {
        const file = `${day}-${randomUUID()}.json.enc`, destination = join(root, "backups", file);
        encryptedBackup(state, options.localStateDirectory, destination, config.company.zohoOrgId, options.backupKey);
        saved.backup = { day, file, hash: createHash("sha256").update(readFileSync(destination)).digest("hex"), createdAt: now.toISOString(),
          ...(runFinishedAt ? { runFinishedAt } : {}) };
      }
      saved.error = undefined;
    } catch { saved.error = "Encrypted backup failed. Local accepted state was preserved; check the backup key and destination storage before claiming recoverability."; }
  } else saved.error = "Encrypted backup key is not configured; shared context is published but no backup has been made.";
  state.setRuntime("shared-state", saved);
  exportPending(config, state, current, extra);
  saved.lastPublishedAt = now.toISOString();
  saved.snapshotHash = createHash("sha256").update(readFileSync(current)).digest("hex");
  state.setRuntime("shared-state", saved);
  // This proves a local Drive-folder write only, not cloud sync. Muse confirms the hash remotely.
}
export function acceptSharedReceipt(value: Record<string, unknown>, state: BookkeeperState): void {
  const hash = nonempty(value.hash, "hash", 64), receipt = nonempty(value.receipt, "actual Drive file/revision receipt", 1000);
  state.updateRuntime<SharedState>("shared-state", previous => {
    if (!previous) throw new Error("Nothing has been published to Drive yet.");
    if (value.target === "snapshot" && hash === previous.snapshotHash) previous.cloudReceipt = { hash, receipt, at: new Date().toISOString() };
    else if (value.target === "backup" && previous.backup && value.file === previous.backup.file && hash === previous.backup.hash) {
      previous.backup.cloudReceipt = receipt; previous.backup.confirmedAt = new Date().toISOString();
    } else throw new Error("Drive receipt does not match the published file/hash.");
    return previous;
  });
}
