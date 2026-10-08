# Private entity coordination templates

Copy the sections into the approved private entity workspace. Do not fill this repository copy with tenant, bank, tax or credential data. These are human-readable operator templates, **not** JSON schemas accepted by the worker. Use [MUSE_HANDOFF](../MUSE_HANDOFF.md) and [AUTONOMOUS_HANDOFF](../AUTONOMOUS_HANDOFF.md) for machine inputs.

## STATUS.md

Use the dedicated [STATUS template](STATUS.md) and [entity-record contract](../ENTITY_RECORD.md). Update the existing shared file in place. Link archived history instead of accumulating a second current tracker.

## CONTEXT.md and ACCESS.md

Use the concise [owner/CPA context template](CONTEXT.md). Keep technical access details separate and link detailed owner-answer history. Record confirmed policies/answers with topic, entity/account, source, effective dates, confidence, actual owner explanation and superseded revision. Keep a dated account/use map, receipt/transfer routes, reporting basis, asset schedule ownership, limits and repair authority. Distinguish a clue from an approved rule.

Access register columns: source/account role, masked identity, official portal, authorized method/operator/host, approved password-manager item reference, MFA/session requirements, observed failures, last proven account-scoped access and recovery action. Never store passwords/tokens/OTP, secret file contents or unrelated personal records here.

## REVIEW_QUEUE.md

| ID | Account/period/source | Unknown and book impact | Supported proposal | State/deadline | Owner | Answer / application / closure evidence |
|---|---|---|---|---|---|---|
| [stable ID] | [reference] | [purpose or discrepancy; amount] | [treatment + confidence or insufficient evidence] | [held / asked / provisional / resolved] | [role] | [dated answer; accepted input + Zoho reference; verification] |

Keep reported/notified, answered, applied and verified states separate. Eligible timer defaults remain provisional/unresolved until reviewed. Holds never silently expire. Acknowledgment is not accounting resolution. Group the next owner batch by topic; retain prior answers and question IDs.

## source-manifest.csv

```csv
id,source,account_alias,period_start,period_end,kind,private_path,acquired_at,sha256,coverage_state,notes
```

`kind` distinguishes provider original, supported export, browser observation and derived data. Verify actual bytes/account/period and required calendar coverage. Record collection effort separately if comparing methods; never use a document count as proof of coverage.

## Optional opportunities

Keep in the same private review area when useful: ID, dated source fact, uncertainty, benefit assumptions, known costs, owner, next action/review date and actual disposition. Do not mix speculative savings with mandatory reconciliation or count savings before the billing/result is verified.
