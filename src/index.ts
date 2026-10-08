#!/usr/bin/env node
/**
 * AI Bookkeeper worker entry point.
 *
 * Usage:
 *   # Daily categorization run
 *   node dist/index.js categorize --config example-property
 *
 *   # Monthly close (runs categorization + checklist for the prior month)
 *   node dist/index.js close --config example-property --year 2026 --month 10 \
 *     --freedom-loan-balance 500000.00 --freedom-escrow-balance 8000.00 \
 *     --td-statement-balance 12345.67 --quicksilver-statement-balance 42.00
 *
 *   # Check for unanswered flags and emit escalations
 *   node dist/index.js escalate --config example-property
 *
 * Output is JSON on stdout: notification payloads for the parent agent
 * (Muse) to deliver. Nothing is sent directly.
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompanyConfig } from "./types.js";
import { validateConfig } from "./config.js";
import { ZohoBooksClient } from "./zoho.js";
import { BookkeeperState } from "./db.js";
import { categorizeTransactions } from "./categorizer.js";
import { runMonthlyClose, type CloseInputs } from "./closer.js";
import { importInbox, exportPending } from "./handoff.js";
import { pendingNotifications, runDaily } from "./runner.js";
import { restoreBackup } from "./backup.js";
import { auditSourceLedgers } from "./audit.js";
import { importSharedInbox, publishShared } from "./shared.js";
import {
  buildCloseNotification,
  buildFlagNotification,
  pendingEscalations,
  type NotificationPayload,
} from "./notifier.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadConfig(name: string): CompanyConfig {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("Supply --config with a lowercase entity slug, without paths.");
  const path = join(ROOT, "config", `${name}.json`);
  return validateConfig(JSON.parse(readFileSync(path, "utf-8")));
}

/** Read a numeric CLI arg, or undefined if absent. */
function argNumber(args: Record<string, string | boolean>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || typeof v === "boolean") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a finite number.`);
  return n;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a: string | undefined = argv[i];
    if (a === undefined || !a.startsWith("--")) continue;
    const key = a.slice(2);
    const next: string | undefined = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  process.umask(0o077);
  const argv = process.argv.slice(2);
  const command: string | undefined = argv[0];
  const args = parseArgs(argv.slice(1));

  const configName = typeof args.config === "string" ? args.config : "";
  const config = loadConfig(configName);
  if (config.company.example && ["doctor", "audit", "categorize", "close", "run"].includes(command ?? "")) {
    throw new Error("Example configuration cannot connect to Zoho. Create a private entity config with verified IDs and set company.example=false.");
  }
  if (["categorize", "close", "run"].includes(command ?? "") && process.env.BOOKKEEPER_LIVE !== "1") {
    throw new Error("Posting commands require BOOKKEEPER_LIVE=1. Use doctor for a read-only connection check.");
  }

  const dataDir = join(ROOT, "data", configName);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const statePath = process.env.BOOKKEEPER_STATE_PATH ?? join(dataDir, "state.db");
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const state = new BookkeeperState(statePath);

  const zoho = new ZohoBooksClient(config.company.zohoOrgId, {
    // Loaded by Node --env-file from a private file outside the checkout.
    clientId: process.env.ZOHO_CLIENT_ID ?? "",
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    writeEnabled: process.env.BOOKKEEPER_LIVE === "1",
    reportingBasis: config.company.reportingBasis,
    bankAccounts: [config.accounts.tdBank!, config.accounts.quicksilver!],
    accountIds: { [config.accounts.tdBank!]: config.bankAccountIds.tdBank, [config.accounts.quicksilver!]: config.bankAccountIds.quicksilver },
  });

  const payloads: NotificationPayload[] = [];

  try {
    if (!state.acquireWorkerLock()) { console.log(JSON.stringify({ command, status: "skipped", reason: "Another local worker is running." })); return; }
    const identity = JSON.stringify({ organizationId: config.company.zohoOrgId, company: config.company.name,
      accounts: [config.bankAccountIds.tdBank, config.bankAccountIds.quicksilver] });
    const savedIdentity = state.getRuntime<string>("deployment-identity");
    if (savedIdentity && savedIdentity !== identity) throw new Error("State belongs to a different deployment. Use that entity's separate database; do not overwrite its history.");
    state.setRuntime("deployment-identity", identity);
    switch (command) {
      case "run": {
        const result = await runDaily(config, zoho, state, process.env.BOOKKEEPER_HANDOFF_PATH ?? join(dataDir, "handoff"), {
          reviewer: process.env.BOOKKEEPER_AI_REVIEW === "1" ? { apiKey: process.env.DEEPSEEK_API_KEY ?? "" } : undefined,
          repairMetadata: process.env.BOOKKEEPER_METADATA_REPAIR === "1",
          shared: process.env.BOOKKEEPER_SHARED_PATH ? { path: process.env.BOOKKEEPER_SHARED_PATH,
            localStateDirectory: dirname(statePath), backupKey: process.env.BOOKKEEPER_BACKUP_KEY } : undefined,
        });
        console.log(JSON.stringify({ command, result }, null, 2));
        if (result.status === "error") process.exitCode = 1;
        break;
      }
      case "handoff": {
        const handoffDirectory = process.env.BOOKKEEPER_HANDOFF_PATH ?? join(dataDir, "handoff");
        const shared = process.env.BOOKKEEPER_SHARED_PATH ? { path: process.env.BOOKKEEPER_SHARED_PATH,
          localStateDirectory: dirname(statePath), backupKey: process.env.BOOKKEEPER_BACKUP_KEY } : undefined;
        const storageErrors: string[] = [];
        if (shared) try { importSharedInbox(shared, handoffDirectory); } catch (error) { storageErrors.push(String((error as Error).message)); }
        const imported = importInbox(config, state, join(handoffDirectory, "inbox"));
        const extra = { imported, lastRun: state.getRuntime("last-run"), notifications: pendingNotifications(config, state) };
        if (shared) try { publishShared(config, state, shared, extra); } catch (error) { storageErrors.push(String((error as Error).message)); }
        exportPending(config, state, join(handoffDirectory, "pending.json"), extra);
        console.log(JSON.stringify({ command, imported, storageErrors }, null, 2));
        if (imported.errors.length || storageErrors.length) process.exitCode = 1;
        break;
      }
      case "restore-backup": {
        if (typeof args.source !== "string" || typeof args.destination !== "string") throw new Error("Supply --source and a NEW --destination outside Drive.");
        restoreBackup(args.source, args.destination, config.company.zohoOrgId, process.env.BOOKKEEPER_BACKUP_KEY ?? "", process.env.BOOKKEEPER_SHARED_PATH);
        console.log(JSON.stringify({ command, restored: args.destination, status: "verified-offline-copy", note: "Not activated. Keep the old state until the restored copy has been reviewed." }));
        break;
      }
      case "audit": {
        const results = await auditSourceLedgers(config, state, zoho);
        console.log(JSON.stringify({ command, status: results.length ? "checked" : "not-verified", results,
          note: "Cash audit scope and classification coverage are reported separately. No accounting writes." }, null, 2));
        if (!results.length || results.some(r => r.status !== "verified")) process.exitCode = 1;
        break;
      }
      case "categorize": {
        const result = await categorizeTransactions(config, zoho, state);
        const p = buildFlagNotification(config, state.getOpenFlags(config.company.name), state);
        if (p) payloads.push(p);
        console.log(JSON.stringify({ command, result, notifications: payloads }, null, 2));
        break;
      }

      case "close": {
        const year = Number(args.year);
        const month = Number(args.month);
        if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(month) || month < 1 || month > 12) {
          throw new Error("--year and --month (1-12) are required for close.");
        }
        const statementBalances: Record<string, number> = {};
        const tdAccount = config.accounts["tdBank"];
        const qsAccount = config.accounts["quicksilver"];
        const tdBal = argNumber(args, "td-statement-balance");
        const qsBal = argNumber(args, "quicksilver-statement-balance");
        if (tdBal !== undefined && tdAccount) statementBalances[tdAccount] = tdBal;
        if (qsBal !== undefined && qsAccount) statementBalances[qsAccount] = qsBal;
        // Rent received per unit: --rent-unit-down 2000 --rent-unit-up 1500
        const rentReceived: Record<string, number> = {};
        for (const unit of config.units) {
          const r = argNumber(args, `rent-${unit.id}`);
          if (r !== undefined) rentReceived[unit.id] = r;
        }
        let supplementalReviews: CloseInputs["supplementalReviews"];
        if (args["supplemental-review-file"] !== undefined) {
          const path = args["supplemental-review-file"];
          if (typeof path !== "string" || !path.trim()) throw new Error("--supplemental-review-file requires a private JSON file path.");
          const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
          if (!Array.isArray(parsed)) throw new Error("Supplemental review file must contain an array of account reviews.");
          supplementalReviews = parsed;
        }
        const report = await runMonthlyClose(config, zoho, state, {
          year,
          month,
          statementBalances,
          supplementalReviews,
          rentReceived,
          requireSourceAudit: true,
          asOfDay: new Date().getDate(),
          freedomLoanBalance: argNumber(args, "freedom-loan-balance"),
          freedomEscrowBalance: argNumber(args, "freedom-escrow-balance"),
          manualReview: typeof args["reviewed-steps"] === "string" ? {
            period: `${year}-${String(month).padStart(2, "0")}`,
            reviewer: String(args.reviewer ?? ""),
            note: String(args.note ?? ""),
            steps: args["reviewed-steps"].split(",").map((s) => s.trim()),
          } : undefined,
        });
        payloads.push(buildCloseNotification(config, report, state));
        console.log(JSON.stringify({ command, report, notifications: payloads }, null, 2));
        break;
      }

      case "escalate": {
        const escalated = pendingEscalations(config, state);
        const initial = buildFlagNotification(config, state.getOpenFlags(config.company.name), state);
        if (initial) escalated.unshift(initial);
        console.log(JSON.stringify({ command, notifications: escalated }, null, 2));
        break;
      }

      case "doctor": {
        const transactions = await zoho.listBankTransactions({ uncategorizedOnly: true });
        console.log(JSON.stringify({ organizationId: config.company.zohoOrgId, writeEnabled: process.env.BOOKKEEPER_LIVE === "1",
          uncategorized: transactions.length, accounts: [...new Set(transactions.map(t => t.accountName))], transactions }, null, 2));
        break;
      }

      case "flags": {
        console.log(JSON.stringify({ flags: state.getOpenFlags(config.company.name) }, null, 2));
        break;
      }

      case "review-flag": {
        const id = String(args.flag ?? "");
        const flag = state.getFlag(id);
        const reviewer = String(args.reviewer ?? "").trim();
        const note = String(args.note ?? "").trim();
        if (!flag || flag.companyName !== config.company.name || !reviewer || !note) {
          throw new Error("Provide a flag for this company, --reviewer, and --note.");
        }
        if (args.decision === "approve") {
          state.approveFlag(id, reviewer, note);
        } else if (args.decision === "acknowledge") {
          state.updateFlag(id, { status: "acknowledged", notes: `${reviewer}: ${note}` });
        } else if (args.decision === "resolve" && flag.type !== "posting-uncertain") {
          state.resolveFlagAndRequeue(id, `${reviewer}: ${note}`);
        } else {
          throw new Error("Use --decision approve|acknowledge|resolve. Uncertain postings require recover-posting.");
        }
        console.log(JSON.stringify({ flag: state.getFlag(id) }, null, 2));
        break;
      }

      case "recover-posting": {
        if (args["confirm-workers-stopped"] !== true ||
            (typeof args["remote-id"] === "string") === (args["confirmed-not-posted"] === true)) {
          throw new Error("Stop all workers; pass --confirm-workers-stopped and exactly one of --remote-id or --confirmed-not-posted after verifying Zoho.");
        }
        const id = String(args.transaction ?? "");
        state.recoverPosting(config.company.name, id,
          typeof args["remote-id"] === "string" ? { remoteId: args["remote-id"] } : { confirmedNotPosted: true },
          String(args.reviewer ?? ""), String(args.note ?? ""));
        console.log(JSON.stringify({ posting: state.getPosting(config.company.name, id) }, null, 2));
        break;
      }

      default:
        throw new Error("Unknown command. Use: run | doctor | categorize | close | escalate | flags | review-flag | recover-posting | handoff | audit | restore-backup");
    }
  } finally {
    state.releaseWorkerLock();
    state.close();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err?.message ?? err) }));
  process.exit(1);
});
