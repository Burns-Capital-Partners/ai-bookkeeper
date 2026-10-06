import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BookkeeperState } from "../src/db.js";
import { acceptContext, contextSnapshot } from "../src/context.js";
import { encryptedBackup, restoreBackup } from "../src/backup.js";
import type { CompanyConfig } from "../src/types.js";
const config = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
const fact = { id: "context-1", topic: "test payment source", explanation: "The identified source is owner funding.", ownerMessage: "That is my contribution.",
  source: "fixture owner message", reviewer: "Owner via Muse", confirmedBy: "owner", effectiveFrom: "2026-01-01", expectedRevision: 0 };

test("owner context retains superseded history and rejects stale concurrent changes", t => {
  const state = new BookkeeperState(":memory:"); t.after(() => state.close());
  acceptContext(fact, config, state); acceptContext(fact, config, state);
  assert.equal(contextSnapshot(config, state).revision, 1);
  assert.throws(() => acceptContext({ ...fact, id: "conflict" }, config, state), /Context changed/);
  acceptContext({ ...fact, id: "context-2", expectedRevision: 1, supersedes: fact.id, effectiveFrom: "2026-08-01", explanation: "Owner funding ends after this point." }, config, state);
  assert.equal(contextSnapshot(config, state, "2026-07-01").facts[0]!.id, "context-1");
  assert.equal(contextSnapshot(config, state, "2026-10-01").facts[0]!.id, "context-2");
  assert.equal(contextSnapshot(config, state).history.length, 2);
  assert.throws(() => acceptContext({ ...fact, explanation: "changed" }, config, state), /different content/);
  assert.throws(() => acceptContext({ ...fact, confirmedBy: "model" }, config, state), /owner's explanation/);
  assert.throws(() => acceptContext({ ...fact, effectiveFrom: "2026-02-30" }, config, state), /real ISO/);
});

test("encrypted consistent backup restores history, rejects tampering and never overwrites", t => {
  const directory = mkdtempSync(join(tmpdir(), "bookkeeper-backup-"));
  const state = new BookkeeperState(join(directory, "live.db")); t.after(() => state.close());
  acceptContext(fact, config, state); assert.equal(state.acquireWorkerLock(), true);
  const key = randomBytes(32).toString("hex"), path = join(directory, "backup.enc"), restoredPath = join(directory, "restored.db");
  encryptedBackup(state, directory, path, config.company.zohoOrgId, key);
  assert.doesNotMatch(readFileSync(path, "utf8"), /That is my contribution/);
  restoreBackup(path, restoredPath, config.company.zohoOrgId, key);
  const restored = new BookkeeperState(restoredPath); t.after(() => restored.close());
  assert.deepEqual(contextSnapshot(config, restored), contextSnapshot(config, state));
  assert.equal(restored.acquireWorkerLock(), true);
  assert.throws(() => restoreBackup(path, restoredPath, config.company.zohoOrgId, key), /EEXIST/);
  assert.throws(() => restoreBackup(path, join(directory, "wrong.db"), "wrong-org", key), /organization/);
  const envelope = JSON.parse(readFileSync(path, "utf8")); envelope.metadata.createdAt = "modified";
  const altered = join(directory, "tampered.enc"); writeFileSync(altered, JSON.stringify(envelope));
  assert.throws(() => restoreBackup(altered, join(directory, "bad.db"), config.company.zohoOrgId, key));
  assert.throws(() => encryptedBackup(state, directory, path, config.company.zohoOrgId, "weak"), /32 random bytes/);
  assert.throws(() => restoreBackup(path, join(directory, "Drive", "nested", "state.db"), config.company.zohoOrgId, key, join(directory, "Drive")), /outside/);
});
