# Shared context and autonomous review contract

Extends [MUSE_HANDOFF.md](MUSE_HANDOFF.md). Examples are fictional. Every input
requires the base envelope shown below, a new immutable filename/id, and complete
UTF-8 JSON no larger than 1 MB. Only the worker publishes accepted state. Do not
edit `current.json`, SQLite, a backup, config or an already submitted inbox file.

## Shared delivery and freshness

Use the exact private Drive folder ID agreed during setup. `current.json` is an
atomic local export which Drive then syncs. Read the downloaded cloud bytes, check
`organizationId` and `generatedAt`, and compare `lastRun` with the current time.
Flag a stale run (>36 hours), missing backup, unsynced snapshot or persistent error.
Remain quiet when nothing actionable changes. Drive failures do not suspend local
approved bookkeeping; offline owner replies take effect only after worker import.

Compute SHA-256 of the downloaded file bytes. Never treat a local path or Drive
listing alone as proof of cloud delivery. Submit a receipt using the real file ID
and revision/download evidence. `storage.snapshotHash` embedded in `current.json`
describes the preceding publication (a file cannot contain its own hash); calculate
the current bytes yourself. A newer export can make an older receipt stale; reread
instead of rewriting its ID. The local pending export shows the latest hash.

If a downloader parses JSON instead of preserving its bytes, request the stored
file's `sha256Checksum` from [Google Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
An actually returned server checksum can establish cloud delivery when it matches
the latest local pending hash. Record the real file ID, checksum and verification
time in the receipt, stating this method. Size and modification time alone do not
prove byte equality. If the server checksum is unavailable, use a byte-preserving
download and hash the downloaded bytes.

```json
{
  "version": 1, "organizationId": "999000001", "kind": "shared-receipt",
  "id": "unique-cloud-receipt-id", "target": "snapshot",
  "hash": "SHA256_OF_DOWNLOADED_CURRENT_JSON", "receipt": "ACTUAL_DRIVE_FILE_ID_AND_REVISION"
}
```

`receipt` must be a nonempty **text string** of at most 1000 characters. An object,
array or null is rejected. Include the actual Drive file ID and download/revision
evidence in that string; do not replace it with a claimed verification boolean.

For an encrypted backup use `target: "backup"` and `file` equal to the exact
`storage.backup.file` basename, with its downloaded byte hash:

```json
{
  "version": 1, "organizationId": "999000001", "kind": "shared-receipt",
  "id": "unique-backup-receipt-id", "target": "backup",
  "file": "COPY_STORAGE_BACKUP_FILE", "hash": "SHA256_OF_DOWNLOADED_BACKUP",
  "receipt": "ACTUAL_DRIVE_FILE_ID_AND_DOWNLOAD_VERIFICATION"
}
```

This proves delivery,
not decryptability. The owner tests restore locally with the private key. Never
ask Muse to read the encryption key or API credentials. Current context is readable
in the private shared folder; only the database backup is additionally encrypted.

## Owner context

Read `context.revision` before submitting. A conflict rejects the update so two
conversations cannot silently replace one another. Refresh and resubmit a new ID.
Include an effective date, actual owner explanation and retrievable source. A
correction uses `supersedes` with the old fact ID and the same topic; history stays.
Optional `accountName` and `unitId` must use exact configured identifiers.

```json
{
  "version": 1, "organizationId": "999000001", "kind": "owner-context",
  "id": "unique-context-id", "expectedRevision": 0,
  "confirmedBy": "owner", "reviewer": "Owner via Muse",
  "topic": "identified personal-account funding",
  "explanation": "The identified personal-account transfers are owner funding.",
  "ownerMessage": "COPY THE OWNER'S ACTUAL WORDS",
  "source": "ACTUAL_CONVERSATION_OR_DOCUMENT_REFERENCE",
  "effectiveFrom": "2026-01-01", "accountName": "Operating Checking"
}
```

