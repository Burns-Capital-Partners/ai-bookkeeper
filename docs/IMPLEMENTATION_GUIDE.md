# Build an AI bookkeeper for the next entity

Version 1.14 | October 9, 2026 | Consolidates two rental builds and their review lessons

Use this as the lead agent's runbook. Start with one property and one completed month. The goal is reliable prior-month books by the following 7th, with approved work continuing without daily owner supervision. The owner supplies business decisions; the agent prepares, verifies and advances the authorized work.

Read [README](../README.md), [capability limits](#what-the-code-does-today), the entity's current private status and existing answers before starting. This guide supplies a process, not permission to change live accounts. Do not turn another property's rules into defaults.

## Order of operations

| Stage | Work | Evidence required to advance |
|---|---|---|
| 1. Scope and interview | Read the drive's Start Here guide; establish Bookkeeping folders/index and account, use and policy history | Verified filing home, dated owner answers, account map, cutover/pilot month, unresolved questions |
| 2. Source preflight | Inventory existing files; collect pilot and opening evidence; assess legacy reliability | Verified coverage manifest and independent balance bridges |
| 3. Zoho and migration | Verify organization, chart and basis; prepare only missing history or supported opening entries | Reviewed migration proposal, authorized application, source-to-ledger reconciliation |
| 4. Worker preparation | Confirm fit; configure isolated runtime, shared handoff, recovery and permissions | Tests, read check, accepted inputs, cloud receipts and offline restore |
| 5. Financial acceptance | Execute the authorized month; inspect entries and both historical/current balances | Reconciled month, classification review, unchanged rerun with zero new entries |
| 6. Periodic operation | Enable one authorized schedule and collector; observe outcomes | Unattended run, delivered exception, fresh recoverable backup, named operator |

Collect a useful statement during the first login. Inventory larger history before requesting another session. Source verification must precede importing old books or inventing an opening correction. Code preparation and independent source collection may proceed together; posting waits for the dependent decisions and evidence.

## 1. Conduct a practical owner interview

Prefill known answers from private records. Ask unresolved factual questions in numbered batches grouped by account or period; ask real design decisions separately with plain-language tradeoffs. Include a proposed answer where evidence supports one, allow "unknown," and record uncertainty rather than learning from a guess.

| Topic | Questions to settle |
|---|---|
| Entity and outcome | What legal/tax entity, property, currency, fiscal year and jurisdiction? Who owns it? What must be ready and by when? Who operates it and who reviews taxes? |
| Books and cutoff | Where are the current books? Were prior months reconciled or merely categorized? Which years are filed/closed? Migrate full detail, only open periods, or a verified opening snapshot? What already exists in Zoho? |
| Reporting basis | Which cash/accrual method did the prior return use? What book/report basis does the owner/CPA require? Do not assume Zoho's default is the adopted policy. |
| Account history | Which bank, card, wallet, mortgage, escrow, deposit and other loan accounts belong here? Record masked identity, Zoho ID, role, ownership and effective dates, including renamed/closed accounts and earlier aliases. Which accounts are shared with other entities? |
| Rent and PM records | Who occupied each unit, when, at what rent? Lease changes, late payments, advance/last-month rent, concessions, fees and tenant moves? Which PM system holds leases, rent history and settlement/deposit reports? Treat expected amounts as clues to verify. |
| Receipt routes | Where is tenant money first received: bank, PM, personal wallet or another account? When is it recognized? How do subsequent settlements, cashouts, fees and refunds avoid counting it again? |
| Security deposits | Where are refundable funds held? What is owed to each current/former tenant, including transfers between units, refunds, deductions and interest? Is custody pooled across properties? Separate tenant obligations from operating cash. |
| Property use | Any owner occupancy, personal days, vacant periods, short-term to long-term conversion or change in rental use? Exact dates and supported allocation? Are shared expenses already allocated? Which costs are direct rental, direct personal or shared? |
| Transfers and owner activity | Which transfers are draws, funding, reimbursements or actual intercompany loans? Any property bills/refunds paid personally, accidental personal card charges, cash payments or business charges paid by another entity? |
| Assets and financing | Acquisition/closing records, renovations, appliances, disposals, refinance, solar/other financing, capital invoices and insurance recoveries? Obtain prior asset/depreciation/amortization schedules and relevant redacted tax schedules early. |
| Automation authority | Which rules may post automatically? Amount limits and exact recurring exceptions? May explicit answers become narrow future rules? May eligible proposals apply after a deadline? What remains held indefinitely? Who approves historical repairs? |
| Access and follow-up | Authorized API/feed/browser methods, approved password-manager references, MFA owner, recovery path, private storage and notification channel? What reminders and repairs are allowed? Who can act when the owner is away? |
| Unrecorded events | "What happened that these records won't explain?" Prompt for tenant turnover, deposit refunds, account repurposing, family payments, duplicate profiles, personal use and one-off work. |

Property-level reporting is the default. Preserve tenant/deposit, asset and use-history detail where it affects treatment. Multiple units do not by themselves justify splitting every cost or creating extra ledgers. Do not assume 50/50 or reuse the fictional sample ratio. Save each material fact with its source, effective dates, confidence and superseded answer.

## 2. Establish private records and verify sources

Complete [DRIVE_FILING](DRIVE_FILING.md) on every new entity setup: read the approved shared drive's `00) Start Here` guide, create or reuse its Bookkeeping layout, and establish the linked statement index. Follow that drive's existing entity structure, for example `<shared drive>/Investments/<entity or property>/Bookkeeping`. File statements by institution/source and issue year, reports/CPA packages by reporting year, and operational evidence/history under Worker. Reuse this layout and update the same index as new records arrive; do not repeat completed setup or create another archive.

Preserve the canonical STATUS.md URL. Follow [ENTITY_RECORD](ENTITY_RECORD.md), using the [status template](templates/STATUS.md) only when a record is missing. Verify shared read/update access early. Keep STATUS.md to a short running summary and CONTEXT.md to a concise owner/CPA context sheet; link existing detailed access/evidence records and queues. The [coordination templates](templates/COORDINATION.md) support larger workspaces; never populate them with real data in Git.

These are operator records, not additional services. Worker-managed shared inbox/snapshots and encrypted backups live under `Bookkeeping/Worker` and follow [MUSE_HANDOFF](MUSE_HANDOFF.md) and [AUTONOMOUS_HANDOFF](AUTONOMOUS_HANDOFF.md). Keep the active SQLite database and credentials outside Drive. Git contains code, generic guides and synthetic examples only.

### Collect without repeated sign-ins

1. Read the inventory and locate existing files before reporting them missing. Use `unlocated` when the search is incomplete. Prefer existing authorized exports/APIs and native Zoho feeds; confirm actual account, provider and through-date in the UI. Do not build a separate Plaid connection merely because Zoho has not been inspected.
2. Register each source's account scope, official portal, operator/host, authorized method, MFA/session requirements and recovery action. Save only password-manager item references. Credentials entered, a successful login and proven unattended access are three different states.
3. At first access, verify the account and download one pilot statement plus adjacent coverage if necessary. Collect the planned missing batch while that session is live. For recurring collection, attempt authorized access automatically and ask for help only at an actual authentication/permission blocker. Do not weaken MFA.
4. Confirm files exist, are readable, show the expected account/period and contain actual transactions/balances. Preserve original bytes and SHA-256. A click, screenshot, year selector or filename is insufficient; watch for partial exports, duplicate bytes and an HTML login page saved as PDF. Label browser observations separately from provider originals.
5. Normalize amounts to cents, signs, posted dates, source IDs and source periods. Bridge card billing cycles and bank statement cutoffs to the requested calendar month; do not compare yesterday's ledger with today's bank display. Record pending items separately.
6. Collect leases, PM gross-to-net settlements, fees, rent/deposit history, mortgage paid principal/interest/escrow and escrow disbursements, other loan statements, receipts and capital invoices. A receipt supports an existing transaction; it does not create another expense.
7. Obtain relevant redacted prior tax/asset schedules. Keep unrelated personal/account data outside scope. Upload or send sensitive records only to an authorized destination/provider.

After the pilot, compare owner batch downloading, supported feeds/exports and agent browsing using actual human minutes, repeated MFA, failures and coverage. Choose the simplest reliable method; do not assume browser automation is always faster.

### Prove amounts and meaning independently

For each cash/escrow account, bridge opening balance + inflows - outflows = closing balance. For cards, bridge opening debt + purchases/fees/interest - payments/credits = closing debt, with signed presentation explained. Trace transfers, refunds, source IDs and reciprocal entries. A matching balance does not prove correct purposes.

Reconcile rent to leases and received payments, not a fixed twelve-payment count. Extra receipts can be late prior rent, advance rent, another tenant or deposits. Refundable deposits need a separate tenant-liability schedule and custody reconciliation; missing evidence does not establish zero liability. Last-month/advance rent is not automatically a refundable deposit. [IRS rental-income and deposit guidance](https://www.irs.gov/publications/p527).

Do not classify every transfer as rent, every card credit as cash back, or every payment from a personal account as personal spending. Identify the property event and the funding leg separately. Pooled deposit cash is not automatically attributable to one property or spendable. Tax treatment and jurisdiction-specific deposit obligations require the applicable policy review.

## 3. Set up Zoho and migrate legacy books once

Verify the actual organization, plan/API capabilities, currency/data center, fiscal dates, reporting basis and chart of accounts. Creating an organization, purchasing a plan, accepting terms or changing policy needs the applicable authorization. Preserve already recorded/reconciled entries. Official ledger = Zoho, never the worker's SQLite.

1. Archive Wave/other legacy transaction exports, source IDs, chart, opening/closing trial balances, P&L, balance sheets, journal details, receipts and filed-year context. Inventory every relevant legacy profile and account alias.
2. Assess reliability against bank/card/lender records. If legacy books were never reconciled, reconstruct the affected periods before relying on their balances. A filed tax return supports prior treatment; it does not prove the bank balance.
3. Choose the agreed cutover: detailed missing history, a supported opening snapshot, or a documented combination with nonoverlapping coverage. Retain excluded history as an archive. Do not reopen a filed year merely to achieve complete transaction detail; resolve effects on the new opening separately and refer tax changes to the CPA.
4. Prepare an account map, source-to-target IDs, proposed rows, duplicate candidates, rejected rows, coverage and before/after totals. Same date/amount is a candidate, not proof of duplication. Clear virtual/internal transfer accounts only when both reciprocal legs and economic purpose are established; hold missing counterparts.
5. Search **all dates** in Zoho for existing opening, carryforward, reconciliation and later corrective entries affecting the same account. A historical correction can duplicate a later fix. Include owner/equity counterpart accounts and draft/published status in the review.
6. Obtain concrete authority for the exact migration/corrections. Apply a small verified batch first, then the remaining approved work. Retain Zoho IDs and import failures; query uncertain results before retrying. A rendered form or HTTP success alone is not proof of the posted amounts/status.
7. Reconcile source-to-ledger totals at the legacy closing date, new opening date, pilot month-end **and current date**. Inspect classifications and report basis. Normal year-to-year balance carryforward does not require another copy of the same opening journal.

An empty worker database is normal for a new deployment; it is not authority to replay old books. Existing Zoho entries must be identified/matched by the applicable code or a reviewed reconciliation procedure before posting. Never fix a difference with an unexplained plug or delete history to make a test pass.

## 4. Prepare the worker on its actual host

### What the code does today

| Capability | Current boundary |
|---|---|
| Configurable rental worker | USD, US Zoho data center, one operating bank + one card role, configured units and mortgage/escrow workflow. Legacy role keys `tdBank`/`quicksilver` are internal names, not fixed provider identities. |
| Posting and recovery | Deterministic rules, guarded journals/transfers, local source/posting history, lock and explicit recovery for uncertain outcomes. One writer per overlapping Zoho account set. |
| Shared handoff | Structured statements/context/answers, immutable input IDs, revisions/fingerprints, worker acceptance/errors, shared snapshots, encrypted backups and delivery receipts. Raw PDFs are not automatically ingested. |
| Routine AI review | Optional DeepSeek proposal path, narrow learned rules from validated explicit answers, eligible 72-hour provisional decisions and $5 per-deployment local-calendar-month budget. No model tools or direct accounting writes. |
| Reports | `company.reportingBasis` selects cash or accrual P&L; omission preserves accrual. The response must confirm basis and effective dates. Register/trial-balance reads retain the complete accrual ledger view. Synthetic tests do not prove an entity's live report visibility. |
| Annual entries | `depreciation.frequency` is descriptive configuration. There is **no implemented annual depreciation/amortization posting command**. Use the reviewed agent/operator process in [YEAR_END_CLOSE](YEAR_END_CLOSE.md). |
| Extra accounts/treatments | `supplementalCloseAccounts` requires reviewed evidence and matching ledger balances for named extra accounts. Manual close accepts a review file; daily runs do not ingest it. This adds no extra feeds, posting rules or tenant subledger. Multiple cards, loans and PM settlements may still require tested adapters. |
| Collection and notifications | Muse/another authorized collector downloads and normalizes evidence and actually delivers messages. Worker payload generation is not delivery; recurring collector/reminder execution is configured separately. |
| Funds and non-rental entities | Reuse the process and controls, not an assumed compatible rental model. Define investor capital, holdings/valuations, fees, allocations and tax/reporting needs first. |

Read `src/config.ts`, `src/index.ts`, `src/categorizer.ts`, `src/closer.ts`, `src/zoho.ts` and the existing tests when checking fit. Make the smallest required adaptation and add regression coverage for financial behavior. Do not add services, dependencies or a new database just to store context.

### Supplemental ledger review

List extra required ledgers by their exact configured account names in `supplementalCloseAccounts`. They must be distinct, present in `accounts`, and outside the four core bank/card/mortgage/escrow roles. For a manual close, pass `--supplemental-review-file <private-json-path>` alongside the existing close arguments. The JSON file is an array, with one review per required account:

```json
[
  {
    "accountName": "Tenant Deposit Bank",
    "from": "2026-09-01",
    "to": "2026-09-30",
    "closingBalance": 700.25,
    "reviewer": "Authorized reviewer",
    "source": "private-source-reference",
    "note": "All movements and classifications checked against the source.",
    "transactionsVerified": true
  }
]
```

Amounts are account-currency amounts (700.25 means $700.25), not integer cents. Use the same signed convention as the ledger response. Missing, duplicate, malformed, wrong-period, unreadable or mismatching reviews block completion. Posting during close requires a refreshed review and rerun. A balance match alone is insufficient; the named reviewer must inspect movements and classifications. Deposit cash also needs a separate comparison with tenant obligations.

**Manual-only input:** the daily runner and shared monthly-evidence schema do not carry these reviews. A scheduled recheck will mark a configured supplemental account incomplete even after a prior manual close. Preserve the manual acceptance receipt; do not describe supplemental accounts as an unattended close. Add and test a durable review handoff before that deployment requires automatic completion. Leaving required accounts out of config is not a workaround.

### Exact setup sequence

1. Record the source revision. On the deployment checkout, use the locked build: `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`. Node 24+ is required. These are synthetic checks, not evidence of live books.
2. Copy `config/example-property.json` to Git-ignored `config/<slug>.json`. Verify organization, bank IDs/names, chart/customer identities, tenant/rent patterns, allocation, exception limits and destinations. Sample amounts and the sample mixed-use ratio are fictional. Set `company.example=false` only in the reviewed real config.
3. On macOS: `node scripts/prepare-mac.mjs --config <slug>`. It prepares files and starts nothing. Runtime defaults to `~/Library/Application Support/AIBookkeeper/<slug>/` with its own env, state, handoff and job label. Inventory old deployments/schedulers and account overlap; per-host locks do not stop a different host writing the same books.
4. Enter OAuth credentials only in that private `bookkeeper.env`. A Generate Code value is a one-time authorization code; exchange the approved code with the matching client and retain the actual `refresh_token`. Confirm org, scopes and data center. Start with `BOOKKEEPER_LIVE=0`, `BOOKKEEPER_AI_REVIEW=0`, `BOOKKEEPER_METADATA_REPAIR=0`. A read token does not prove write grants.
5. Complete the [Drive filing checklist](DRIVE_FILING.md), then set `BOOKKEEPER_SHARED_PATH` to this entity's actual Drive desktop path ending in `Bookkeeping/Worker`, not the Bookkeeping root. Configure unique state/handoff paths and `BOOKKEEPER_BACKUP_KEY`: 32 random bytes encoded as 64 hex characters. Save a recovery copy in the approved password manager. The live database is local; only backups are additionally encrypted. Shared context/snapshots remain readable to authorized folder members. Preserve an existing worker path unless a controlled migration is authorized.
6. Test the actual host using the commands below. Do not re-enter saved credentials without evidence they failed. Cloud shell output, a remote file read or a configured env key does not prove Mac execution/provider access.
7. Exchange valid source records, context and receipts using the existing handoff contracts. Check accepted IDs and errors in worker output, not just filenames. Keep statement extraction and the source-linked normalized facts independently reviewable.
8. Download a fresh cloud backup, verify its byte hash and restore to a **new** offline database outside Drive. Test integrity and relevant row counts; do not activate it or overwrite the live state during the drill. Verify snapshot and backup cloud receipts separately.
9. If enabling AI, confirm the configured model, current price/token assumptions, authorized data scope and budget behavior first. The code budget is per deployment, not a total across entities or a guaranteed provider bill cap. Queue work when exhausted. Changing models/prices requires budget regression checks.

```sh
# Replace the private env path and slug; outputs can contain financial data.
node --env-file="<private-env-path>" dist/index.js doctor --config <slug>
node --env-file="<private-env-path>" dist/index.js handoff --config <slug>
node --env-file="<private-env-path>" dist/index.js audit --config <slug>
node --env-file="<private-env-path>" dist/index.js restore-backup --config <slug> \
  --source "<actual-downloaded-encrypted-file>" --destination "<new-offline-db-path>"
```

`doctor`/`audit` make provider reads; they can initialize/update local workflow state and audit flags. `handoff`, `flags`, `review-flag`, `recover-posting`, `escalate` and restore operate on local workflow/handoff state; inspect their actual effects and authorization. `run`, `categorize` and `close` are posting commands requiring `BOOKKEEPER_LIVE=1`. **There is no live dry-run command.** Do not execute posting code just to test credentials.

## 5. Prove one completed month and the unchanged rerun

Use [MONTHLY_CLOSE](MONTHLY_CLOSE.md). Prepare exact proposed effects and obtain the necessary production authority. Explicit standing authority can cover approved routine rules; it does not cover arbitrary historical repairs or new policies.

- Record the starting Zoho entries, source IDs, balances, runtime revision and accepted evidence. Resolve account/date/basis ambiguity before posting. Check current bank/card balances as well as the pilot cutoff.
- Execute authorized categorization/close using actual evidence. `close --config <slug> --year YYYY --month M` accepts legacy-named statement/mortgage options; read `src/index.ts` rather than guessing option names. `categorize` is not restricted to that month; inspect its backlog scope first.
- Inspect the resulting Zoho entries, status, reference IDs, actual debit/credit amounts, transfers and classifications. Compare to statements, PM receipts, mortgage splits and owner allocations. Verify that source transactions are matched once.
- Complete/verify Zoho's native reconciliation separately if required by the agreed close. The custom worker audit does not mark the UI's bank reconciliation complete. Record cutoff, difference and evidence/reference.
- Rerun with unchanged inputs and compare actual entry IDs/counts and balances: no new journals, expenses, transfers or income. Reimporting an identical inbox item alone is not this financial rerun.
- When evidence suggests a prior correction, verify a complete bridge through **today**. A correct tax-year report with a doubled current liability fails acceptance.
- Have an independent reviewer inspect evidence, classification and limits. Where the owner requested an external stronger-model audit, obtain the applicable private-data/provider authorization and give it a bounded package; record findings and corrections. Another model's agreement is not a CPA signoff.

A late unpaid tenant can remain on an explicit rent follow-up under the agreed basis/policy; do not manufacture a receipt. Missing statements, balance differences, possible duplicate postings and unsupported capital/historical treatments are different holds. A material unresolved gap prevents an unqualified "reconciled" claim.

## 6. Enable and observe periodic operation

Only after launch authorization, set the reviewed live env flags and run `node scripts/prepare-mac.mjs --config <slug> --enable`. It installs a per-entity LaunchAgent, triggers an immediate run and schedules daily 06:00 **host-local time**. The Mac user session, power, network and Drive authentication matter. Confirm host time zone against entity policy.

The script checks its known conflicting labels; also inspect other LaunchAgents, cron/Railway jobs and agents before enabling. A separate collector/reminder schedule needs its own actual executor and authorization. A saved launch plan, open Codex session or request to "report tomorrow" creates no schedule.

Observe one unattended run, an actual delivered exception/notification receipt, a fresh cloud snapshot/backup, and successful recovery. Check missed runs and restart behavior in the operating arrangement. Keep unchanged healthy checks quiet; surface real action items and overdue monthly completion.

Suggested monthly cadence: approved rules process daily; collector obtains the prior month's remaining sources on days 1-3; agent batches unresolved questions and closes on days 4-6; target is prior month ready by the 7th. Report delays with the actual blocker and next action. This cadence is an operating policy to configure, not a fully implemented scheduler in this repo.

## Coordinate agents without going in circles

One lead owns the plan, status and acceptance. Muse collects/asks/delivers; the host operator manages execution; Codex implements/verifies; the owner resolves decisions; the CPA reviews tax treatment. Roles can be combined when one agent has the actual capabilities.

At every meaningful checkpoint: refresh the current shared status, state what is verified and what remains, continue independent work, then save evidence and the next milestone. Use [COORDINATION](templates/COORDINATION.md). Preserve prior answers and closed items unless new contradictory evidence appears. Do not replace current content with an older local copy.

Keep questions in the shared queue with stable IDs, context, proposed answer, amount/impact, owner and closure proof. Batch them at a meaningful checkpoint; interrupt only for an actual blocker or permission boundary. Give an approximate next checkpoint when justified, never a promise of work after the executor stops. "Prepared," "staged," "accepted," "posted," "reconciled," "tax-final" and "unattended" have different evidence.

When delegation is explicitly authorized and useful, use bounded independent tasks, shared source references and one owner per mutable artifact. Helpers return evidence, limits and findings; the lead verifies/joins before posting. Avoid repeated spawning and multiple ledger writers. Keep a resumable checkpoint when execution cannot continue.

## Exceptions, learning and repair authority

Routine proposals may apply provisionally after 72 hours only under the approved entity policy and implemented eligibility checks. They remain on the unresolved-assumptions ledger until reviewed. Silence must not create a learned rule. Explicit validated owner answers can teach narrow source/account/direction/amount-bound rules; uncertain guesses and broad merchant matches cannot.

Over-limit exceptions require the explicitly configured expected recurring amount to match exactly in cents; mortgage/rent/transfer names alone are not exemptions. Duplicate risk, changed evidence, uncertain posting outcomes, capital treatment, large ambiguous transactions and historical repairs do not expire with the routine timer.

Permitted technical repair should be bounded and recoverable: retry supported reads, recover a documented session or resume after verified outcomes. Do not use automatic repair to invent policy, erase state, suppress evidence, expand permissions or alter a financial journal. For a timed-out write, inspect Zoho/reference IDs before retrying and use `recover-posting` only after workers are stopped and the remote result is established.

Treat an acknowledged alert, successful retry or owner silence as its own state, not resolution. Actual delivery, response, applied treatment and verification need receipts. Reminders should follow the agreed channel/escalation policy and stop when closure is evidenced.

Keep possible savings in a separate optional opportunity list: source fact, uncertainty, potential benefit/cost, next action and disposition. PMI/fees/escrow/subscriptions are review candidates, not eligibility findings or permission to contact vendors/cancel. Do not let this list delay required bookkeeping.

## Annual close, CPA and expansion

Follow [YEAR_END_CLOSE](YEAR_END_CLOSE.md) and [CPA_TAX_HANDOFF](CPA_TAX_HANDOFF.md). Agree who computes schedules, who posts and who reviews; do not assume the CPA edits Zoho. A supported annual schedule must establish current-year expense separately from accumulated balances, preserve filed-year continuity and avoid double allocation. Owner/authorized agent posts approved adjustments once; CPA reviews the package and supplies/approves tax treatment as agreed.

For another similar rental, repeat the fit/interview and isolate account IDs, policies, state, Drive inputs and schedules. Preserve one codebase; do not fork bespoke platform infrastructure by default. For funds, first define investor capital and ownership changes, loans/investments, valuations, accruals, management/performance fees, distributions/waterfalls and CPA reporting. Adopt an established ledger/subledger where needed; this rental worker does not implement those capabilities.

## Acceptance checklist

- [ ] Scope, account/use timeline, basis, cutover and authority are confirmed; unresolved items have owners.
- [ ] Drive Start Here has been read; the shared Bookkeeping layout and linked statement index are verified and reused, with saved coverage/gaps stated accurately.
- [ ] Originals/coverage are verified; migration and opening balances tie independently, including current balances.
- [ ] Required adapters exist and pass meaningful tests; real config is private and account overlap is excluded.
- [ ] Actual-host reads, accepted structured inputs, cloud delivery, key recovery and offline restore are proven.
- [ ] Pilot entries/classifications reconcile; unchanged financial rerun creates nothing new.
- [ ] Native reconciliation and external review requirements are completed or explicitly scoped exceptions.
- [ ] One authorized schedule has run unattended; collection and notification delivery are independently proven.
- [ ] Operator can find status, recover access, complete a month and prepare annual/CPA work without rebuilding setup.

Only then report the agreed steady state. List remaining scoped exceptions plainly; do not call an unfinished period or a prepared schedule complete.
