# AI bookkeeper implementation guide

Version 1.4 | Reviewed October 6, 2026 | Adds recurring access records, staged document collection and a separate improvement queue

Reuse this worker and prove it on one completed month. Keep Zoho Books as the official ledger, one worker as the only automated posting process, and one shared status file for coordination. Ask the owner for accounting decisions and necessary access or launch approvals; handle routine implementation and verification independently.

This is a deployment playbook, not authorization to change live books. This starter supports configurable USD rental entities, one checking account, one card and the existing mortgage/escrow workflow. Verify the fit before deployment. A fund requires additional accounting design.

## Lead the work from intake through acceptance

The AI is responsible for directing and advancing this process. The owner should never have to guess the next step or say "keep going" after a routine update. Choose the next authorized action, perform it, verify the result, update shared status and continue until the agreed acceptance criteria are met.

- At kickoff, state the current stage, immediate milestone and definition of done. First locate and reuse the entity's existing private working area and current STATUS.md; if missing, establish them before collecting records. Record source originals and their inventory, derived/staging inputs, migration mappings/rejected rows and verification reports in discoverable locations. Keep sensitive records out of Git, verify exclusions when an existing repository area is used, and keep credentials and live worker state separate.
- Give concise progress updates during sustained work and at each material milestone: what is verified, what is happening next, what needs the owner's action and what remains before completion. Keep the same summary at the top of STATUS.md and merge current shared contents before updating. A progress update is not a stopping point.
- Continue independent authorized work while a question, receipt, access request or approval is pending. Do not end a turn merely because one source check or document is finished, or offer to do an already-authorized next step. Read existing records and previous answers before asking the owner to supply information.
- Pause only for a real unresolved business/design decision, necessary access, a concrete approval boundary, an explicit owner pause, or an execution limit. Identify exactly what is blocked, why, the smallest owner action needed and what can still proceed. Prepare reviewable results before requesting consequential approval; silence and "keep going" do not supply missing financial authority.
- Completion requires evidence for the agreed stages, including the verified month, unchanged rerun, observed unattended schedule, exception delivery and recovery. Provide a final handoff with remaining agreed exclusions and the verified operating arrangement. Do not promise work after the turn unless a persistent execution mechanism has actually been established. After launch, keep unchanged nonactionable monitoring quiet.

## Establish access and collect documents in stages

At intake, create an access register in the private working area for every required bank, card, lender, property manager, accounting system and document source. Record the entity/account scope, official portal, supported feed/API/export/browser method, authorized operator and host, and the existing approved password-manager item reference if available. The owner enters credentials directly into the vendor or approved password manager; passwords, tokens, session cookies, recovery codes and MFA seeds never belong in chat, STATUS.md, source archives or Git. Do not claim recurring access is configured merely because a browser is currently signed in.

For each source, record the actual login requirements: password/passkey/SSO, MFA method, who can approve prompts, session expiry if observed, device restrictions, download limitations, observed failures and the next recovery action. Mark unknown requirements as unverified. Distinguish successful sign-in, successful account-scoped download, successful repeat access and proven unattended collection. Prefer existing approved integrations with only the permissions needed; obtaining a new credential, expanding access or accepting terms requires the applicable owner approval. Do not disable MFA or evade access controls to remove friction.

Collect records progressively:

1. Establish scope and private storage first; reuse existing files and record coverage gaps.
2. During the first successful login, confirm the account and collect one relevant statement or equivalent source for the pilot month, plus an adjacent statement when calendar-month coverage crosses statement dates. Record available history and any export limits while the session is live.
3. After inventorying coverage, collect the larger history needed for migration and open exceptions in a planned batch. Do not delay an immediately useful document until another login, or download every unrelated account by default.
4. Preserve source originals with acquisition date, source/account, statement period, file hash and stable location before extraction. Keep normalized data and interpretation separate. Verify downloads actually exist and are readable; a clicked download button is not evidence of collection. Upload sensitive originals only to the specifically approved destination and scope.
5. Ask for prior tax-return context early where relevant, preferably the redacted property schedules and depreciation detail. Use it to locate assets, prior treatment and questions; it does not prove current balances or authorize copying known errors. Connect property-management software when available to obtain signed leases, payment histories, deposit records and gross-to-net statements. Ask for context clues such as typical rent, settlement delays and known unusual events, then verify them against sources.

## Track opportunities separately from accounting exceptions

Maintain a small improvement queue alongside the mandatory review queue. An opportunity is a possible saving or operational improvement; it is not a confirmed accounting correction or permission to change a contract. Examples include mortgage-insurance cancellation review, recurring bank fees, unused subscriptions, insurance premium changes, escrow overages, unclaimed reimbursements and financing or service-contract end dates.

Each opportunity needs an ID, entity/account scope, dated source evidence, observed fact, uncertainty, estimated gross benefit and assumptions (or "not quantified"), known costs/effort, priority, named owner, next action and review date. Keep suspected savings separate from verified savings. For mortgage insurance, establish the actual insurance/loan type and applicable servicer/investor criteria, including property type and occupancy, before suggesting eligibility; do not apply a generic loan-to-value threshold to every loan. Do not treat a loan payment as a service fee or assume a financed system can simply be cancelled.

Present the few actionable opportunities in the monthly report without blocking the close unless the finding also reveals an accounting error. Lender contact, cancellation, new valuations with fees, refinancing and other consequential changes require the owner's specific instruction. Close an opportunity only with a documented disposition; mark savings realized only after the changed billing or other outcome is verified, including related costs. The review queue still tracks missing evidence, failed automation, human re-review, owners and closure proof independently.

## 1. What exists and what has been proven

