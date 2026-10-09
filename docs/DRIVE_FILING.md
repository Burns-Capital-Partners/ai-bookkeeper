# Set up and maintain the shared filing cabinet

Every new entity setup must establish this filing layout before collecting records or configuring the shared worker path. This is an agent/operator checklist; the worker does not create the full filing cabinet. On later visits, reuse the same folders and documents, create only what is missing, and keep the index current.

## Find the approved home first

1. Read the approved shared drive's `00) Start Here/DRIVE_GUIDE.md` (or its existing equivalent), then the entity's current `STATUS.md` and `CONTEXT.md`. Follow the drive's folder rules and recorded access authority.
2. For BCP, the home is `BCP/01) Investments/<entity or property>/Bookkeeping`. Reuse the existing deal folder and Bookkeeping folder. For another approved destination, follow its guide and record the equivalent home; do not create a second archive in My Drive.
3. Inventory existing folders, loose files and report/CPA archives before adding anything. Record actual Drive folder/file IDs and links rather than guessing from a name or copying another entity's IDs. Verify read and update access without expanding sharing.

## Required layout

Create or reuse these base folders and four Markdown documents. Institution/source and year folders are added only when there are records to file; no empty monthly or future-year trees are needed.

```text
Bookkeeping/
  README.md                  navigation, folder links and worker location
  STATUS.md                  concise verified progress and next actions
  CONTEXT.md                 standing owner/CPA facts and decisions
  STATEMENT_INDEX.md         saved sources, actual coverage and gaps
  Statements/
    <institution or source>/<statement issue year>/
    <institution or source>/Multi-year exports/     when applicable
  Reports & CPA/
    <reporting year>/
  Worker/
    inbox/
    backups/
    Evidence/<year>/
    History/
```

Follow [ENTITY_RECORD](ENTITY_RECORD.md) for status/context. Link any existing access register, review queue, manifest or staging area; create supporting records under `Worker/` only as needed, instead of making competing current trackers. `Worker/History/` holds dated human summaries and context history. Generated worker snapshots such as `current.json` belong in `Worker/` only when published by the worker; never invent or edit them as setup evidence.

## File each new record

- **Statements:** preserve original PDF/CSV bytes and existing filenames. Use the actual statement issue year and record the printed billing cycle; a filename or issue month does not prove calendar-month coverage. Keep a multi-year export intact in `Multi-year exports/` and record its actual date range. Use a masked account label/subfolder if one institution has multiple accounts that could be confused.
- **Reports & CPA:** file reports, schedules and dated CPA packages by reporting year. A ZIP is a dated snapshot. If individual originals are extracted for browsing, retain the ZIP, verify the extracted bytes/hashes against it and record provenance in the index.
- **Worker/Evidence:** keep dated browser observations, investigations, normalization/reconciliation receipts and filing verification by year. Label observations and derived data separately from provider originals. A saved source is not proof of accepted input, posted entries, reconciliation or a completed close.
- **Worker/inbox:** submit reviewed envelopes using [MUSE_HANDOFF](MUSE_HANDOFF.md) and [AUTONOMOUS_HANDOFF](AUTONOMOUS_HANDOFF.md). Submitted records are immutable; corrections use a new filename/record ID under the contract. Never put raw statements directly into the inbox as though the worker parses them.
- **Existing files:** an authorized move within Drive should retain the original file ID/link, name and bytes. Do not replace originals with reuploads. Preserve historical citations; use the index to resolve old paths to current locations. Moving an active worker folder/path is a separate controlled migration, not a routine filing step.

## Maintain STATEMENT_INDEX.md

Keep one current index in the Bookkeeping root, linked from README and STATUS. Update it whenever sources are added or moved, or coverage findings change. Include the inventory-check date, linked source folders, masked account/source identity, record type, actual printed cycle/export dates, source links and provenance. Keep hashes in a linked manifest or filing receipt if that keeps the index readable.

| Source/account | Type | Actual covered dates | File/folder link | Provenance / coverage limits |
|---|---|---|---|---|
| [Institution; masked account] | [Provider PDF / CSV / observation / derived record] | [Printed cycle or verified export range] | [Stable Drive link] | [Original or exact archive extraction; gaps and evidence limits] |

List unlocated periods explicitly after searching existing folders and archives. Say where the search was performed; `unlocated in saved inventory` does not mean the institution has no record. Distinguish a transaction export from a monthly statement and source coverage from bookkeeping completion. Do not silently collect extra years or reopen closed books just to fill an index.

## Verify setup and continuing filing

- Confirm the actual Drive parents, required folders and four documents exist once, with working links. Reuse current STATUS/CONTEXT URLs and preserve prior decisions; do not overwrite them from blank templates or stale local copies.
- Read back the shared README, index and any changed status/context. Check account/period labels against the sources and verify moved/extracted bytes with hashes; retain a dated private filing receipt when reorganizing existing records.
- For a new deployment, set `BOOKKEEPER_SHARED_PATH` to the actual Drive-desktop-synced **Bookkeeping/Worker** path. Verify actual-host sync and worker receipts through the implementation/handoff acceptance checks. Do not guess a local path or point the worker at the Bookkeeping root. Preserve an existing deployed path unless a migration is explicitly authorized.
- Keep the active SQLite database, credentials and backup key in the approved private runtime/password manager outside Drive. Drive holds records and shared evidence; Zoho remains the official books and GitHub holds the reusable process/code.
- Record the verified filing home and any unlocated coverage in the same entity record. Folder creation does not authorize posting, activation, scheduling, deletion or broader access. A documentation or filing change alone does not require repeating unrelated completed worker acceptance checks.
