# CPA and tax handoff

Turn the year's bookkeeping into a small, traceable package for the accountant. Agree who prepares schedules, posts and reviews: the owner/authorized agent can post approved annual entries; the CPA reviews tax treatment and the final package. Do not assume the CPA edits Zoho. A successful monthly worker run is not a completed tax return. Follow [YEAR_END_CLOSE](YEAR_END_CLOSE.md) first.

## 1. Add these questions to the initial owner interview

Read prior answers and relevant redacted schedules from the last filed return first. Batch unresolved factual questions by topic; ask consequential policy decisions separately. Skip irrelevant branches.

- Who prepares the return, which entity/tax classification and fiscal year apply, and when does that CPA want the package? Confirm the delivery channel and authorization separately from drafting.
- Which accounting method did the prior return use, and does the CPA want cash, accrual or both report sets? A report's basis label does not establish the adopted tax method. Do not change organization settings or tax elections to make reports match.
- Is any property used personally? Distinguish separate owner-occupied space from personal days in a unit that is also rented. Record the agreed allocation method, exact percentage, effective dates and supporting calculation. Which costs are direct rental, direct personal or shared? **Has the split already been applied to the books?**
- Who maintains the depreciation and loan-cost amortization schedules? Obtain prior-year schedules, acquisition/closing records, placed-in-service dates, improvements/disposals and cost-segregation reports if applicable. Confirm whether asset and loan balances represent the whole property or the rental share.
- Were there refinances, ownership/use changes, major repairs/improvements, unusual receipts, security deposits, advance rent, owner-paid expenses or intercompany transfers? Which treatment is unresolved? Confirm relevant information-return responsibilities with the CPA.
- What Wave or other legacy history was migrated, what was retained only as an archive, and which opening balances or prior-year adjustments are still unresolved?

Maintain the concise private [owner/CPA context sheet](templates/CONTEXT.md) whenever answers or facts change, with source and effective date. Use it as the starting point for the dated annual CPA brief; link detailed schedules and keep the current work summary separate. Save confirmed answers in that shared context. Do not treat a chat recollection or proposed classification as verified history.

## 2. Close the year, then export one consistent package

1. Reuse completed monthly checks. Obtain year-end bank/card activity through the actual cutoff and mortgage/escrow balances. A statement ending before December 31 needs the intervening activity too.
2. Reconcile balances and review classifications, transfers, owner transactions and unconfirmed assumptions. Identify missing evidence explicitly. Never create a balancing entry merely to remove a discrepancy.
3. Confirm the CPA's reporting basis and export the reports below. For a calendar year, the annual period is January 1 through December 31; use the actual fiscal dates otherwise.
4. Draft the one-page brief from those exact exports and the confirmed context. List unresolved items with evidence, amount, proposed treatment if supported, and responsible person. Do not invent explanations.
5. Obtain authorization to deliver to the named CPA. Retain the sent version and actual delivery receipt in the private entity folder.
6. Obtain the approved annual/CPA adjustment schedule. The designated owner/agent reviews exact entries, account/basis/date, prior postings and authority, then posts once. Re-export affected reports and reconcile current-year expense and cumulative balances to that schedule. Retain the CPA's final acknowledgment and approved tax schedules. A tax-return-only adjustment needs an explicit book-to-tax bridge; do not call it posted in Zoho.

| Report or supporting record | Period / content | Purpose |
|---|---|---|
| Profit and Loss, PDF plus spreadsheet | Full tax year; monthly columns if useful; confirmed basis | Income and expenses; tie to current-year earnings |
| Balance Sheet, PDF plus spreadsheet | Fiscal year-end and prior year-end; same selected basis | Closing assets, liabilities, equity and opening comparison |
| Trial Balance and General Ledger | Year-end trial balance; full-year ledger with opening, debits, credits, closing balances and references | Trace report totals and adjustments; record the actual basis available for these exports |
| Chart of accounts and manual journal detail | Current mapping, published/draft status, year-end entries and report-basis visibility | Explain legacy mappings and adjustments hidden by report filters |
| Bank/card reconciliations and statements | Year-end cutoff, all included accounts, any reconciling items | Prove actual balances; explain credits, outstanding transactions and opening differences |
| Mortgage, escrow and tax documents | Year-end statement, paid principal/interest/escrow detail, disbursements, Form 1098 where applicable | Separate debt, escrow and expenses; explain full-property versus rental-share scope |
| Fixed-asset/depreciation/amortization schedules | Prior-year closing and current-year movement; additions/disposals and original support | Reconcile cumulative balances to this year's expense and CPA adjustments |
| Allocation and owner-account schedules | Gross cost, direct/shared designation, rental amount already booked, personal amount, method/effective date | Prevent allocating expenses twice; explain contributions, draws and reimbursements |
| Exception list and legacy migration bridge | Unconfirmed assumptions, missing evidence, opening balances, prior-year corrections | Make the limits of the package visible |
| Conditional supporting records | Receipts/capital invoices, leases, deposits/advance rent, payment-processor tax forms, receivable/payable aging where relevant | Support treatment without counting the same money twice |

