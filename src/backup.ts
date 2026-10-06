import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BookkeeperState } from "./db.js";

function keyBytes(key: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("Backup key must be 32 random bytes encoded as 64 hex characters, stored outside Drive and source control.");
  return Buffer.from(key, "hex");
}
export function encryptedBackup(state: BookkeeperState, localDirectory: string, destination: string, organizationId: string, key: string): void {
  const secret = keyBytes(key);
  mkdirSync(localDirectory, { recursive: true, mode: 0o700 });
  const temporary = join(localDirectory, `snapshot-${randomUUID()}.db`);
  try {
    state.snapshot(temporary);
    const metadata = { version: 1, organizationId, createdAt: new Date().toISOString(), cipher: "aes-256-gcm" };
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    const ciphertext = Buffer.concat([cipher.update(readFileSync(temporary)), cipher.final()]);
    const envelope = { metadata, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: ciphertext.toString("base64") };
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, JSON.stringify(envelope), { mode: 0o600, flag: "wx" });
  } finally {
    secret.fill(0);
    // Only the fresh snapshot created by this invocation is removed.
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
/** Restore to a NEW offline path only. Never replace a running state database. */
export function restoreBackup(source: string, destination: string, organizationId: string, key: string, sharedDirectory?: string): void {
  // Resolve existing ancestors too, so a symlinked parent cannot put the restored DB in Drive.
  const canonical = (path: string): string => {
    const absolute = resolve(path);
    if (existsSync(absolute)) return realpathSync(absolute);
    const parent = dirname(absolute);
    if (parent === absolute) throw new Error("Restore path has an unavailable filesystem root.");
    return join(canonical(parent), basename(absolute));
  };
  if (sharedDirectory) {
    const rel = relative(canonical(sharedDirectory), canonical(destination));
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) throw new Error("Restore destination must be outside the configured Drive folder.");
  }
  const secret = keyBytes(key);
  try {
    const envelope = JSON.parse(readFileSync(source, "utf8"));
    if (envelope.metadata?.version !== 1 || envelope.metadata.organizationId !== organizationId || envelope.metadata.cipher !== "aes-256-gcm" ||
      !/^[a-f0-9]{24}$/.test(envelope.iv) || !/^[a-f0-9]{32}$/.test(envelope.tag) || typeof envelope.data !== "string") throw new Error("Invalid backup envelope or organization.");
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(envelope.iv, "hex"));
    decipher.setAAD(Buffer.from(JSON.stringify(envelope.metadata)));
    decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    const data = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    if (data.subarray(0, 16).toString() !== "SQLite format 3\0") throw new Error("Backup is not a SQLite database.");
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, data, { mode: 0o600, flag: "wx" });
    const restored = new DatabaseSync(destination);
    try {
      if (restored.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("Restored database integrity check failed.");
      // A backup can contain its creator's active lock; this restored offline copy has no worker.
      restored.exec("DELETE FROM worker_lock");
    } finally { restored.close(); }
  } finally { secret.fill(0); }
}