Do not backfill invented quotes or effective dates. Bring existing accounting
context from Muse into this store with its source and owner confirmation. In
particular, preserve the distinction between personal-account transfers and rent,
personal Venmo receipt recognition, allocation rules and actual tenant identities.
If a date or classification is uncertain, submit evidence and a question rather
than marking it owner-confirmed. Context supplies evidence to review; deterministic
learned rules still require a validated transaction answer.

## Evidence and AI review

The worker sends relevant context, source and evidence to DeepSeek V4 Pro. It may
propose a routine treatment or explicitly report insufficient evidence. It has no
browser/tools or direct posting authority. Muse collects source documents and
adds evidence linked to the exact source fingerprint:

```json
{
  "version": 1, "organizationId": "999000001", "kind": "review-evidence",
  "id": "unique-evidence-id", "transactionId": "COPY_FROM_PENDING",
  "fingerprint": "COPY_FROM_PENDING", "reviewer": "Muse",
  "source": "ACTUAL_STATEMENT_OR_RECEIPT_REFERENCE",
  "summary": "SOURCE-SUPPORTED FACTS; identify uncertainty rather than inventing it away."
}
```

New evidence or context invalidates unanswered proposals. Changed source date,
amount, account or description requires a fresh proposal. Evidence is retained;
corrections need a new ID explaining the earlier error. The $5 budget is monthly
in the property's timezone and applies only to this worker. Exhaustion, malformed
responses or outages queue reviews while deterministic bookkeeping continues.

## Proposals, answers and the assumptions ledger

Read `reviews` from the shared snapshot. Each record includes source/fingerprint,
classification, rationale, evidence references, createdAt/expiresAt, status and
events. Present the proposed answer and the reason plainly so the owner can respond
quickly. No owner answer means eligible execution after 72 hours from creation,
even if delivery was delayed. Do not reset the deadline by rewriting inputs.

- `awaiting-owner`: proposal exists, no provisional execution yet.
- `ready`: deadline passed; the worker still checks current source and holds.
- `applied-provisionally`: actual remote journal ID saved, owner assumption open.
- `confirmed`: actual owner answer accepted; check `remoteId`/events for posting.
- `correction-needed`: owner corrected a posted entry; existing journal needs repair.
- `superseded`: source/context changed or external work made this proposal obsolete.

Applied provisional items leave the action queue but stay in this ledger. Do not
describe them as owner-confirmed or teach a permanent rule from the timeout.
Source matching/integrity holds can remain even when a journal exists.
With the already requested monthly close summary, include the count and oldest
date of `applied-provisionally` and `correction-needed` items from `reviews`. This
keeps accumulated assumptions visible without a new alert schedule or a backlog
cap that stops ordinary automation. Do not repeatedly nudge unchanged items.

```json
{
  "version": 1, "organizationId": "999000001", "kind": "proposal-answer",
  "id": "unique-answer-id", "proposalId": "COPY_REVIEW_ID",
  "fingerprint": "COPY_REVIEW_FINGERPRINT", "reviewer": "Owner via Muse",
  "ownerMessage": "COPY ACTUAL OWNER REPLY", "decision": "confirm"
}
```

For a correction use `decision: "correct"` plus the allowed classification fields
from MUSE_HANDOFF: action, accountKey/rentalShare for expenses, or unitId for rent.
`learn: false` requests a one-off; otherwise actual owner answers learn a narrow
vendor/account/direction rule. Ambiguous Venmo/ATM/cash sources always remain exact
transaction rules. An early answer overrides the proposed classification. A late
correction learns for future sources but **does not post again or rewrite amounts**.

After an authorized repair of the original journal, submit another proposal-answer
with `decision: "resolve"` and the owner's actual explanation. The worker independently
compares that same saved journal ID's date, accounts, amounts and unit tags with the
corrected classification before marking the review confirmed. Mere acknowledgment
cannot clear the correction. Do not delete/recreate a posting to bypass this path.

## Source reconciliation

Supply complete bank/card activity for an exact cutoff from the institution's
source export, not from Zoho's own ledger. Include real posted dates and amounts,
opening/closing balances and a unique ID for **each** source row, including equal
deposits. Signed amounts follow ledger debits minus credits: TD inflow is positive;
card purchases are negative. Card balances are positive amounts owed, so card
closing = opening minus the signed row sum. TD closing = opening plus the sum.
Invalid arithmetic or incomplete coverage is rejected before audit.

