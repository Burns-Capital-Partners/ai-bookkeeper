# What changed after two builds

This is a generalized review of the original rental build and the follow-on build, including their mistakes. Private transactions, statements, credentials and tenant details are deliberately excluded. The process incorporates the reusable guide's version 1.11 improvements and the later accounting-review lessons. These are concrete procedures, not a claim that every procedure is a worker feature.

| Lesson | Change in the reusable process |
|---|---|
| The owner kept having to say "keep going." | One lead advances authorized work, reports the next milestone and stops only at a real dependency/authority boundary. |
| Too many one-off purpose questions and repeated logins slowed the work. | Prefill prior answers; batch questions and account-scoped collection during a usable session. |
| Promising later work without a persistent executor created false expectations. | Distinguish active turn, configured scheduler and observed background run; save resumable checkpoints. |
| Different agents repeated setup and disagreed on progress. | One current private status, evidence references, stable review IDs and defined ownership; preserve closed items. |
| A copied old status could erase newer work. | Refresh/merge the current shared file before updates; snapshots remain worker-generated evidence. |
| Parallel work can help, but concurrent ledger writers are unsafe. | Use bounded authorized helper tasks with one lead and one writer; independently verify joined results. |
| Downloads and staged JSON were called completed books. | Separate collected, normalized, accepted, posted, reconciled, tax-final and unattended states. |
| The working folder was established too late. | Establish/reuse private originals, manifest, proposals and verification areas at kickoff. |
| Rough rent/context clues helped but were sometimes treated as facts. | Verify expectations; persist uncertainty, effective dates and revised answers. |
| A rent/payment feed missed lease, fee and deposit context. | Include PM leases, gross-to-net settlements, tenant transitions and deposit schedules. |
| Unrecorded personal use, short-term rentals and account aliases changed treatment. | Interview for off-record events and keep a dated property-use/account timeline. |
| Unit-level accounting was copied from a mixed-use exception. | Default to property-level; retain detail only where it changes treatment/reporting. |
| Historical books were categorized but not independently reconciled. | Preflight bank/card/lender evidence before trusting legacy or importing balances. |
| Full archived history was confused with the live cutover scope. | Preserve filed-year records; import only missing approved detail/openings with nonoverlapping coverage. |
| Empty local state was mistaken for an instruction to replay history. | Inspect/match existing Zoho entries; SQLite is workflow memory, not authoritative ledger history. |
| A historical opening fix duplicated an existing later corrective journal. | Search all dates and verify legacy closing, new opening, target month and current balances/counterparts before and after corrections. |
| A year-end balance was about to be journaled again as next year's opening. | Verify normal carryforward; one economic adjustment, not two copies. |
| A negative card liability was assumed to be cash back. | Build the complete debt bridge from purchases, payments, credits and openings before naming a cause. |
| Extra equal rent receipts were assumed to be duplicates or deposits. | Trace payer, lease period and custody; equal amounts alone establish neither duplication nor purpose. |
| Security-bank cash was confused with tenant liabilities or available cash. | Reconcile custody and per-tenant obligations separately, including refunds/carryovers, pooled funds and interest. |
| A personal payment route obscured a property expense/refund. | Record the economic event once and separately trace owner funding; do not infer purpose from the paying account. |
| Cross-entity charges could strand balances or duplicate expenses. | Use a source-linked reimbursement/intercompany handoff and reconcile both books under the approved policy. |
| A browser click, filename or year view did not ensure complete documents. | Verify original bytes, actual account/period/content and calendar cutoff; detect partial or fake exports. |
| Saved credentials and a cloud-shell check were called Mac connectivity. | Test the actual executor, correct organization and separate read/write grants; record access/MFA recovery. |
| One-time OAuth codes were confused with refresh tokens. | Exchange approved codes with the matching client and securely save the returned refresh token. |
| Local snapshots/backups were mistaken for cloud delivery/recovery. | Verify downloaded cloud bytes, delivery receipts and a fresh offline restore with independently saved key. |
| Journal UI totals or success responses were unreliable evidence. | Read back published journal IDs, amounts, basis visibility and affected balances. |
| Blind retry after a write timeout risked double posting. | Inspect the remote outcome/reference before retry and retain explicit recovery evidence. |
| Exact daily balance differences distracted from the business goal. | Compare identical cutoffs and target prior-month books by the following 7th. |
| Cash-basis organization settings did not fix an accrual-only worker. | Set and verify `company.reportingBasis`; cash/accrual request and response validation now have regression tests. Verify each entity's live journal/report visibility. |
| A core close omitted extra account obligations. | Configure `supplementalCloseAccounts`; manual reviewed-source checks now block missing or mismatching ledgers. Daily ingestion of those reviews remains unimplemented. |
| Long status histories and stale shared copies hid the actual next step. | Maintain one concise canonical [entity record](ENTITY_RECORD.md), preserve linked history and verify shared readback. |
| Useful second-build fixes stayed in a private preparation folder. | Finish every meaningful run with the [improvement loop](CONTINUOUS_IMPROVEMENT.md); promote tested generic fixes and record adoption separately. |
| Accumulated depreciation was mistaken for current-year expense. | Use approved annual schedules; separately verify P&L expense and accumulated balances. |
| Tax schedules conflicted or the posting role was unclear. | Preserve filed continuity, resolve schedule conflicts and agree owner/agent posting versus CPA review. |
| A personal/rental split could be applied a second time by the CPA. | Put allocation-already-applied at the top of the brief and label asset/debt scope. |
| Silence could turn a guess into a permanent rule. | Limit 72-hour defaults to eligible routine proposals; keep assumptions open and learn only from validated explicit answers. |
| Names such as "mortgage" bypassed large-transaction review. | Require configured exact recurring expected amount; nonexpiring integrity/capital/historical holds remain. |
| A per-worker AI cap looked like an account-wide spend ceiling. | Explain per-deployment budget/model/pricing limits; review aggregate exposure before scaling. |
| Generated alerts were called sent; acknowledgments were called fixed. | Verify actual delivery and separate answer, application and closure evidence. |
| Potential savings became a distraction or assumed eligibility. | Keep a small optional opportunity queue with evidence, costs and verified outcome; no implicit vendor action. |
| An owner returning months later needed the whole conversation again. | Supply an operator refresher, monthly/year-end checklists and a copyable new-build prompt. |
| Green code tests or another model's agreement were treated as financial certification. | Require source-backed month/rerun acceptance and independent review; preserve tax/automation limitations. |
| A rental process was being stretched into funds without defining obligations. | Reuse interview/evidence/controls first; add established fund accounting/subledger requirements explicitly. |

See [IMPLEMENTATION_GUIDE](IMPLEMENTATION_GUIDE.md) for order and capability limits, [MONTHLY_CLOSE](MONTHLY_CLOSE.md) for financial acceptance, [YEAR_END_CLOSE](YEAR_END_CLOSE.md) for annual continuity and [OPERATOR_GUIDE](OPERATOR_GUIDE.md) for ongoing use.
