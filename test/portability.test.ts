import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateConfig } from "../src/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookkeeperState } from "../src/db.js";

const example = JSON.parse(readFileSync("config/example-property.json", "utf8"));

test("supplemental close accounts require distinct configured supplemental identities", () => {
  const input = structuredClone(example); input.accounts.security = "Deposit Bank";
  input.supplementalCloseAccounts = ["Deposit Bank"];
  assert.deepEqual(validateConfig(input).supplementalCloseAccounts, ["Deposit Bank"]);
  for (const extra of [null, "Deposit Bank", ["Unknown"], ["Deposit Bank", "Deposit Bank"], [input.accounts.tdBank], [input.accounts.mortgageEscrow]]) {
    input.supplementalCloseAccounts = extra;
    assert.throws(() => validateConfig(input), /Supplemental close accounts/);
  }
});

test("an explicit database override cannot silently reuse another entity's history", () => {
  const path = join(mkdtempSync(join(tmpdir(), "entity-boundary-")), "state.db");
  const state = new BookkeeperState(path);
  state.setRuntime("deployment-identity", "a different organization and account map");
  state.close();
  const result = spawnSync(process.execPath, ["dist/index.js", "flags", "--config", "example-property"], {
    encoding: "utf8", env: { ...process.env, BOOKKEEPER_STATE_PATH: path },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /State belongs to a different deployment/);
});

test("another entity can have one rental unit and its own organization and bank IDs", () => {
  const input = structuredClone(example);
  input.company = { ...input.company, name: "Another Rental", zohoOrgId: "888000001", example: false };
  input.bankAccountIds = { tdBank: "888000101", quicksilver: "888000102" };
  input.units = input.units.slice(0, 1);
  assert.equal(validateConfig(input).company.name, "Another Rental");
  input.bankAccountIds.quicksilver = input.bankAccountIds.tdBank;
  assert.throws(() => validateConfig(input), /distinct verified bank account IDs/);
});

test("reporting basis is an explicit validated choice without changing legacy configs", () => {
  const legacy = structuredClone(example);
  delete legacy.company.reportingBasis;
  assert.equal(validateConfig(legacy).company.reportingBasis, undefined);
  for (const basis of ["cash", "accrual"]) {
    const input = structuredClone(example);
    input.company.reportingBasis = basis;
    assert.equal(validateConfig(input).company.reportingBasis, basis);
  }
  for (const basis of ["Cash", "automatic", "", null, true]) {
    const input = structuredClone(example);
    input.company.reportingBasis = basis;
    assert.throws(() => validateConfig(input), /Reporting basis/);
  }
});

test("CLI rejects config traversal and missing selection before opening state or connecting", () => {
  for (const args of [["doctor"], ["doctor", "--config", "../../secret"]]) {
    const result = spawnSync(process.execPath, ["dist/index.js", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /entity slug/);
  }
});

test("fictional config cannot use provider reads or writes even with live enabled", () => {
  for (const command of ["doctor", "audit", "run", "categorize", "close"]) {
    const result = spawnSync(process.execPath, ["dist/index.js", command, "--config", "example-property"], {
      encoding: "utf8", env: { ...process.env, BOOKKEEPER_LIVE: "1" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Example configuration cannot connect/);
  }
});

test("Mac schedule selection separates runtime, label and command for each entity", () => {
  for (const name of ["rental-a", "rental-b"]) {
    const result = spawnSync(process.execPath, ["scripts/prepare-mac.mjs", "--config", name, "--print-plist"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`org.aibookkeeper.${name}`));
    assert.ok(result.stdout.includes(`AIBookkeeper`) && result.stdout.includes(`${name}`));
    assert.ok(!result.stdout.includes("example-property"));
  }
});
