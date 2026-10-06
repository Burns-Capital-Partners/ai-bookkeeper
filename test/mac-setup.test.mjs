import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { assertNoConflictingSchedules } from "../scripts/prepare-mac.mjs";

const agents = "/Users/example/Library/LaunchAgents";

test("Mac enable refuses loaded legacy jobs even after their plist is moved", () => {
  for (const label of ["org.aibookkeeper.example-property.daily", "org.aibookkeeper.example-property.monthly", "org.aibookkeeper.example-property"]) {
    assert.throws(() => assertNoConflictingSchedules(agents, `PID\tStatus\tLabel\n-\t1\t${label}\n`, () => false), /Launch disabled: existing bookkeeping schedules/);
  }
});

test("Mac enable refuses unloaded plists that would resume at next login", () => {
  for (const label of ["org.aibookkeeper.example-property.daily", "org.aibookkeeper.example-property.monthly", "org.aibookkeeper.example-property"]) {
    assert.throws(() => assertNoConflictingSchedules(agents, "PID\tStatus\tLabel\n", path => path === join(agents, `${label}.plist`)), /no schedules were changed/);
  }
});

test("Mac enable permits unrelated jobs without mistaking similar names for bookkeeping", () => {
  assert.doesNotThrow(() => assertNoConflictingSchedules(agents, "10\t0\tcom.apple.example\n-\t0\torg.aibookkeeper.example-property.daily-backup\n", () => false));
});