```json
{
  "version": 1, "organizationId": "999000001", "kind": "source-ledger",
  "id": "unique-statement-packet-id", "accountName": "Operating Checking",
  "from": "2026-09-01", "to": "2026-09-30", "complete": true,
  "opening": 1000, "closing": 3000,
  "source": "ACTUAL_BANK_EXPORT_REFERENCE", "reviewer": "Muse",
  "rows": [{
    "id": "ACTUAL_SOURCE_ROW_ID", "date": "2026-09-01", "amount": 2000,
    "description": "FICTIONAL identified owner contribution",
    "zohoId": "ACTUAL_VERIFIED_JOURNAL_ID",
    "expectedJournal": { "date": "2026-09-01", "lines": [
      { "accountName": "Operating Checking", "debit": 2000 },
      { "accountName": "Owner Contributions", "credit": 2000 }
    ] }
  }]
}
```

`zohoId` is optional when the exact date/amount is unique, but that match is labeled
`date-amount` rather than proof of identity. Equal candidates require an explicitly
verified ID; never deduplicate solely on amount/date. `expectedJournal` is optional
and requires the exact journal ID, balanced configured accounts and actual source
date/amount. Supply it when evidence establishes the classification or unit tag.
Do not infer rent from a familiar amount. Snapshot `context.configuration.accounts`
contains the exact account names; verify the example against that configuration.

Audits compare source rows, opening/closing balances, explicit classifications and
historical journal fingerprints. Exported `scope` is cash movements and balances;
`classificationsExpected` and `classificationsVerified` report the separate coverage.
Do not claim every classification was audited if only cash totals were checked.
Historical date, account or tenant-tag changes and deleted/replaced journals remain
flagged across reruns, even when the bank total is unchanged.

Exact full-calendar-month packets for TD and Property Card are needed for the source
step of monthly completion, in addition to the existing mortgage, escrow and rent
evidence. An unpaid late tenant remains an outstanding item. Missing evidence stays
not verified. No difference causes an automatic opening-balance or plug journal.

## Limited metadata repairs

With the separately configured repair flag enabled, only explicit source rows with
`zohoId` and `expectedJournal` can drive automatic date/unit-tag repair. A unit tag
also needs `contextFactId` pointing to an active owner-confirmed fact for that unit.
Accounts, amounts, signs and line count must already agree. The adapter preserves
line IDs, descriptions, notes and references and rejects unsupported tax/project/
currency metadata. It saves before/expected/after records and independently rereads.
An uncertain response blocks another edit of that journal; later runs only verify.
This is not authority for deleting entries, changing amounts/accounts or plugging
opening balances. Do not put model output directly into source expectations.

For an owner-reviewed historical metadata change outside this automatic repair
path, use the following acknowledgment of the exact audit snapshot:

```json
{
  "version": 1, "organizationId": "999000001", "kind": "audit-change-confirmation",
  "id": "unique-history-confirmation-id", "packetId": "COPY_CURRENT_PACKET_ID",
  "snapshotHash": "COPY_CURRENT_AUDIT_SNAPSHOT_HASH", "confirmedBy": "owner",
  "reviewer": "Owner via Muse", "ownerMessage": "ACTUAL OWNER EXPLANATION"
}
```

The next audit still checks bank source rows, balances and explicit classifications.
Acknowledgment cannot erase a monetary discrepancy or incomplete source evidence.

## Installation acceptance evidence

Before claiming this loop works, report the actual Mac commit, Node version, one
successful worker test run, private folder ID/account/path, a downloaded snapshot
and backup hash, accepted cloud receipts, accepted owner-context revision, local
restore result, and one test notification's real delivery receipt. Report each
unverified item explicitly. A real paid model response and a real journal/readback/
match remain separate deployment checks under approved credentials.

This document is a review handoff. It does not itself authorize installation,
scheduling, sending notifications or editing the live books.
