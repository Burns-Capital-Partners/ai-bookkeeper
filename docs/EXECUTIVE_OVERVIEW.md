# AI bookkeeper

A repeatable setup for the next property

**Purpose:** keep reliable books in Zoho, automate approved work and bring the owner only exceptions. Target: the prior month ready by the following 7th.

## Tools and responsibilities

- **Zoho Books:** official entries, reports and bank/card feeds. Statements, leases and receipts supply independent evidence.
- **Mac mini + Node worker + SQLite:** periodic processing and durable posting/review history. Codex builds and verifies; it need not stay open for the enabled worker.
- **Private Google Drive:** shared context, evidence and current status, plus encrypted recovery backups. Credentials and the live database stay on the Mac.
- **Muse or another collector:** downloads and verifies records, asks batched questions and delivers alerts. Humans help at actual sign-in or permission blockers.
- **Optional DeepSeek reviewer:** proposes routine classifications within a $5 monthly budget per deployment. Owner decisions and posting controls remain separate.

## Build and verify in this order

- **1. Interview and establish private records.** Read existing answers; confirm accounts, rent/deposits, property use, history, reporting basis and authority. Property-level books are the default.
- **2. Verify source records.** Inventory existing files; collect bank, card, mortgage/escrow, PM, receipts and relevant tax schedules. Prove opening balances and complete pilot-month coverage.
- **3. Set up Zoho and migrate once.** Map legacy Wave accounts; bring across only missing approved history or supported openings. Preserve filed-year records and check historical and current balances.
- **4. Prepare the worker.** Verify fit, isolated settings, actual-host access, structured inputs, cloud delivery and backup restoration. Test required adaptations.
- **5. Prove the books.** Inspect one completed month's entries, purposes and balances. Rerun unchanged inputs and prove no new entries; independently review the result.
- **6. Enable and observe.** Activate one approved schedule. Verify an unattended run, fresh cloud backup and actually delivered exception before calling it operational.

## How a normal month and year work

- **Daily:** process approved rules and retain exceptions. Exact daily displayed balance agreement is not the business goal.
- **Days 1-3 of the next month:** collect remaining statements and receipts; batch the actual human access/questions needed.
- **Days 4-7:** reconcile the prior month and publish a concise close with remaining issues. Compare identical cutoffs; distinguish profit, operating cash and tenant funds.
- **Questions:** eligible routine proposals may apply provisionally after 72 hours, but remain revisitable. Silence never teaches a permanent rule; integrity, duplicate, capital and historical-repair holds remain.
- **Year-end:** owner/authorized agent posts approved annual adjustments once; verify current-year expense and next-year continuity. Deliver CPA-agreed reports and a one-page brief explaining allocations already applied.

## Lessons that make the next build shorter

- One private living record per entity holds the current position, standing rules, open issues and next action. Each session updates it and promotes useful lessons into the shared process or tested code.
- Source checks precede migration. Verified amounts, correct purposes and duplicate-free reruns matter more than a green test or a successful API response.
- Reuse the rental code without adding infrastructure. Cash/accrual P&L and manual extra-ledger checks are implemented; extra feeds and annual posting still need explicit procedures/adaptations. Funds need additional accounting design.

October 8, 2026 | Combined lessons from two builds. This is the operating plan; each entity must prove its own live acceptance. Annual posting and collection remain agent/operator procedures.
