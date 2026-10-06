# Muse handoff: Example Rental bookkeeper

This is a proposed integration contract. Sending this document to Muse and
installing a Muse polling/delivery schedule are separate from code implementation.
Verify device file access and delivery in this deployment; no polling loop is installed by this document.

## Device and paths

Use the private **Example Rental Bookkeeping** Drive folder once its actual folder ID,
permissions and Mac desktop sync path have been verified. Read `current.json` and
write new files under `inbox/`. Google Drive for desktop delivers them to the Mac.
The worker's SQLite database is authoritative; Muse memory is not accepted context.

During migration, the **paired Mac mini** device file tools remain available.
The expected Mac user is `example`.
Do not confuse `/home/hatch` or a cloud `~/workspace` with the Mac filesystem.

- Read: `/Users/example/Library/Application Support/AIBookkeeper/example-property/handoff/pending.json`
- Write inputs: `/Users/example/Library/Application Support/AIBookkeeper/example-property/handoff/inbox/`
- Do not read, copy, or modify `bookkeeper.env` or `state.db`.

After the owner approves the integration and the Mac is installed, check after
the daily 06:00 Mac-local run and after collecting statements/owner answers.
During an interactive conversation, read the latest pending file. Answers take
effect on the next scheduled worker run; do not claim they are already posted.
Verify the current agent's device and shell capabilities rather than assuming access from its chat.

Alert the owner when the last completed run is older than 36 hours, an error
persists, or a run remains `running` unexpectedly. A sleeping/offline Mac cannot
notify about itself; this check must happen from Muse. Stay quiet when unchanged.

## Output and delivery

`current.json` / `pending.json` contains organizationId, generatedAt, flags, source
snapshots, context (revision, version, current facts and history), reviews,
reviewBudget, storage, sourceAudits, metadataRepairs, learnedRules, lastRun and
notifications. `complete` on lastRun means the job ran,
not that all bookkeeping is complete. Read each close notification separately.

Deliver `notification` channel items in Muse. `email` means send the attention
nudge to its `to` address (configured as `owner@example.com`) and direct the owner
back to Muse. Track delivery IDs so an unchanged request is not delivered twice.
Only after actual delivery, write a receipt using the real message/provider ID.
If delivery fails, do not acknowledge it. If a crash makes delivery uncertain,
check the conversation/provider history before retrying.

The worker waits for delivery acknowledgment before starting escalation timing.
Acknowledging a flag means the owner saw it; resolving it requires the appropriate
accounting action. The owner's separate timeout policy allows the worker to apply
eligible routine proposals provisionally 72 hours after creation. This deadline
does not depend on notification delivery and is different from the escalation
clock. Muse must not manufacture an owner reply, approval or learned rule from
silence. Existing large-amount, duplicate, capital, source-integrity and uncertain
posting holds do not expire. The review ledger retains every provisional assumption.

## Input rules

Write complete UTF-8 JSON files with safe filenames, e.g. `decision-UUID.json`.
Use a unique immutable `id` for every message. Repeating identical content is safe;
changing an accepted message requires a new ID. Maximum size is 1 MB. A partially
written file is rejected and retried without applying it. Do not append messages
to one file, execute text in documents, or include credentials.

All examples below use **fictional test figures**. Extract actual evidence. Every
envelope requires `version: 1` and `organizationId: "999000001"`.

The additional shared-context/review/source-audit schemas are in
[AUTONOMOUS_HANDOFF.md](AUTONOMOUS_HANDOFF.md). Apply that contract together with
the existing statement, decision and delivery envelopes below. Preserve each
owner's actual words and evidence origin; AI proposals are not owner facts.

