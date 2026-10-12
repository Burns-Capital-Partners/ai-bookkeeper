# AI bookkeeper

**Start here:** [use the system for a new or existing entity](docs/START_HERE.md). Every setup follows the [shared Drive filing checklist](docs/DRIVE_FILING.md) to create or reuse Bookkeeping folders and a statement index. Every entity has a concise [work summary and owner/CPA context sheet](docs/ENTITY_RECORD.md); every working session follows the [improvement loop](docs/CONTINUOUS_IMPROVEMENT.md) so useful lessons reach the shared process and code.

A reusable rental bookkeeping worker and playbook. Zoho Books holds the official books. A scheduled Node worker applies approved rules, keeps its operational history in SQLite, and exchanges evidence, questions and acknowledgments with Muse through a private Drive folder. An optional AI reviewer proposes routine classifications within a budget; it cannot directly post.

Start with the [executive one-pager](docs/EXECUTIVE_OVERVIEW.md) ([PDF](docs/ai-bookkeeper-executive-overview.pdf)) and [flowchart](docs/FLOWCHART.md) ([PDF](docs/ai-bookkeeper-flowchart.pdf)). The [implementation guide](docs/IMPLEMENTATION_GUIDE.md) gives the order of operations, owner interview, source checks, Wave-to-Zoho migration, worker setup and acceptance gates. It consolidates the lessons from two rental builds and their accounting reviews.

Markdown guides are current. The printable PDFs are dated October 7, 2026 snapshots; use the current guides for capability and operating instructions.

For ongoing use: [operator refresher](docs/OPERATOR_GUIDE.md), [monthly close](docs/MONTHLY_CLOSE.md), [year-end close](docs/YEAR_END_CLOSE.md), [CPA handoff](docs/CPA_TAX_HANDOFF.md) and [CPA brief template](docs/CPA_BRIEF_TEMPLATE.md). Future agents can reuse the [private coordination templates](docs/templates/COORDINATION.md) and [lessons learned](docs/LESSONS_LEARNED.md).

## Scope

The implemented workflow supports a USD rental entity using Zoho's US data center, one operating bank account, one card account, configured rental units and mortgage/escrow records. It is a starting point for the next similar property. Funds, waterfalls, general settlement processing, deposits and materially different accounting treatments require explicit design and tests. PDF downloading/extraction, legacy data migration, tax preparation and notification delivery remain agent/operator workflows, not hidden worker features.

The sample configuration is fictional and cannot connect to Zoho. Its rules, allocation, identifiers, tenant patterns and dollar limits are examples, not advice or approved defaults. Keep one deployment per entity. Do not run overlapping workers against the same Zoho accounts.

Property-level books are the default; preserve unit detail where it affects use, tenants, deposits or assets. P&L reports support an explicit cash or accrual policy; optional additional ledger checks prevent closing when their reviewed evidence is missing. Annual depreciation/amortization posting, extra feeds and tenant subledgers remain procedures/adaptations. See the guide's [capability table](docs/IMPLEMENTATION_GUIDE.md#what-the-code-does-today) before deployment. A documented procedure is not an implemented feature.

Set `company.reportingBasis` to `cash` or `accrual` according to the confirmed policy; omission preserves existing accrual behavior. This selects and validates the P&L basis. Complete account registers and trial-balance reconciliation retain their accrual ledger view. Verify actual provider results for each deployment.