| Component | Responsibility | Reuse boundary |
|---|---|---|
| Zoho Books | Official journals, account balances, reports, native bank feeds and matching | Use the new entity's verified organization and account IDs. Preserve existing entries. |
| Node.js and TypeScript worker | Approved rules, posting guards, matching, source audits, monthly checks and AI proposals | Reuse the implementation and tests; remove specific example property bindings only where the new entity requires it. |
| Mac mini and macOS LaunchAgent | Run the built worker periodically | One job per isolated entity deployment; Node 24+ is required by the existing setup. Codex is not part of execution. |
| Local SQLite | Accepted context, source IDs, posting history, locks, reviews, learned rules, notification receipts and AI budget | Keep one authoritative private database per deployment. It is durable operational history, not the official general ledger. |
| Google Drive for desktop | Shared inbox, readable status snapshot, source documents and encrypted database backups | Use a verified private folder for each entity. Do not sync the live database or credentials. |
| Muse | Collect records with its browser, obtain owner answers, submit structured inputs and deliver notifications | Verify actual collection and delivery capabilities. Chat memory is not the accounting record. |
| DeepSeek API | Propose treatments for unfamiliar routine transactions | No tools or direct posting authority. The worker validates proposals and enforces limits. |
| Codex | Adapt, test, review, deploy and diagnose the worker | Can administer the Mac through a connected Mac chat. A Windows shell command still runs on Windows. |

The standalone code includes recovered fixes from the first deployment and local regression tests. Automated tests do not establish live posting, a verified month, or unattended operation for a new entity. Recreate those acceptance receipts for each deployment.

## 2. The six stages in execution order

**Interview the owner and confirm scope -> set up Zoho and migrate Wave -> connect sources and prove coverage -> prepare the worker -> verify a live month and rerun -> enable and observe the schedule.** Code preparation can proceed while records are collected, but production posting must use the reviewed migration baseline. Do not restart a completed migration: inventory what is already in Zoho and fill only proven gaps.

### Stage 1. Interview the owner and capture the accounting context

**Lead: Codex; Muse can continue the conversation. Decisions: owner, with their accountant for unresolved accounting treatment.** Complete this before choosing migration mappings or automating classifications. The interview establishes what the transactions mean; a bank connection cannot supply all of that context.

**How to conduct the conversation**

1. Read shared status, prior owner answers, existing books and available documents first. Draft the account map yourself. Verify technical IDs, credentials, balances and downloaded files through tools; do not make the owner rediscover them.
2. Start with what is known and the highest-impact gap. Ask **one consequential question at a time** in plain English. Use the question bank below as coverage for the agent, not a questionnaire to paste into chat. Follow only applicable branches.
3. For a choice, recommend an option and explain the practical tradeoff. For a factual ambiguity, show the actual transaction and ask what happened; do not lead the owner into confirming a guess. Accept “I don't know” and trace the documents.
4. Retain confirmed platform preferences unless this entity introduces a conflict. Do not re-ask whether to use the Mac, Drive or Muse just because a new agent takes over. Separate business decisions from routine implementation details.
5. Finish with a short readback of the rules, limits and remaining unknowns. Invite corrections, then proceed with authorized work. Follow up only on a contradiction, missing decision or new event that changes treatment.

**Question bank, in dependency order**

1. **Outcome and intervention.** “What would make these books useful to you each month?” Establish required reports, deadline, first month to verify and tolerance for unresolved items. example property's answer was the prior month ready by the 6th/7th, with exceptions visible; exact daily balance agreement was unnecessary. Distinguish an operational launch from a fully verified historical month.

2. **Entity and ownership.** “What belongs inside this set of books?” Establish legal entity, owners, properties/units and any personal use; distinguish another property in the same entity from another entity. Confirm the intended accounting basis with existing reports/accountant where needed. Read currency, fiscal year, timezone and Zoho organization from the system, then resolve conflicts. Funds follow the additional requirements in section 8.

3. **History and cutover.** “How far back do you need transaction-level history inside Zoho?” Explain detailed Wave migration versus retained archives plus opening balances. Then establish the cutover date and known prior-year corrections. Inspect partial imports before asking the owner to redo anything. Identify anyone or anything still entering transactions, and assign responsibility for year-end adjustments and accounting sign-off.

4. **Accounts and money routes.** “Talk me through how money moves into and out of this property.” Walk through the prepared map of bank, card, loan, Venmo/payment-service and personal/intercompany accounts. Confirm ownership and when it changed. Follow up on cash, owner-paid costs, reimbursements, contributions and loans that must be repaid. A transfer's amount or bank description alone does not establish rent or equity.

5. **Expected income.** “For each tenant or income source, what payment should we normally expect?” Capture payer aliases, unit/customer, amount, due date, payment channel and effective dates. Ask when payment counts as received if it first lands outside the business bank. example property recognizes tenant rent received in personal Venmo; a later cashout must not become rent again. Do not copy that treatment without the new entity's confirmation.

6. **Income exceptions.** “What makes payments differ from that normal pattern?” Follow up where applicable on late or partial payments, arrears, combined months, advance rent, deposits, fees, refunds and chargebacks. Ask how payments are attributed when no month is stated. For a property manager or payment processor, obtain the breakdown of gross receipts, fees, reserves and net payout. Known unpaid rent is different from missing evidence; a deposit or net settlement must not be forced into ordinary rent.

7. **Expenses and allocation.** “Which costs are entirely for the property, entirely personal, or shared?” Establish recurring vendors, unit-specific costs, the basis of shared allocations and effective dates. Ask how to handle reimbursements and refunds against earlier expenses. example property's 50.6% shared rental allocation and full personal-expense treatment are property-specific examples. Ownership percentage alone is not an instruction to apply that percentage to every transaction.

8. **Debt and unusual events.** “Are there loans or one-off events we need to treat separately?” Use existing mortgage statements to confirm principal, interest, escrow and actual payments; ask about refinances, servicer changes, owner/intercompany debt, purchases, sales, major improvements or insurance proceeds when present. Establish who supplies missing treatment. Estimated amortization and next month's amount due cannot substitute for the actual paid split.

