# AI bookkeeper

A repeatable setup for the next property

**Purpose:** keep the official books in Zoho, automate approved work and bring the owner only exceptions. Reuse the starter with each entity's confirmed accounting rules.

## Tools and responsibilities

- **Zoho Books:** the official accounts, entries and reports; use its existing bank feeds first.
- **Mac mini + Node worker + SQLite:** scheduled bookkeeping, with a local history of rules, decisions and postings. Codex builds and maintains it; Codex does not need to stay open.
- **Google Drive for desktop:** shared records, context and status, plus encrypted recovery backups. Credentials and the live database stay private on the Mac.
- **Muse:** collects statements, asks questions and delivers alerts. Saves owner answers as shared, versioned context and asks focused follow-ups when circumstances change.
- **DeepSeek:** proposes answers for unfamiliar routine transactions. The pilot allows $5/month for these AI calls; other service costs are separate.

## Build and verify in this order

- **1. Interview the owner.** Read known facts first; clarify money flows, unusual payments, history and automation limits. Save the agreed rules and choose one month to test.
- **2. Set up Zoho and migrate Wave.** Preserve exports and receipts, map accounts, import missing history and verify opening balances without duplicating existing entries.
- **3. Connect the sources.** Set up bank/card feeds and statement collection. Obtain mortgage, escrow, rent and receipt evidence for a complete calendar month.
- **4. Adapt the worker.** Apply entity-specific settings and code; verify credentials, shared inputs and backup recovery.
- **5. Prove the books.** Run approved work, compare entries and reports with sources, then rerun unchanged inputs and confirm no additional entries.
- **6. Enable one schedule.** Observe an unattended run, fresh cloud backup and delivered exception before declaring the system operational.

## How a normal month should work

- **Daily:** record approved transactions, check the previous month and publish exceptions. Exact daily balance agreement is not the business goal.
- **Early next month:** Muse attempts statement collection. Get human help only when authentication or permissions actually block it. Target: prior month ready by the 7th.
- **Questions:** eligible routine proposals may be applied provisionally after 72 hours without a reply. Assumptions remain visible; large, duplicate or unsupported items stay held.
- **Year-end:** export CPA-agreed cash/accrual reports and a one-page context brief. Explain allocations already applied; reconcile the CPA's adjustments once.

## Lessons to carry forward

- One lead agent, shared owner context and one current checklist prevent repeated questions and conflicting status reports.
- Bank feeds supply transactions; statements and receipts supply evidence. Check classification as well as balances, and never record imported history twice.
- Keep the existing tools and essential checks. Expand to another rental first; funds need additional accounting rules before reusing the process.

Starter - October 6, 2026: standalone tests passed. Live posting, a verified month, duplicate-free rerun and unattended operation remain unproven for each new deployment.

[Printable one-page PDF](ai-bookkeeper-executive-overview.pdf) | [CPA handoff](CPA_TAX_HANDOFF.md)