Optional `supplementalCloseAccounts` names additional accounts already in `config.accounts`, outside the core bank/card/mortgage/escrow checks. Each requires one exact-month review of movements/classifications plus a source closing balance. Missing or mismatched evidence blocks close. Pass the private review array to `close` with `--supplemental-review-file <path>`; see [review format](docs/IMPLEMENTATION_GUIDE.md#supplemental-ledger-review). The daily runner does not ingest these reviews and will leave these checks incomplete. This adds manual reviewed close checks, not new feeds or automatic classification.

## Install and verify locally

Requires Node.js 24+ and npm. There are no third-party runtime dependencies; TypeScript and Node types are build dependencies.

```sh
npm ci
npm test
npm run typecheck
```

Tests use synthetic fixtures, mock API responses and temporary local SQLite databases. They do not connect to financial accounts. The standalone release includes the first deployment's subsequent repairs for personal expenses, reviewer timeouts, bank-date pagination, existing rent matching and fresh backups after runs. See [PROVENANCE.md](PROVENANCE.md).

## Prepare one real entity

1. Follow the interview, independent source preflight and migration stages before automating classifications. Inventory existing records; do not replay legacy transactions merely because this worker has empty state. Verify legacy closing, new opening, pilot and current balances after historical corrections.
2. Copy `config/example-property.json` to `config/<entity-slug>.json`. Real configs are Git-ignored. Replace the organization, account names, bank IDs, customer IDs, rules, rent patterns, allocations and notification destination with verified values. Set `company.example=false` only for the reviewed real config. The keys `tdBank` and `quicksilver` are legacy internal roles for operating bank and card; the actual names and IDs are configurable.
3. Build with `npm run build`. On the Mac run `node scripts/prepare-mac.mjs --config <entity-slug>`. This prepares private files but starts nothing. Runtime lives under `~/Library/Application Support/AIBookkeeper/<entity-slug>/`; each entity receives a different job label, database, env file and handoff folder.
4. Enter Zoho credentials in that private `bookkeeper.env` file. A Generate Code authorization code is not a refresh token: exchange the approved one-time code using the matching OAuth client and securely retain the returned refresh token. Begin with the scopes required for the intended read checks; verify the required write grants separately before authorized production use. Never put values in chat, Git, screenshots or logs. Confirm data-center compatibility.
5. Follow [DRIVE_FILING](docs/DRIVE_FILING.md): read the approved drive's `00) Start Here` guide and create or reuse the entity's Bookkeeping folders and statement index. Set `BOOKKEEPER_SHARED_PATH` to its actual Drive desktop path ending in `Bookkeeping/Worker` and independently save a 32-byte `BOOKKEEPER_BACKUP_KEY` encoded as 64 hex characters. Keep the live database outside Drive. Keep `BOOKKEEPER_LIVE=0`, AI review and metadata repair off until their corresponding setup/authority is verified. Preserve an existing deployed path unless its migration is authorized.
6. Run the read check with the selected env file: `node --env-file="<private-env-path>" dist/index.js doctor --config <entity-slug>`. Its output includes real transaction data; store it privately. A successful read does not prove write authorization or correct books.
7. Follow [MUSE_HANDOFF.md](docs/MUSE_HANDOFF.md) and [AUTONOMOUS_HANDOFF.md](docs/AUTONOMOUS_HANDOFF.md). Prove intake, cloud receipts, a fresh backup restore, actual notification delivery and AI spending controls if enabled. A local exported file is not proof of cloud delivery.

`BOOKKEEPER_STATE_PATH` and `BOOKKEEPER_HANDOFF_PATH` override local defaults. Each deployment must have unique paths and its own Drive folder. State records the organization, name and bank identities and rejects a different deployment. A renamed entity or changed account requires a reviewed migration, not erasing this identity record.

## Verify, then schedule

Prepare a concrete posting plan for one complete month. Obtain the necessary production authorization, enable writes deliberately, run the month, reconcile actual entries and classifications against evidence, then rerun unchanged inputs and prove no new entries. Resolve uncertain posting outcomes by inspecting Zoho before retrying. A successful test suite or HTTP request is not this acceptance test.

After launch approval, `node scripts/prepare-mac.mjs --config <entity-slug> --enable` installs the LaunchAgent and triggers an immediate run plus daily 06:00 host-local runs. It refuses known duplicate labels; also inventory other schedulers and older deployments before enabling. A LaunchAgent requires the relevant Mac user session, power/network and usable Drive authentication. It does not create an always-on server. Observe one unattended run, fresh recoverable backup and delivery acknowledgment.

`run`, `categorize` and `close` are posting commands and require `BOOKKEEPER_LIVE=1`. **There is no pretend live dry-run mode.** `doctor` and `audit` read provider data; `handoff`, review and recovery commands can update local operational state. Consult the implementation guide for command arguments and authority boundaries.

## Reuse and sharing

This project's code and documentation are available under the [MIT license](LICENSE). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for scope, privacy rules and verification steps.

Personal reports, statements, original tenant details, credentials and runtime history belong in each entity's private storage. Use synthetic fixtures for examples and tests. Do not copy a production checkout or its Git history into this repository, or include private records in public issues, pull requests or Actions logs.

To start another build, give an agent access to this repo and the entity's private records, then say:

> Follow docs/IMPLEMENTATION_GUIDE.md for [entity] and [private folder]. Read existing context/status first, batch unresolved factual questions and ask me real business decisions. Lead the authorized source checks, legacy migration, smallest worker adaptation and acceptance checks. Preserve filed history and one current status. Include the CPA reporting basis and allocations already applied. Continue independent work while questions are pending. Do not call the system operational until the month, unchanged rerun, schedule, delivery and recovery are proven.

GitHub is the canonical reusable process/code version. Entity-specific decisions and live status remain in the approved private workspace. A copied Drive guide should name its repository revision; do not maintain competing current playbooks.