9. **Documents and access.** “Where do the supporting records already arrive, and which are difficult to obtain?” Inventory bank/card, mortgage/escrow, rent, invoices and receipts in existing downloads, email, Drive and portals. Identify who can supply business purpose or complete MFA when blocked. Establish which missing receipts require a hold and which allow a documented follow-up; implement that policy explicitly. Never request passwords, tokens or backup keys in the conversation.

10. **Automation authority.** “When something is unfamiliar, what may the system decide without waiting for you?” Read back existing preferences; ask only for changes or entity-specific limits. Cover automatic approved rules, the amount threshold, exact expected recurring exceptions, narrow learning from answers, one-off answers, provisional timeout and permitted repairs. example property chose 72-hour routine proposals with a persistent assumptions ledger; silence must not create a permanent learned rule. Confirm whether the AI budget is per worker or shared across entities.

11. **Ongoing responsibility.** “Who should handle an exception the system cannot resolve?” Establish the conversation and attention channel, escalation/reminder cadence, backup contact if any, and who maintains access or corrects accounting. Automate collection attempts and ask for human help only at a real blocker. Keep this small: one lead agent, one shared status file and named owners for collection, runtime and accounting decisions.

**Turn the answers into an executable agreement**

Use the existing shared records and input contract; do not create a second context system. Save each material answer with the owner's actual words, source, effective date and relevant entity/account/unit scope. Use versioned `owner-context` inputs and explicit supersession for corrections. Keep inferred explanations and unanswered questions separate from confirmed facts. Verify worker acceptance, not just that Muse wrote a note.

For each rule, record its implementation outcome: **supported and configured**, **requires a small adaptation**, or **held for manual treatment**. Free-text context informs review; it does not create a deterministic posting rule. Learning from a specific owner answer must follow the validated decision path, while a one-off answer must remain one-off. Deposits, advance-rent liabilities, general net settlements and fund transactions are not general capabilities of the current rental worker. Scope and test any required treatment before automating it; AI must not squeeze it into the nearest available action.

Read back only the consequential agreement: scope/history, money routes, accounting rules, automation limits, monthly target and unresolved items with an owner. Validate representative transactions against it: tenant receipt versus owner transfer; receipt versus later cashout; shared versus wholly personal cost; actual mortgage split; and any applicable deposit, refund or net payout. Confirmed recurring exceptions above $2,500 in example property require an explicitly configured expected amount matching exactly, not merely a “rent” or “mortgage” label.

After launch, when an agent encounters a new payer, rent amount, account, allocation, lender or ownership change, ask a focused follow-up and record its effective date. The owner can also initiate an update through Muse. Do not repeat the whole interview or silently rewrite earlier months. A correction to an already posted transaction needs the existing correction/recovery process, not a second posting.

**Exit evidence:** confirmed policy readback, account map, history boundary, pilot month, document sources and tested examples, with implementation gaps and unresolved treatment named. The interview is complete when applicable decisions are covered, not when every possible question has been asked. Known safe work can proceed while unrelated exceptions remain held.

### Stage 2. Set up Zoho and migrate legacy Wave data

**Lead: Codex prepares mappings and verifies results; Muse can operate the authorized export/import UI. Owner decides history scope and approves the concrete production import.** The bookkeeping worker is not a Wave migration importer. The following migration procedure must be applied to the actual export and current Zoho import templates; a generic upload does not preserve all accounting meaning automatically.

**A. Preserve the source and inventory the destination**

