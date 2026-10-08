# One living record per entity

Use the existing private `STATUS.md` as the owner's home page and the next agent's entry point. Keep its established file ID and URL. Start a missing one from [the template](templates/STATUS.md); do not create a second current tracker.

## What it must answer

1. Which legal/property scope and exact Zoho organization are these books for?
2. Through which date are accounts reconciled, on which report basis, and with what exceptions?
3. What is automated, and when was an actual successful run observed?
4. Which dated facts and owner decisions govern the accounting?
5. What needs attention next, who owns it, and what may the agent do now?
6. Where are the supporting records, prior answers, credentials references and recovery instructions?

Keep the current summary short. The rest can contain account/use history, standing rules, a small open queue and evidence links. Reuse existing CONTEXT/ACCESS/REVIEW_QUEUE files if present; a small entity can keep these sections in STATUS.md. Do not require more files merely to fill a template.

## Read and update rules

- Read the shared copy before work and again before writing. Merge concurrent changes; never overwrite it with an older local checkpoint.
- Record both **document updated at** and **evidence checked at**. Editing a document does not refresh a balance, prove deployment or reopen a completed task.
- At kickoff, verify that the lead can read and update the existing shared record. If a write is denied, retain the prepared update privately, report that the shared copy is stale and use the approved recovery path. Do not create an unnoticed competing tracker or change permissions silently.
- After each material action or decision, update the top summary and affected queue row in place, retain source/journal/run IDs, and read the shared result back. Distinguish prepared, posted, reconciled, independently reviewed and running.
- Save detailed old status prose in a dated private history archive before shortening the live record. Verify the archive is accessible and link it from STATUS.md. Keep unique owner answers, effective dates, exceptions and authority boundaries discoverable.
- The record must name the next executable action, not just "continue." A stale setup claim prompts a targeted check, not a fresh migration, credential request or replay.
- Never rewrite worker `current.json`/`pending.json` to manufacture evidence. A human-readable summary points to their observed timestamps and IDs.
- Separate durable accounting decisions from provider credentials. Store only approved password-manager or host-file references, never secrets or private server URLs.

## Resume check

An agent with the repo and this one link should identify the entity, accounts, last verified period, material exceptions, next action and access limits without reading a chat. It should locate completed-entry references before any write. If a linked file is only on another machine, label that limitation and provide its approved shared location where available.

Do this check after a migration, after a material correction and at month-end. It is a handoff check, not a new audit of every prior month.
