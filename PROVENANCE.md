# Source and verification

Extracted October 6, 2026 from the existing rental worker at source commit `f23552c2f8ab62f00a7b00a26ffc081a57f51602`, using an explicit source/test/script allowlist and a fresh repository history.

Subsequent Mac changes recovered from its recorded file edits were applied in order: full personal-expense treatment; reviewer timeout and reservation handling; complete pagination with date filtering; matching both lines of existing personal-wallet rent journals; and fresh recoverable backups after successful or failed runs. Corresponding regression tests are included.

The standalone adaptation adds its own locked TypeScript build dependencies, fictional identities, selectable entity configs, explicit bank IDs, per-entity defaults and Mac schedules, state identity binding and a blocked example-provider path. It preserves the original internal account role keys and rental checklist to avoid an unnecessary rewrite.

Local tests prove code behavior under the included fixtures and mocks. They do not certify any entity's books, provider write permissions, Mac LaunchAgent behavior on Windows, cloud delivery or production operation. Each deployment must produce those acceptance receipts independently.

Standalone verification on October 6, 2026: clean `npm ci --ignore-scripts`, 141 passing tests, and TypeScript checks passed on Node 24.14.0. The PDF overview, diagram and separate private CPA example were rendered and visually reviewed. No production bookkeeping was executed as part of this extraction.

## Process consolidation, October 7, 2026

The playbook was reviewed against the original build conversation and all 80 available turns in the follow-on rental build, together with the reusable guide's version 1.11. Private source records were used to understand failure modes, then generalized; no private account/tenant/tax records or conversation dump is included here.

The update changes setup order to independent source checks before migration; adds batching, account/use history, deposit custody, current-balance checks after historical corrections, annual continuity and operator checklists; and distinguishes implemented worker behavior from agent/operator procedures. The source worker is unchanged by this documentation consolidation. Local synthetic tests and type checks remain separate from each deployment's live acceptance.

Verification of this update: 141 tests passed, TypeScript checks passed, local document links checked, tracked text/PDF content scanned for private identities and credentials, and both single-page PDFs rendered and visually reviewed. No live accounts, deployments or schedules were changed.
