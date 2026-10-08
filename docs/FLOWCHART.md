# AI bookkeeper flowchart

[Printable PDF](ai-bookkeeper-flowchart.pdf) | [Executive overview](EXECUTIVE_OVERVIEW.md) | [Implementation guide](IMPLEMENTATION_GUIDE.md)

The diagram is the combined operating plan. Collection, notification delivery and annual adjustments are agent/operator procedures; they require actual configured execution. Worker capability limits are in the implementation guide.

```mermaid
flowchart TB
  subgraph SETUP[Set up once for each entity]
    direction LR
    S1[1. Interview and private records<br/>Accounts, history, basis, authority] --> S2[2. Verify sources<br/>Statements, openings, month coverage]
    S2 --> S3[3. Zoho and legacy migration<br/>Missing history; historical and current checks]
    S3 --> S4[4. Prepare worker<br/>Actual host, inputs, cloud recovery]
    S4 --> S5[5. Prove the books<br/>Reconciled month and unchanged rerun]
    S5 --> S6[6. Enable and observe<br/>Unattended run, backup and delivered alert]
  end
  S6 --> C
  subgraph REPEAT[Monthly goal: prior month ready by the following 7th]
    C[Collect records<br/>Feeds, statements, PM, loans, receipts] --> R{Worker checks<br/>rules and limits}
    R -->|Approved rule| Z[Record in Zoho<br/>Match sources once]
    R -->|Routine unfamiliar| A[AI proposes<br/>Collector batches owner questions]
    R -->|Held by controls| H[Keep issues visible<br/>Obtain evidence or approved treatment]
    A --> D{Valid answer or<br/>eligible 72-hour default}
    D -->|Validated treatment| Z
    D -->|Ineligible or blocked| H
    D -.-> L[Shared context and review ledger<br/>Provisional assumptions remain unresolved]
    Z --> M[Verify prior month<br/>Same-cutoff balances and classifications]
    M -->|Complete| G[Publish close and remaining issues<br/>Target: by the 7th]
    M -->|Missing evidence or error| H
    H -.->|New evidence or valid decision| C
  end
  N[Controls before every posting:<br/>exact configured recurring amount for over-limit exceptions;<br/>duplicates, capital and historical repairs stay held.<br/>Silence never teaches a permanent rule.] -.-> R
  G -->|Year-end| Y[Owner or authorized agent<br/>Approved annual adjustments once]
  Y --> CPA[Verify annual expense and carryforward<br/>CPA reports, context brief, allocation already applied]
  CPA --> F[CPA review and final adjustments<br/>Reconcile once; preserve final package]
```
