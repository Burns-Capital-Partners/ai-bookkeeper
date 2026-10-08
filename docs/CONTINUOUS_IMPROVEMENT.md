# Make each run improve the next one

The lead agent closes every meaningful session with two updates: the entity's private record, and any reusable improvement to this repository. This is an agent workflow; the scheduled worker does not rewrite guides, approve its own changes or deploy new code.

## The short closeout

1. **Leave the entity resumable.** Refresh its shared STATUS.md, update the current milestone/open queue and evidence, preserve prior answers, name the next action and verify the shared readback. Follow [ENTITY_RECORD](ENTITY_RECORD.md).
2. **Capture only useful friction.** What failed, caused repeated questions/logins, took avoidable effort or led to a wrong result? Record the cause and the change that would prevent a recurrence. If there is no new lesson, say so; do not create filler.
3. **Put the fix where it changes behavior.** Correct the actual intake/checklist/template for a process failure. For a code defect or proven reusable adaptation, change code and add a synthetic regression test. Keep unimplemented requests explicitly open with a concrete next action.
4. **Verify and publish within authority.** Review the diff for private data, run applicable checks, record the commit/PR, and update the capability table. Never copy real statements, tenant identities, account IDs, tokens or production config into tests/history.
5. **Record adoption separately.** A repo release is available to other entities; it is not automatically installed there. Each deployment adopts deliberately, preserves its own policies/state and repeats affected acceptance checks. Do not reopen unrelated completed setup.

Use a compact private session note: `observed problem -> cause -> generic change -> verification -> repo commit -> deployment adoption`. Link detailed evidence instead of copying conversations into the common repo.

## What the second build changed

| Reusable finding | Where the process now handles it | Implementation level |
|---|---|---|
| Cash P&L policy must reach the report request and its validation | `company.reportingBasis`, `src/zoho.ts`, report regression tests | Code and synthetic tests; live entity acceptance still required |
| A core bank/card close could ignore additional deposit/loan ledgers | `supplementalCloseAccounts`, close review file, missing/malformed/mismatch tests | Code and synthetic tests; reviewed inputs, not automatic extra feeds |
| Reconciled pooled cash does not prove tenant obligations are funded | Interview, [monthly close](MONTHLY_CLOSE.md), separate custody/liability review | Operator procedure; no automated tenant subledger or legal allocation |
| Old profiles, personal use and cross-property payments change treatment | Dated context, migration map, owner-answer batch and destination handoff | Operator procedure; entity facts stay private |
| Repeated sign-ins and serial questions cost owner time | Source inventory before login, complete useful collection batch, stable question IDs | Operator procedure; collection/delivery requires actual execution |
| Long status histories hide the current answer | One concise current STATUS.md with linked historical archive | Record/template and required session workflow |
| A historical correction can coexist with a later obsolete adjustment | Search all dates; compare opening, target and current balances; verify counterpart/P&L effects | Operator repair acceptance; no automatic reversal authority |
| Annual posting and independent review were assumed rather than assigned | [Year-end close](YEAR_END_CLOSE.md), [CPA handoff](CPA_TAX_HANDOFF.md), explicit preparer/poster/reviewer | Procedure; annual posting command remains unimplemented |
| A successful local test was called a running service | Separate code, financial, delivery, recovery and unattended receipts | Acceptance procedure; each entity must supply evidence |
| Shared-status writes can fail after the accounting task succeeds | Verify shared write access early; retain failed update and disclose stale shared state | Operator procedure; never silently create another current tracker |

## Keep the feedback small

Promote a fix when it is a repeatable mistake, a missing control or a useful adaptation that was actually exercised. Do not generalize one property's allocation, merchant purpose or tax choice into a global default. Keep optional savings ideas and speculative features in the private queue until there is a concrete case.

For a new build, read this file and [LESSONS_LEARNED](LESSONS_LEARNED.md) before the interview. At a monthly close, update only lessons newly demonstrated by that run. The goal is fewer recurring mistakes and less owner involvement, not more documents.
