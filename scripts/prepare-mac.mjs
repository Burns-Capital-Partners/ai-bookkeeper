#!/usr/bin/env node
// Preparation does not start bookkeeping. --enable is the explicit production
// action, to use only after the owner approves launch.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const worker = join(dirname(fileURLToPath(import.meta.url)), "..");
const configIndex = process.argv.indexOf("--config");
const configName = configIndex < 0 ? "example-property" : process.argv[configIndex + 1];
if (!configName || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(configName)) throw new Error("Invalid --config entity slug.");
const runtime = join(homedir(), "Library", "Application Support", "AIBookkeeper", configName);
const envFile = join(runtime, "bookkeeper.env");
const label = `org.aibookkeeper.${configName}`;
const scheduleLabels = [`${label}.daily`, `${label}.monthly`, label];

// A plist can reload at login even when the job is not currently loaded. A
// loaded job can also keep running after its plist is moved. Check both.
export function assertNoConflictingSchedules(agents, launchctlListing, fileExists = existsSync) {
  const loaded = new Set(launchctlListing.split(/\r?\n/).map(line => line.trim().split(/\s+/).at(-1)));
  const conflicts = scheduleLabels.filter(name => loaded.has(name) || fileExists(join(agents, `${name}.plist`)));
  if (conflicts.length) throw new Error(`Launch disabled: existing bookkeeping schedules found (${conflicts.join(", ")}). Follow the README migration steps after owner approval; no schedules were changed.`);
}
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const args = [process.execPath, `--env-file=${envFile}`, join(worker, "dist", "index.js"), "run", "--config", configName];
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(worker)}</string>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(join(runtime, "worker.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(runtime, "worker-error.log"))}</string>
</dict></plist>
`;

function main() {
  if (process.argv.includes("--print-plist")) {
    process.stdout.write(plist);
    return;
  }
  if (process.platform !== "darwin") throw new Error("Run this setup script on the Mac mini.");
  if (configIndex < 0) throw new Error("Supply --config for the entity being prepared.");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node 24 or later is required; no runtime is installed automatically.");
  if (!existsSync(join(worker, "dist", "index.js"))) throw new Error("Build first: npm run build");
  const agents = join(homedir(), "Library", "LaunchAgents");
  if (process.argv.includes("--enable")) {
    const config = JSON.parse(readFileSync(join(worker, "config", `${configName}.json`), "utf8"));
    if (config.company?.example !== false) throw new Error("Launch disabled. Confirm a real deployment with company.example=false.");
    // A failed launchctl inspection aborts enabling; never assume no jobs exist.
    const listing = execFileSync("/bin/launchctl", ["list"], { encoding: "utf8", timeout: 10000 });
    assertNoConflictingSchedules(agents, listing);
  }
  for (const path of [runtime, join(runtime, "handoff"), join(runtime, "handoff", "inbox")]) {
    mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700);
  }
  if (!existsSync(envFile)) writeFileSync(envFile, `# Fill privately on the Mac. Never send credentials through Muse chat.
ZOHO_CLIENT_ID=REPLACE_ME
ZOHO_CLIENT_SECRET=REPLACE_ME
ZOHO_REFRESH_TOKEN=REPLACE_ME
BOOKKEEPER_LIVE=0
BOOKKEEPER_AI_REVIEW=0
DEEPSEEK_API_KEY=
BOOKKEEPER_METADATA_REPAIR=0
# Existing private folder synced by Google Drive for desktop. Keep runtime outside it.
BOOKKEEPER_SHARED_PATH=
# 32 random bytes encoded as 64 hex characters. Keep a recovery copy privately.
BOOKKEEPER_BACKUP_KEY=
BOOKKEEPER_STATE_PATH="${join(runtime, "state.db")}"
BOOKKEEPER_HANDOFF_PATH="${join(runtime, "handoff")}"
`, { mode: 0o600, flag: "wx" });
  chmodSync(envFile, 0o600);
  const prepared = join(runtime, `${label}.plist`);
  writeFileSync(prepared, plist, { mode: 0o600 });
  if (process.argv.includes("--enable")) {
    process.loadEnvFile(envFile);
    if (process.env.BOOKKEEPER_LIVE !== "1" || ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"].some(k => !process.env[k] || process.env[k] === "REPLACE_ME")) {
      throw new Error("Launch disabled. Configure credentials and set BOOKKEEPER_LIVE=1 only after owner approval.");
    }
    mkdirSync(agents, { recursive: true });
    const installed = join(agents, `${label}.plist`);
    copyFileSync(prepared, installed, constants.COPYFILE_EXCL);
    execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, installed], { stdio: "inherit" });
    console.log("Enabled for 06:00 Mac local time, with an immediate first run. Inspect handoff/pending.json for the actual outcome.");
  } else {
    console.log(`Prepared ${prepared}\nPrivate configuration: ${envFile}\nNothing was started or scheduled.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