- [ ] Select the correct Wave business profile. Use **Business settings -> Data Export** to request **Accounting** and **Receipts**. Download both: accounting contains journal/transaction, bill, customer and vendor data; receipt images are a separate archive. Repeat for each entity, keeping them separate. [Wave export instructions](https://support.waveapps.com/hc/en-us/articles/4411360860692-Download-your-account-data).
- [ ] Retain immutable originals and export dates; inventory files, coverage and counts. Also retain the chart of accounts, trial balance, balance sheet, P&L and detailed account reports at the migration boundary and for the years being moved. Record the reporting basis and any known Wave errors.
- [ ] Export a before-state from the existing Zoho organization. Inventory prior imports, entries, opening balances, customers/vendors and reconciliations. Build a small mapping file: Wave source ID or stable archive-row reference -> Zoho record ID -> imported, already present, excluded or unresolved. This can be a CSV; no new migration service is needed.

**B. Prepare the correct Zoho organization**

- [ ] Verify organization identity, country/data center, base currency, fiscal year, timezone, reporting basis and access roles. If the organization already exists, inspect it rather than recreating it.
- [ ] Map the Wave chart to Zoho account types and names, preserving bank/card, loan, escrow, equity, income and expense distinctions. Add only missing accounts. Set up customers/tenants, vendors and required unit mappings before transactions that reference them. Use **Accountant -> Chart of Accounts -> Import Chart of Accounts** and the relevant customer/vendor import screens. [Zoho migration sequence](https://www.zoho.com/us/books/help/migration/migrating-to-zoho-books-from-other-software.html).

**C. Choose one opening-balance and history treatment**

| Owner's chosen scope | Treatment to prepare and verify |
|---|---|
| Detailed legacy history in Zoho | Import the approved date range with account mappings and original dates. Reconcile any opening balances to the period before the detailed history; avoid adding the same accumulated activity again at cutover. |
| Opening balances and forward activity only | Preserve the complete Wave archive, bring agreed cutoff balances and outstanding items into Zoho, and start new activity from that boundary. Explicitly state that older transaction detail will remain outside Zoho. |
| Partly migrated already | Compare the existing Zoho records with the Wave export, then import only missing approved records. Never rerun an entire archive simply because migration status is unclear. |

Before committing, inspect **Settings -> Opening Balances**, the date and **Available Balance** values. Zoho accounts for transactions dated before its opening-balance date and has a Sync operation for subsequent backdated changes. Model the combined effect first. Customer/vendor opening amounts and imported unpaid invoices/bills must represent the obligation once, not twice. An unexplained Opening Balance Adjustment is a discrepancy to investigate, not proof that the migration balances. [Zoho opening-balance behavior](https://www.zoho.com/us/books/help/settings/opening-balances.html).

**D. Transform, preview and import the missing history**

- [ ] Download the current sample for each Zoho destination module, map the actual Wave columns and preview a representative set before the approved import. Standard imports use the module's **More -> Import**, followed by field mapping and preview. Save the mapping and rejected-row report. [Zoho import workflow](https://www.zoho.com/us/books/help/import-export/import.html).
- [ ] Preserve invoice/bill/payment relationships where outstanding items or operational histories need them. Use supported journal imports for appropriate ledger history; do not import the same event both as its invoice/payment and again as a journal. Preserve original date, reference, counterparty and account split. Verify debit/credit totals for each journal.
- [ ] For journal batches use **Accountant -> Manual Journals -> More -> Import -> Import Journals**, with the current sample schema. Check reporting method and publication status: a draft journal does not affect the accounts. Retain the returned Zoho IDs in the migration map. [Zoho journal import and publication](https://www.zoho.com/us/books/help/accountant/manual-journal.html).
- [ ] Keep receipt images linked to the migrated transaction or a stable private archive reference. An accounting CSV does not carry the receipt image with it. Verify some links end to end and account for missing images separately.

**E. Accept the migrated baseline**

- [ ] Compare source and destination counts, mapped debit/credit totals, trial balance by account, bank/card/loan/escrow balances, P&L and balance sheet using identical dates and basis. Check outstanding invoices/bills where present. Preserve and explain legitimate corrections instead of blindly reproducing known Wave errors.
- [ ] Check overlap between historical ledger imports, bank statement imports and bank feeds. Feed rows for an already recorded event should be matched to that entry; they must not create another expense or income entry. Verify high-risk examples: transfers, opening entries, mortgage splits, rent and owner funding.
- [ ] Mark the cutover and the remaining historical exceptions in STATUS.md. Keep Wave/archive access until migration evidence is accepted; cancellation, deletions and changes to legacy integrations require their own authority.

**Exit evidence:** selected history range/cutoff, source archive, mapping and exception file, actual Zoho import results, reconciled opening treatment and before/after reports. This is a procedure for the next migration, not a claim that example property's entire Wave history has been independently verified.

### Stage 3. Connect sources and establish a complete month

**Lead: Muse collects. Codex validates against the books.** Locate existing downloads before requesting them again. Prefer existing Zoho bank feeds; inspect their actual configuration and freshness before considering a separate Plaid integration.

Set up the channels below. A feed connection, a downloaded statement, a Zoho attachment and accepted worker JSON are different results; retain evidence for the ones actually needed.

| Source | One-time setup | Recurring input and verification |
|---|---|---|
| Checking/savings | Inspect the existing Zoho Banking account. Connect the correct institution/account if needed, retaining its existing Zoho identity. | Fetch posted transactions; separately retain the statement and any activity needed through calendar month-end. Check coverage, source balances and direction. |
| Credit card | Add/connect a credit-card account, not a checking account or a new duplicate of an imported card ledger. | Card transactions plus monthly statement; bridge the statement-cycle end to calendar month-end. Match the bank's payment to the card credit once. |
| Mortgage and escrow | Map the loan liability, escrow asset and interest/expense accounts; verify authorized access to the servicer portal. The current worker has no lender feed connector. | Muse downloads monthly statements and payment/escrow history. Extract actual paid principal, interest and escrow, cutoff balances and real disbursements into the existing evidence envelopes. A bank debit alone cannot supply the split. |
| Rent/payment services | Confirm tenant/payer identity and the recognition policy; record which service or personal account receives rent. | Verified receipt IDs, dates, amounts and rent-period attribution; link existing journals. Separate the tenant receipt from later settlement/cashout. |
| Receipts and bills | Choose an existing accessible inbox: the entity's private Drive folder or Zoho Documents, plus authorized email forwarding if useful. | Retain legible original, vendor, date, amount and business purpose. Link to the exact transaction; submit a context/evidence/answer input where the worker needs it. Do not turn a duplicate receipt into another expense. |

**Connect bank and card feeds.** In Zoho use **Banking -> Add Bank or Credit Card -> Connect Now**, select the provider offered for that institution (including native Plaid where available), complete the bank's authentication and select only the intended accounts. Verify the account mapping and **Fetch Bank Feeds From** date against the migration map. Inspect the feed status and actual first/last imported dates. Provider availability and historical lookback vary; do not assume every year of Wave history will be fetched. MFA can interrupt later refreshes. [Zoho feed connection](https://www.zoho.com/us/books/help/banking/feeds.html).

**Fill source gaps with statement imports.** When the native feed is unavailable or lacks older dates, use the mapped bank/card's **Import Statement** action. Prefer the institution's CSV/OFX export; map date, description and debit/credit fields and inspect the preview before importing. Zoho also documents PDF import for specified institutions; confirm support in the actual screen instead of assuming every PDF is readable. Limit imports to identified gaps or explicitly match overlapping rows. [Zoho statement import](https://www.zoho.com/us/books/help/banking/add-transactions.html).

**Collect statements and receipts.** Give Muse an institution/account/period checklist and the exact private destination. It should first reuse saved records, then try the authenticated browser download; retain originals before extraction. Record which date range and fields each document proves. Ask the owner for a live authentication or permission step only when blocked. Test one actual download and one resulting accepted packet for every source type, not merely a successful login.

Zoho Documents accepts uploaded files and an organization-specific email inbox, and can attach evidence to existing transactions. Manual journals also have an **Attach Files** action. Use those native facilities where appropriate. The current worker exchanges evidence references and structured inputs; it does **not** automatically upload receipt images to Zoho or run a general PDF/OCR ingestion service. A document in an inbox does not automatically clear a receipt hold or classify a transaction. [Zoho document handling](https://www.zoho.com/us/books/help/documents/documents.html), [journal attachments](https://www.zoho.com/us/books/help/accountant/manual-journal.html).

**Coverage acceptance:**

- [ ] Retain source bank/card activity for the entire calendar month, with opening and closing balances. A statement ending on the 15th or 25th needs evidence for the remaining days. Zero activity needs source proof too.
- [ ] Collect actual paid mortgage principal, interest and escrow, loan/escrow cutoff balances, escrow disbursements, rent receipts and any necessary cash/payment-service records.
- [ ] Compare the source with existing Zoho entries before proposing a write. An empty worker database does not mean empty books. Link verified existing journals rather than replaying historical receipts.
- [ ] Trace opening differences, transfers and owner funding to their origin. Do not create a balancing journal to make a discrepancy disappear. Keep different bank/card settlement dates with their respective sources.
- [ ] Produce validated structured inputs in staging, with stable source IDs and retrievable document references. Import into isolated test state, repeat the same input, and require unchanged reintake with no errors.

PDFs are retained evidence; the worker consumes structured JSON. “Import to the Mac” means delivering those inputs to the hosted worker and accepting them into its history. It does not mean moving the official books out of Zoho. A file in Muse's cloud workspace is not automatically on the Mac or in the agreed Drive folder.

**Exit evidence:** source inventory with exact coverage, validated input IDs/hashes, existing-entry links, and a concrete list of expected new entries, holds and unresolved historical differences. Do not confuse completed collection with reconciled accounting.

### Stage 4. Adapt the existing code and prepare the runtime

**Lead: Codex.** Record the tested repository commit, Node version and private configuration fingerprint. Run the standalone build and tests before deployment.

| File | Review before reuse |
|---|---|
| `src/index.ts` | Requires an explicit entity slug; obtains bank IDs from config; isolates default local data by slug and binds state to organization/name/accounts. Set external production state/handoff paths. |
| `src/config.ts` | Validates a named USD organization, distinct bank IDs/accounts, one or more units, allocation, action set and rental checklist. |
| `config/example-property.json` | Fictional example blocked from provider access. Copy privately, replace every identity and rule, and explicitly set `company.example=false` only after verification. |
| `scripts/prepare-mac.mjs` | Uses the selected slug for runtime path, command and job label. Runs at 06:00 host-local time and at load; enabling is a separate production action. |
| `src/zoho.ts` | US data center and USD checks. Reporting API currently requests accrual; use the CPA export guide for a cash-basis package. |

For another simple rental, retain internal account-role keys initially if that avoids unnecessary changes, but map them to the correct new accounts and IDs. Do not introduce a generic plugin system or shared multi-entity database. Distinct entities need separate config, state, handoff directory, Drive folder, scheduler label and verified authorization. A new property inside the same legal entity and Zoho organization requires an explicit account/unit routing decision before allowing two workers to read overlapping feeds.

**Prepare and verify:**

- [ ] Confirm Node 24+ and the repository's locked dependencies are available, then run the worker build, tests and typecheck. Obtain the applicable setup approval for missing software; do not add a provider SDK or database service merely to clone the deployment.
- [ ] Inventory existing loaded jobs, installed plists and other schedulers before enabling anything. Preserve old state and SQLite sidecars during migration with workers stopped; never reset history as a troubleshooting step.
- [ ] Put the runtime outside the checkout and Drive. Keep secrets private, with restrictive file permissions and backup-key recovery in the owner's password manager.
- [ ] Configure Drive desktop, verify the correct account/folder ID and actual local path, and make the folder available offline.
- [ ] Verify Zoho OAuth refresh and real reads for the exact organization/accounts. A “Generate Code” value is a short-lived authorization code, not a refresh token; exchange it using the matching client and store the returned refresh token privately.
- [ ] Verify one real bounded model response, retained cost accounting after a timeout, accepted context, cloud receipts and offline restore. Reuse valid prior evidence rather than buying repeated test calls.

The example property grant check observed `ZohoBooks.banking.READ`, `ZohoBooks.accountants.READ`, `ZohoBooks.reports.READ`, `ZohoBooks.settings.READ`, plus `banking.CREATE` and `accountants.CREATE` for posting. Read success and grant presence do not prove writes. Metadata UPDATE was intentionally omitted while repairs remained deferred. Confirm scopes against the selected operations and current provider contract.

**Exit evidence:** reproducible tested revision; isolated entity paths and identity; working provider reads; accepted handoff and recoverable downloaded backup. Keep posting and scheduling off until the concrete launch is approved.

### Stage 5. Prove the books and rerun behavior

**Lead: Codex. Owner approves the concrete first production action once.** Present the intended entries or eligible rules, scope of backlog, exact holds, feature flags and run/rerun plan. Authorization to automate approved rules does not require approval of every future batch.

The existing `run`, `categorize` and `close` commands can post. They are not dry runs; `BOOKKEEPER_LIVE=0` rejects them. Use `doctor` for connection checks and isolated state with mocked adapters for write rehearsals. `run` handles the backlog as well as the prior month's checks, so do not describe it as limited to one month unless the implementation actually restricts that scope.

- [ ] Record before-state: source fingerprints, existing remote journal/transfer IDs, account balances, unresolved holds and database identity.
- [ ] Run the approved flow and reread actual remote entry bodies, publication status and source matches. If a create succeeds but matching fails, retry matching the saved entry; do not recreate the journal.
- [ ] Check completeness, classification, dates, allocations, unit attribution where required, transfers, rent, mortgage, escrow and owner accounts. Compare P&L and balance sheet to the sources. Equal balances alone do not prove correct classification.
- [ ] Rerun with the same database, code, config and accepted inputs. Require zero additional journals/transfers and unchanged correct entries/balances. Do not erase state to make this test pass.
- [ ] Download the fresh post-run encrypted backup from Drive, verify its checksum, restore to a new offline database and inspect the latest history.

Keep **operational launch** and **verified month** separate. The owner may elect to start safe routine work with historical discrepancies held. That is not authority to clear the discrepancies or call the month complete. Missing evidence and monetary errors remain visible; known unpaid late rent can remain tracked without blocking an otherwise complete month. Cosmetic cleanup should not repeatedly expand launch scope.

**Exit evidence:** actual entry IDs and readback, live rerun comparison, current backup/restore evidence, and a month report whose unresolved items are stated honestly. A no-op run proves execution, not an unexercised posting path. The worker's “close” is a checklist result; it does not lock the accounting period in Zoho or complete annual depreciation/tax work.

### Stage 6. Enable one schedule and observe it

**Lead: Codex enables. Muse monitors independently.** Use one approved launch plan covering the immediate run, controlled rerun and periodic operation. If the plan uses `prepare-mac.mjs --enable`, remember that `RunAtLoad` starts a run immediately; coordinate the first-run checks around that behavior.

- [ ] Exactly one job serves this entity. Check both loaded jobs and installed plists so an old job cannot return at login.
- [ ] Verify the configured hour against the Mac's actual timezone. example property's 06:00 Pacific schedule is 09:00 Eastern on the reviewed date; its accounting timezone is separately configured.
- [ ] Observe an actual scheduled run without manually triggering it. Check `lastRun`, errors, imported inputs, source audits, month report and the fresh cloud backup.
- [ ] Have Muse read real results and return actual delivery receipts for delivered notifications. A worker-generated notification payload is not delivery.
- [ ] Observe the next actual login reload when it occurs; a prepared plist alone does not prove it. Do not force a logout/reboot just to obtain evidence.
- [ ] Confirm an external stale-run check, because an offline Mac cannot report its own failure. The existing handoff contract uses more than 36 hours since the last completed run as a warning.

**Steady-state acceptance:** a verified pilot month; duplicate-free rerun; actual scheduled operation; usable exception delivery; current cloud backup and tested recovery. If only routine operation is live, label the unreconciled month separately rather than declaring the full acceptance complete.

## 3. Normal operating schedule

The daily worker supports a monthly business goal: finish the previous calendar month by the following 7th. Daily balance differences are not themselves a reason to redesign the system.

| When | Action and owner |
|---|---|
| Each scheduled run | Worker imports accepted inputs, rechecks proposals and sources, applies approved rules, matches entries, audits sources and checks the prior completed month. Older months can be revisited when evidence changes. It then requests bounded AI reviews and exports status/backup. |
| When unfamiliar work appears | Muse presents the proposed treatment and reason. Eligible routine proposals can execute provisionally after 72 hours from creation, on the next successful run, even if notification was delayed. They stay on the unresolved-assumptions ledger. |
| Early in the next month | Muse attempts source collection automatically. Ask the owner only for actual authentication or action-permission blockers. Complete calendar coverage even when statement cycles differ. |
| 5th, then 7th | Agreed operating policy: remind about missing documents on the 5th; urgent reminder on the 7th; daily overdue reminders until verified receipt. These require a separately verified Muse schedule; they are not built into the daily worker merely because this policy is written down. |
| Monthly result | Muse reports complete versus incomplete, remaining balances/evidence issues, unpaid rent, and the count/oldest date of provisional or correction-needed assumptions. |
| Failure or no recent run | Muse reports the actual blocker and smallest next action. Keep unchanged nonactionable status quiet. |

Two clocks are distinct: provisional classification uses 72 hours from proposal creation; notification escalation begins only after confirmed delivery. The reviewed notifier advances to email after 24 hours without acknowledgment and repeats the final channel after seven days. That generic exception policy is separate from the agreed document-reminder schedule.

The one-time October 7 launch observation arranged during example property setup is not evidence that permanent monthly collection/reminders are running.

## 4. Runtime and handoff reference

### Environment and commands

The existing runtime uses these keys. New entity paths and names below are design requirements, not currently supported command-line options.

```dotenv
ZOHO_CLIENT_ID=ENTER_PRIVATELY
ZOHO_CLIENT_SECRET=ENTER_PRIVATELY
ZOHO_REFRESH_TOKEN=ENTER_PRIVATELY
BOOKKEEPER_LIVE=0
BOOKKEEPER_AI_REVIEW=0
DEEPSEEK_API_KEY=ENTER_PRIVATELY
BOOKKEEPER_METADATA_REPAIR=0
BOOKKEEPER_STATE_PATH="ABSOLUTE_PRIVATE_ENTITY_PATH/state.db"
BOOKKEEPER_HANDOFF_PATH="ABSOLUTE_PRIVATE_ENTITY_PATH/handoff"
BOOKKEEPER_SHARED_PATH="VERIFIED_PRIVATE_DRIVE_FOLDER_PATH"
BOOKKEEPER_BACKUP_KEY=64_HEX_CHARACTERS_FROM_32_RANDOM_BYTES
```

Do not paste real values into chat, reviews, logs, status files or this guide. Shared `current.json` is readable financial context; AES-256-GCM encryption protects the separate backup, not the whole Drive folder. Keep the recovery key independently and preserve keys needed for older backups.

These commands describe the **existing example property deployment only**. Future agents must adapt and verify the launcher and configuration loader before substituting another entity. Run from the correct repository checkout:

```sh
npm test
npm run typecheck
npm run build
node scripts/prepare-mac.mjs

node --env-file="$HOME/Library/Application Support/AIBookkeeper/example-property/bookkeeper.env" \
  dist/index.js doctor --config example-property

node --env-file="$HOME/Library/Application Support/AIBookkeeper/example-property/bookkeeper.env" \
  dist/index.js handoff --config example-property

node --env-file="$HOME/Library/Application Support/AIBookkeeper/example-property/bookkeeper.env" \
  dist/index.js audit --config example-property
```

`doctor` reads Zoho and does not post. `handoff` imports decisions/evidence into local state and publishes shared files, without posting to Zoho. `audit` reads Zoho and writes local audit results/flags; it requires accepted source ledgers. “No accounting writes” does not mean “no local changes.” Preparation without `--enable` starts nothing.

The backup check also creates a new local file, never activates it:

```sh
node --env-file="$HOME/Library/Application Support/AIBookkeeper/example-property/bookkeeper.env" \
  dist/index.js restore-backup --config example-property \
  --source "ACTUAL_DOWNLOADED_BACKUP.json.enc" \
  --destination "NEW_PRIVATE_OFFLINE_PATH.db"
```

Require `verified-offline-copy` and inspect the restored latest history. The source must actually exist; a backup filename in `pending.json` does not mean it has been downloaded into Downloads.

### Input contract

Use the deployed validators and the repository's `MUSE_HANDOFF.md` and `AUTONOMOUS_HANDOFF.md` as the schema authority. Every message is an immutable UTF-8 JSON file of at most 1 MB with `version: 1`, exact `organizationId`, a unique `id`, and `kind`. Repeating identical input must be harmless; corrections need new IDs and the relevant version/fingerprint checks. Reject wrong-entity inputs.

| Kind | Purpose and required distinction |
|---|---|
| `owner-context` | Owner's actual words/source/effective date, `expectedRevision`, optional superseded fact. Do not invent confirmation or silently overwrite another conversation. |
| `source-ledger` | Complete bank/card rows, source IDs, exact cutoff, opening/closing balances. `complete: true` needs evidence. Balance/movement verification is separate from classification coverage. |
| `monthly-evidence` | Month-end balances, rent attribution, actual paid mortgage components and explicitly reviewed steps. Unknown is omitted; zero means verified zero. |
| `venmo-rent-receipt`, `escrow-disbursement` | Verified source transactions absent from ordinary bank feeds. Stable source ID; verified `existingJournalId` for already recorded historical work. |
| `decision`, `flag-review` | Exact transaction answer, separate threshold/duplicate approval, or permitted acknowledgment. Acknowledged does not mean corrected. |
| `review-evidence`, `proposal-answer` | Evidence and owner response tied to the current transaction/proposal fingerprint. A later correction repairs the existing posting; it must not create another. |
| `delivery-receipt` | Actual Muse/provider message ID for the worker's `deliveryId`; never acknowledge a failed send. |
| `shared-receipt` | Downloaded-byte SHA-256 or actually returned Drive server SHA-256, matching the exported file. `receipt` is a text string, not an object. |
| `audit-change-confirmation` | Owner acknowledgment of a specific historical audit snapshot; cannot erase a cash discrepancy. |

For bank source ledgers, inflows are positive and closing = opening + signed movements. Card purchases are negative movements; a positive card balance is money owed, so closing = opening - signed movements. Preserve equal-valued separate rows. Match transfers by evidence, not amount alone.

The current close implementation requires an exact full-calendar source packet for each configured bank/card. Valid partial-period packets do not automatically combine into this requirement: construct a complete month packet from retained evidence, preserving source identities and avoiding conflicting versions. This is a transformation step, not a request to recollect existing documents.

Only the worker writes accepted state and `current.json`. Muse adds inbox files and reads outputs. Agents may update `STATUS.md`, retaining others' current evidence. A cloud path or file listing proves neither synchronization nor worker intake: verify the file hash, then the accepted/unchanged result. The snapshot's embedded `storage.snapshotHash` refers to a preceding publication; hash the downloaded current bytes or use a returned server checksum and compare with the corresponding local pending export.

## 5. Controls and acceptance tests to preserve

| Area | Required result |
|---|---|
| Entity isolation | Correct org/account/unit mapping; another entity's packet or ID is rejected; independent state and schedule; no overlapping feed ownership. |
| Owner context | Actual answers, sources and effective dates are accepted in shared state. Representative transactions produce the agreed treatment or an explicit hold; unsupported cases are not silently treated as rent/owner funding. Changed context invalidates stale proposals. |
| Provider adapter | Actual bank/card debit-credit direction, complete pagination, exact effective report date/basis, source rereads and account filtering. Do not accept a response merely because it echoes the requested dates. |
| Posting | Balanced published journal and exact feed match; readback agrees with source; durable claim before write and saved remote ID after success. |
| Legacy migration | Approved history range preserved, source-to-Zoho mapping retained, opening amounts counted once, reports reconciled, no ledger/feed/receipt duplicates and no unaccounted import errors. |
| Uncertain outcomes | Never blindly retry POST/PUT after a timeout. Hold and inspect Zoho; retry only verified missing work or matching against the saved entry. Read retries are bounded. |
| Existing work | Preserve manual/reconciled entries; require verified journal/source links. A missing feed row or similar amount is not proof of prior posting. |
| Transfers and income | One transfer covers the matched payment sides; receipts and later cashouts do not both become rent; owner/intercompany funding is identified. |
| Allocation | Shared, wholly personal, unit-specific, purchases and refunds behave correctly. Rent and full personal expenses do not inherit the shared-cost percentage. |
| Thresholds and learning | Amounts over the configured threshold need review unless an explicit expected recurring amount matches exactly. Approval is bound to the source fingerprint. Actual owner answers may teach a narrow rule; generic cash/Venmo descriptions stay transaction-specific. |
| AI and assumptions | Test 71:59 versus 72:00 hours, early reply, stale evidence, changed source, duplicate/receipt/capital holds, malformed answers, absent cited evidence, timeout and exhausted budget. Silence never teaches a permanent rule. |
| Monthly accuracy | Complete sources and cutoff balances, correct classifications and reports, actual mortgage/escrow evidence, known unpaid rent distinct from missing evidence. A successful worker run alone never means the month closed. |
| Resilience | One process lock; rejected input is visible; unrelated known-rule work continues during AI/Drive problems; real notification delivery is acknowledged once. |
| Recovery | Fresh recoverable backup after each finished run, including later same-day and failed runs; cloud hash and restore of latest history; tampered/wrong-key backups rejected. |

example property's AI ceiling is $5 per property-local calendar month for this worker, using conservative reservations before calls. Lost responses keep reservations. This does not cap another app's use of the same API key, all entities combined, or provider price changes. Decide an aggregate budget before replicating many independent workers.

Limited automatic repair covers source-supported dates/unit tags only, with a saved preimage and independent readback. It does not authorize deletions, reclassification, amount changes or balancing plugs. The latest example property launch plan keeps it off. Treat actual repair capability and UPDATE permissions as optional scope, not an automatic launch dependency.

## 6. Recovery and coordination

**Uncertain posting:** stop overlapping workers, inspect the remote account/journal and stable reference, then use the existing `recover-posting` path with an actual remote ID or verified non-posting. It requires `--confirm-workers-stopped`, a reviewer and note. Do not mark uncertainty resolved by acknowledgment or deleting database rows.

**Machine or database loss:** stop all schedules; preserve remaining state; download and verify an encrypted backup; restore to a fresh private path. Reconcile remote postings and AI spending since that backup before activating it. Otherwise a stale database can forget both recorded entries and budget reservations. Update the private state path only under the approved recovery plan, then run the duplicate checks again.

**Shared status:** maintain one `STATUS.md` per deployment. Each item needs state, evidence/date, next action and responsible party. Useful states are `prepared`, `verified`, `pending`, `blocked` and `deferred`; retain completed work until contrary evidence exists. Keep accounting completion separate from operating health. Merge current file contents rather than replacing them with an older agent's copy.

**Agent coordination:** one lead agent owns the checklist, acceptance evidence and consolidated report. Muse owns collection/conversation/delivery; the Mac agent owns local administration; neither should invent the other's results. Remote access, shared Drive and chat messages are distinct channels. Prove the actual command host with a harmless check before relying on remote execution. Use direct access where verified; avoid making the owner relay terminal commands through Telegram.

## 7. Lessons that shorten the next deployment

| Detour from example property | Better next time |
|---|---|
| Repeatedly asking whether setup, credentials or backups were done | Read the shared evidence first; report only what remains. |
| Inferring business meaning from bank descriptions or leaving explanations in chat | Interview the owner about actual money flows, retain versioned answers, and verify the resulting rule on a real example. Ask again only when facts or policy change. |
| Calling staged documents “imported,” tests “live,” or a grant “working writes” | Name the exact stage and attach its receipt. Test, provider read, live posting, verified month and scheduled run are different outcomes. |
| Investigating a large balance difference before establishing account identity and opening coverage | Map accounts and collect a full source period first; trace differences without guessing rent or adding a plug. |
| Comparing bank “today” against yesterday's books or a midmonth card statement | Use the same cutoff and accounting scope. Keep monthly completion as the business target. |
| Trusting mocked API shapes or another agent's statement that code is stubbed | Read the actual deployed revision and validate real responses. The implemented transfer uses `/banktransactions`; report/register endpoints and effective filters required live verification. |
| Passing prose/PDFs between agents without an accepted input | Retain originals, make validated immutable packets, prove cloud delivery and worker acceptance. |
| Starting automation before clarifying which Wave history already exists in Zoho | Complete the migration inventory, opening-balance treatment and feed overlap checks first. The worker is not a substitute for a migration. |
| Rebuilding infrastructure while deployment checks remained unfinished | Use the existing Zoho, Mac, SQLite and Drive stack. Defer custom Plaid, dashboards, hosted coordinators and cosmetic cleanup unless a demonstrated blocker requires them. |
| Treating a successful first run or an early backup as enough | Rerun the same state, verify no additional entries, and restore the fresh post-run backup. |

## 8. Extending beyond one rental

A second similar rental is the next useful scope. Reuse the code, adapt only demonstrated differences, and repeat the same acceptance checks. Do not clone another entity's learned rules, source IDs or accepted history.

Funds need an explicit accounting model before implementation: investor capital and allocations, contributions versus distributions, fees/promote, investment income, realized/unrealized activity where applicable, intercompany loans, accruals and year-end reporting. Obtain the owner's/accountant's treatment and supporting records for those events. The existing worker's rental actions and close checklist do not implement a fund subledger, waterfall or tax reporting.

Reconsider hosting or a shared workflow database only when a concrete requirement appears, such as concurrent operators, server availability without a logged-in Mac, or materially different volume. That is a new design decision; expanding the number of properties alone does not require replacing Zoho or building a custom general ledger.

## 9. References and next agent kickoff

Use this repository's [README](../README.md), [Muse contract](MUSE_HANDOFF.md), [shared context contract](AUTONOMOUS_HANDOFF.md), and [CPA handoff](CPA_TAX_HANDOFF.md). Implementation and tests live in `src/` and `test/`; use the tested commit rather than a previous deployment's test count.

> Use this AI Bookkeeper Playbook for [entity]. Read existing private context, records and STATUS.md first. Start with the next unanswered consequential interview question. Inventory existing Zoho/Wave history and collected evidence before repeating work. Lead the authorized implementation through the six stages. Keep one current checklist with evidence and unresolved questions; continue routine work without waiting for "keep going." Ask only for unresolved business/design decisions, necessary access or concrete production approvals. Preserve the books. Prove a month, an unchanged rerun, scheduled execution, actual delivery and fresh backup recovery before declaring steady state. Include the CPA handoff and the owner's exact already-applied allocation in annual reporting.