The bank/card account's signed balance is not automatically a rewards balance. Reconcile it to the statement and ledger before labeling it cash back. Accumulated depreciation is cumulative; it does not by itself prove the current year's expense. These are verification prompts, not automatic error findings.

For any opening or historical correction, search all dates for earlier and later corrective journals, and verify the prior close, next opening, reporting-year end and current balances. Do not add a second opening entry for normal year-to-year carryforward. Preserve filed asset continuity and resolve conflicts between prior schedules before posting.

## 3. Pull the reports in Zoho

Select the verified organization. Open **Reports**, then the required report (Profit and Loss / Balance Sheet are under Business Overview). Use its customization controls to select the exact dates, **Report Basis: Cash or Accrual**, and intended entity/property filters. Run it and inspect the header before export. Preserve a PDF for review and a spreadsheet for tracing amounts. Repeat for the remaining reports using the report search/menu available in that organization. [Zoho report settings](https://www.zoho.com/us/books/help/reports/business-overview.html), [report export and management](https://www.zoho.com/us/books/help/reports/manage-reports.html).

If a ledger or trial-balance export does not offer the same basis selector, label its actual basis and provide the reconciliation to the financial reports; do not relabel it. Check manual journals' cash/accrual visibility. If the CPA requests both methods, provide two clearly labeled report sets with their differences explained. The worker's current report API requests accrual; it is **not a replacement for a cash-basis CPA export**.

Save a manifest with organization, period, basis, filters, export timestamp, report filenames, preparer and known exclusions. Example filename: `2025_example-rental_profit-loss_cash_2026-02-01_v1.pdf`. Keep statements, actual reports and CPA correspondence in private storage, outside this reusable repository.

## 4. Generate the CPA one-pager

Use [CPA_BRIEF_TEMPLATE.md](CPA_BRIEF_TEMPLATE.md). Read the exports and context before writing; leave unknowns explicit. Put the one or two facts most likely to change preparation first, especially **allocations already applied**. Then provide a short report summary and a maximum of five material questions/adjustments. Keep supporting detail in linked schedules. Classify each assertion as report-derived, owner-confirmed, CPA-confirmed or unverified where the distinction matters.

Suggested instruction to the agent:

> Prepare the CPA package for [entity] and [tax year] using this guide. Read existing context and prior CPA instructions first. Confirm the reporting basis and whether personal-use allocations are already applied. Reuse completed checks and export the specified reports. Draft a one-page factual brief, link its sources and flag unresolved items without guessing or correcting live books. Reconcile current-year depreciation to the CPA schedule, not just the accumulated balance. Stop before sending, changing accounting policy, or posting year-end adjustments unless that specific action is already authorized. Record delivery and the final adjustment reconciliation when completed.

The annual deduction and cumulative depreciation serve different purposes. Mixed-use rental costs require appropriate allocation; the CPA should confirm the applicable treatment and any limits. This guide does not select tax elections or calculate a return. [IRS Schedule E instructions](https://www.irs.gov/instructions/i1040se), [IRS Publication 527](https://www.irs.gov/publications/p527).

## Completion checks

- [ ] Entity, year, basis, cutoff and report filters are explicit and consistent or reconciled.
- [ ] Source balances and classifications are checked; exceptions remain visible rather than assumed away.
- [ ] Already-applied allocations and asset/loan scope are explained without a second percentage reduction.
- [ ] Current-year depreciation/amortization is reconciled to the CPA schedules or explicitly pending.
- [ ] One-pager amounts match the delivered reports; no confidential material enters the starter repository.
- [ ] Authorized delivery is evidenced; CPA adjustments are applied once and final exports retained.