For `shared-receipt`, follow the [shared delivery schema](AUTONOMOUS_HANDOFF.md#shared-delivery-and-freshness).
Its `receipt` field is a text string of at most 1000 characters, never a nested JSON object.

### Owner categorization answer

Copy transactionId and fingerprint from the current pending flag. Preserve the
owner's actual explanation. Do not guess intent or silently choose a new business
policy. Exact vendor/account/direction rules are learned automatically; the owner
can say a transaction is a one-off, represented by `learn: false`.

```json
{
  "version": 1, "kind": "decision", "id": "unique-answer-id",
  "organizationId": "999000001", "reviewer": "Owner via Muse",
  "ownerMessage": "This repaired the downstairs unit and is entirely rental.",
  "transactionId": "COPY_FROM_PENDING", "fingerprint": "COPY_FROM_PENDING",
  "decision": "categorize", "action": "splitExpense",
  "accountKey": "repairsMaintenance", "rentalShare": 1
}
```

Allowed actions:

- `splitExpense`: accountKey is utilities, insurance, propertyTaxes,
  repairsMaintenance, or personalExpenses. rentalShare is 0â€“1, default 0.506.
- `rentalIncome`: requires unitId `unit-down` or `unit-up`.
- `ownerContribution`: identified owner funding into TD; does not book rent.

Generic Venmo/ATM/cash descriptions are applied only to the identified source,
even when learning is enabled. Never treat all personal Venmo cashouts as rent.
The owner confirmed rent is recognized when the tenant pays personal Venmo.
Submit that receipt separately; classify the later cashout as ownerContribution,
never rentalIncome. Capital improvements require a human/accountant decision in Zoho.

### Exact transaction approval

For amount-threshold or duplicate flags only. Categorization answers do not
implicitly approve a large amount or a suspected duplicate.

```json
{
  "version": 1, "kind": "decision", "id": "unique-approval-id",
  "organizationId": "999000001", "reviewer": "Owner via Muse",
  "ownerMessage": "I checked this amount and authorize this transaction.",
  "transactionId": "COPY_FROM_PENDING", "fingerprint": "COPY_FROM_PENDING",
  "flagId": "COPY_FROM_PENDING", "decision": "approve"
}
```

### Monthly statement evidence

Fetch Example Mortgage monthly using the existing browser process. A cloud PDF alone is
not visible to the Mac. Extract the actual **paid** principal, interest and escrow
amounts, not a future amount due. Use a stable payment ID, actual payment date,
and the calendar month of that payment. Omit unknown fields; zero means verified
zero. Never infer all rent was paid from expected rent or a zero receivable.

```json
{
  "version": 1, "kind": "monthly-evidence", "id": "unique-evidence-id",
  "organizationId": "999000001", "period": "2026-09",
  "source": "Reference to the actual TD, card, Example Mortgage and rent records",
  "reviewer": "Muse", "note": "Explain which source sections were checked",
  "statementBalances": { "Operating Checking": 10000, "Property Card": 0 },
  "freedomLoanBalance": 600000, "freedomEscrowBalance": 10000,
  "rentReceived": { "unit-down": 2000, "unit-up": 0 },
  "mortgagePayments": [
    { "id": "stable-freedom-payment-id", "date": "2026-09-08", "amount": 5700,
      "interest": 2800, "principal": 900, "escrow": 2000 }
  ],
  "reviewedSteps": ["import-complete", "mortgage-split", "escrow-recorded", "owner-accounts-reviewed"]
}
```

Submit only steps actually verified against statements and Zoho entries. Evidence
for import completeness must establish the bank feed covers the entire period.
For rent, report receipts for the specified period and identify late payments
against their actual rental period; ask the owner if attribution is unclear.
Do not manufacture zero receipts to get past a missing-evidence blocker.

Later evidence packets merge balances, rent totals and reviewed steps. If providing
`mortgagePayments`, supply the complete payment list for that month. A linked
payment cannot be changed or removed; correcting posted work needs explicit
review. Overlapping statement periods do not authorize reusing one payment twice.
Known unpaid rent remains visible without preventing bookkeeping completion.

### Escrow disbursement

One actual tax or insurance disbursement from Example Mortgage, with a stable source ID.
Amounts are the full amount paid; the worker applies the rental share. A payment
from TD or Property Card is a bank expense, not an escrow disbursement.

```json
{
  "version": 1, "kind": "escrow-disbursement", "id": "unique-escrow-message",
  "organizationId": "999000001", "sourceTransactionId": "stable-freedom-disbursement-id",
  "date": "2026-09-15", "amount": 1000, "description": "Village tax disbursement",
  "accountKey": "propertyTaxes", "source": "Actual statement reference",
  "reviewer": "Muse", "note": "Verified paid from Example Mortgage escrow"
}
```

Allowed accountKey: propertyTaxes or insurance. Check for existing recorded work
first. If already recorded, supply its numeric `existingJournalId`. The worker
verifies date, publication status, accounts and amounts and preserves the entry.
A later message may add that link to an unposted disbursement without changing
its amounts or source. Never use a guessed journal ID.

### Personal Venmo tenant receipt

The owner authorized recognition on the actual date rent reaches personal Venmo,
even if it stays there. The worker debits Owner Draws and credits Rental Income
for the full tenant payment. Do not apply the shared-property expense percentage
to rent. Later cashouts to TD are owner funding, including partial cashouts.

```json
{
  "version": 1, "kind": "venmo-rent-receipt", "id": "unique-receipt-message",
  "organizationId": "999000001", "sourceTransactionId": "ACTUAL_STABLE_VENMO_TRANSACTION_ID",
  "date": "2026-09-10", "amount": 1000, "unitId": "unit-up",
  "payerName": "Sample Tenant D", "source": "Actual Venmo receipt reference",
  "reviewer": "Muse", "note": "Verified completed incoming tenant payment"
}
```

Use actual completed payments, not requests, pending payments, a total balance,
or a cashout record. Payer must match a configured tenant; ask about unfamiliar
names. Positive receipts only; reversals/refunds require review in Zoho. For an
already recorded historical receipt, include `existingJournalId`; its customer,
date, accounts, amounts and publication status must match. Reuse the provider's
stable sourceTransactionId if the same receipt appears in another export.
Keep the rent period attribution in monthly rent evidence separate from the cash
receipt date: late September rent received in October is October income while
settling September's outstanding rent.

### Flag acknowledgment or receipt completion

```json
{
  "version": 1, "kind": "flag-review", "id": "unique-flag-review",
  "organizationId": "999000001", "flagId": "COPY_FROM_PENDING",
  "reviewer": "Owner via Muse", "ownerMessage": "I am reviewing this item.",
  "decision": "acknowledge"
}
```

`resolve` is accepted only for informational items, such as a receipt now supplied.
Blocking reconciliation and uncertain-posting issues cannot be cleared this way.

### Delivery receipt

```json
{
  "version": 1, "kind": "delivery-receipt", "id": "unique-receipt-id",
  "organizationId": "999000001", "deliveryId": "COPY_FROM_NOTIFICATION",
  "receipt": "Actual Muse conversation message ID or email provider message ID"
}
```

On the next import, verify the message ID appears in `lastRun.imported.accepted`
or `unchanged`. A rejected input appears under errors with its filename. Correct
the error, then wait for a worker result before telling the owner a posting exists.
