/**
 * SQLite-backed state for the bookkeeper worker.
 *
 * Tracks:
 *  - processed transaction IDs (so daily runs are idempotent)
 *  - flags (status, escalation history)
 *  - close-checklist completion history
 *
 * The database file lives at data/state.db
 * (gitignored; created on first run).
 */

import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { BankTransaction, CategorizationPattern, ChecklistResult, CloseReport, Flag } from "./types.js";

export interface PostingAttempt {
  transactionId: string;
  fingerprint: string;
  status: "pending" | "uncertain" | "posted" | "retryable";
  action: string;
  reference: string;
  payload: Record<string, unknown>;
  remoteId?: string;
}

export function transactionFingerprint(txn: BankTransaction): string {
  return createHash("sha256").update(JSON.stringify([
    txn.transactionId, txn.date, txn.accountName, Math.round(txn.amount * 100),
    txn.description, txn.reference ?? "",
    ...(txn.statement ? [txn.statement] : []),
  ])).digest("hex");
}

export class BookkeeperState {
  private db: DatabaseSync;
  private lockOwner = randomUUID();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_transactions (
        transaction_id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        journal_id TEXT
      );

      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        company_name TEXT NOT NULL,
        transaction_id TEXT,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        amount REAL,
        status TEXT NOT NULL DEFAULT 'open',
        escalation_level INTEGER NOT NULL DEFAULT 0,
        last_notified_at TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS close_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        period_year INTEGER NOT NULL,
        period_month INTEGER NOT NULL,
        ran_at TEXT NOT NULL,
        complete INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        UNIQUE (company_name, period_year, period_month)
      );

      CREATE TABLE IF NOT EXISTS checklist_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        close_run_id INTEGER NOT NULL REFERENCES close_runs(id),
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        flag_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS observed_transactions (
        company_name TEXT NOT NULL, transaction_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, date TEXT NOT NULL, account TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, description TEXT NOT NULL, transaction_json TEXT NOT NULL,
        PRIMARY KEY(company_name, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS review_approvals (
        company_name TEXT NOT NULL, transaction_id TEXT NOT NULL, flag_type TEXT NOT NULL,
        fingerprint TEXT NOT NULL, reviewer TEXT NOT NULL, notes TEXT NOT NULL, approved_at TEXT NOT NULL,
        PRIMARY KEY(company_name, transaction_id, flag_type, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS posting_attempts (
        company_name TEXT NOT NULL, transaction_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        action TEXT NOT NULL, reference TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, remote_id TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(company_name, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS posting_recoveries (
        id INTEGER PRIMARY KEY, company_name TEXT NOT NULL, transaction_id TEXT NOT NULL,
        outcome TEXT NOT NULL, reviewer TEXT NOT NULL, notes TEXT NOT NULL, recorded_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfer_links (
        company_name TEXT NOT NULL, source_id TEXT NOT NULL, counterpart_id TEXT NOT NULL,
        PRIMARY KEY(company_name, source_id), UNIQUE(company_name, counterpart_id)
      );
      CREATE TABLE IF NOT EXISTS inbound_records (
        id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learned_rules (
        id TEXT PRIMARY KEY, company_name TEXT NOT NULL, pattern_json TEXT NOT NULL,
        evidence TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monthly_evidence (
        company_name TEXT NOT NULL, period TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY(company_name, period)
      );
      CREATE TABLE IF NOT EXISTS mortgage_payment_links (
        company_name TEXT NOT NULL, payment_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
        PRIMARY KEY(company_name, payment_id), UNIQUE(company_name, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY, company_name TEXT NOT NULL, level INTEGER NOT NULL,
        flag_ids_json TEXT NOT NULL, delivered_at TEXT, receipt TEXT
      );
      CREATE TABLE IF NOT EXISTS bank_matches (
        company_name TEXT NOT NULL, transaction_id TEXT NOT NULL, matched_at TEXT NOT NULL,
        PRIMARY KEY(company_name, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_values (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_lock (id INTEGER PRIMARY KEY CHECK (id=1), host TEXT NOT NULL, pid INTEGER NOT NULL, owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS statement_transactions (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
    `);
    const columns = this.db.prepare("PRAGMA table_info(flags)").all() as { name: string }[];
    for (const name of ["dedupe_key", "period", "fingerprint"]) {
      if (!columns.some((c) => c.name === name)) this.db.exec(`ALTER TABLE flags ADD COLUMN ${name} TEXT`);
    }
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS flags_open_key ON flags(company_name, dedupe_key)
      WHERE status IN ('open', 'acknowledged') AND dedupe_key IS NOT NULL`);
  }

  /** Record a transaction as processed. Idempotent on transaction_id. */
  markProcessed(
    transactionId: string,
    companyName: string,
    actionTaken: string,
    journalId?: string
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO processed_transactions
         (transaction_id, company_name, processed_at, action_taken, journal_id)
         VALUES (?, ?, datetime('now'), ?, ?)`
      )
      .run(transactionId, companyName, actionTaken, journalId ?? null);
  }

  isProcessed(transactionId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM processed_transactions WHERE transaction_id = ?`)
      .get(transactionId) as { "1": number } | undefined;
    return row !== undefined;
  }

  /** Persist a new flag. */
  saveFlag(flag: Flag): Flag {
    if (flag.transactionId && !flag.fingerprint) {
      flag.fingerprint = this.getObservation(flag.companyName, flag.transactionId)?.fingerprint;
    }
    flag.key ??= flag.transactionId ? `transaction:${flag.transactionId}:${flag.type}:${flag.fingerprint ?? "legacy"}` : undefined;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO flags
         (id, created_at, company_name, transaction_id, type, severity,
          title, detail, amount, status, escalation_level, last_notified_at, notes, dedupe_key, period, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        flag.id,
        flag.createdAt,
        flag.companyName,
        flag.transactionId ?? null,
        flag.type,
        flag.severity,
        flag.title,
        flag.detail,
        flag.amount ?? null,
        flag.status,
        flag.escalationLevel,
        flag.lastNotifiedAt ?? null,
        flag.notes ?? null,
        flag.key ?? null,
        flag.period ?? null,
        flag.fingerprint ?? null
      );
    this.db.prepare(`UPDATE flags SET title=?, detail=?, amount=? WHERE company_name=? AND dedupe_key=?
      AND status IN ('open','acknowledged')`).run(flag.title, flag.detail, flag.amount ?? null, flag.companyName, flag.key ?? null);
    const row = this.db.prepare(`SELECT * FROM flags WHERE company_name = ? AND dedupe_key = ?
      AND status IN ('open','acknowledged')`).get(flag.companyName, flag.key ?? null);
    return row ? rowToFlag(row) : flag;
  }

  /** All open (or acknowledged) flags for a company, oldest first. */
  getOpenFlags(companyName: string): Flag[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM flags
         WHERE company_name = ? AND status IN ('open', 'acknowledged')
         ORDER BY created_at ASC`
      )
      .all(companyName) as Record<string, unknown>[];
    return rows.map(rowToFlag);
  }

  /**
   * Open (unresolved) flags already raised for a transaction, optionally
   * filtered by type. Used to avoid re-flagging (and re-processing) a
   * transaction that is already pending human review.
   */
  getOpenFlagsForTransaction(transactionId: string, type?: Flag["type"]): Flag[] {
    const rows = (
      type
        ? this.db
            .prepare(
              `SELECT * FROM flags
               WHERE transaction_id = ? AND type = ?
                 AND status IN ('open', 'acknowledged')
               ORDER BY created_at ASC`
            )
            .all(transactionId, type)
        : this.db
            .prepare(
              `SELECT * FROM flags
               WHERE transaction_id = ?
                 AND status IN ('open', 'acknowledged')
               ORDER BY created_at ASC`
            )
            .all(transactionId)
    ) as Record<string, unknown>[];
    return rows.map(rowToFlag);
  }

  /**
   * Remove a transaction from the processed set so the next run picks it
   * up again. Call this when a blocking flag is resolved (e.g. a missing
   * amortization schedule was loaded, or a human categorized a pending
   * transaction).
   */
  requeueTransaction(transactionId: string): void {
    this.db
      .prepare(`DELETE FROM processed_transactions WHERE transaction_id = ?
        AND journal_id IS NULL AND action_taken LIKE 'flagged-%'`)
      .run(transactionId);
  }

  getFlag(id: string): Flag | undefined {
    const row = this.db.prepare("SELECT * FROM flags WHERE id = ?").get(id);
    return row ? rowToFlag(row) : undefined;
  }

  resolveIssue(company: string, key: string): void {
    this.db.prepare(`UPDATE flags SET status = 'resolved' WHERE company_name = ? AND dedupe_key = ?
      AND status IN ('open','acknowledged')`).run(company, key);
  }

  observeTransaction(company: string, txn: BankTransaction): string {
    const fingerprint = transactionFingerprint(txn);
    this.db.prepare(`INSERT INTO observed_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_name, transaction_id) DO UPDATE SET fingerprint=excluded.fingerprint,
      date=excluded.date, account=excluded.account, amount_cents=excluded.amount_cents,
      description=excluded.description, transaction_json=excluded.transaction_json`)
      .run(company, txn.transactionId, fingerprint, txn.date, txn.accountName.trim().toUpperCase(),
        Math.round(txn.amount * 100), txn.description.trim().replace(/\s+/g, " ").toUpperCase(), JSON.stringify(txn));
    this.db.prepare(`UPDATE flags SET status='resolved', notes='Superseded by a changed source transaction; review the new snapshot.'
      WHERE company_name=? AND transaction_id=? AND fingerprint IS NOT NULL AND fingerprint<>?
        AND type<>'posting-uncertain' AND status IN ('open','acknowledged')`).run(company, txn.transactionId, fingerprint);
    return fingerprint;
  }

  getObservation(company: string, id: string): { fingerprint: string; transaction_json: string } | undefined {
    return this.db.prepare("SELECT * FROM observed_transactions WHERE company_name = ? AND transaction_id = ?")
      .get(company, id) as { fingerprint: string; transaction_json: string } | undefined;
  }

  getInboundHash(id: string): string | undefined {
    const row = this.db.prepare("SELECT content_hash FROM inbound_records WHERE id=?").get(id);
    return row ? String(row.content_hash) : undefined;
  }

  saveStatementTransaction(txn: BankTransaction): void {
    const old = this.db.prepare("SELECT payload_json FROM statement_transactions WHERE id=?").get(txn.transactionId);
    if (old && transactionFingerprint(JSON.parse(String(old.payload_json)) as BankTransaction) !== transactionFingerprint(txn)) {
      const previous = JSON.parse(String(old.payload_json)) as BankTransaction;
      const linked = { ...previous, statement: { ...previous.statement!, existingJournalId: txn.statement?.existingJournalId } };
      if (!txn.statement?.existingJournalId || this.db.prepare("SELECT 1 FROM posting_attempts WHERE transaction_id=?").get(txn.transactionId) || transactionFingerprint(linked) !== transactionFingerprint(txn)) {
        throw new Error("Statement transaction already exists with different content. Review the saved posting before correcting it.");
      }
      this.db.prepare("UPDATE statement_transactions SET payload_json=? WHERE id=?").run(JSON.stringify(txn), txn.transactionId);
    }
    this.db.prepare("INSERT OR IGNORE INTO statement_transactions VALUES (?,?)").run(txn.transactionId, JSON.stringify(txn));
  }

  getStatementTransactions(): BankTransaction[] {
    return this.db.prepare("SELECT payload_json FROM statement_transactions ORDER BY id").all().map(r => JSON.parse(String(r.payload_json)) as BankTransaction);
  }

  getRuntime<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT payload_json FROM runtime_values WHERE key=?").get(key);
    return row ? JSON.parse(String(row.payload_json)) as T : undefined;
  }

  setRuntime(key: string, payload: unknown): void {
    this.db.prepare("INSERT INTO runtime_values VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload_json=excluded.payload_json")
      .run(key, JSON.stringify(payload));
  }

  /** Atomic compare-and-update for versioned context, proposals and cost reservations. */
  updateRuntime<T>(key: string, update: (previous: T | undefined) => T): T {
    return this.atomic(() => {
      const next = update(this.getRuntime<T>(key));
      this.setRuntime(key, next);
      return next;
    });
  }

  atomic<T>(operation: () => T): T {
    const savepoint = `operation_${randomUUID().replaceAll("-", "")}`;
    this.db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); this.db.exec(`RELEASE ${savepoint}`); return result; }
    catch (error) { this.db.exec(`ROLLBACK TO ${savepoint}`); this.db.exec(`RELEASE ${savepoint}`); throw error; }
  }

  /** SQLite creates a consistent standalone snapshot; destination must not exist. */
  snapshot(path: string): void { this.db.prepare("VACUUM INTO ?").run(path); }

  /** One Mac owns this database. Never reclaim a lock from a live process. */
  acquireWorkerLock(): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const lock = this.db.prepare("SELECT * FROM worker_lock WHERE id=1").get();
      if (lock) {
        if (lock.host !== hostname()) throw new Error("State database belongs to another host; do not share it between computers.");
        let alive = true;
        try { process.kill(Number(lock.pid), 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
        if (alive) { this.db.exec("COMMIT"); return false; }
      }
      this.db.prepare("INSERT INTO worker_lock VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET host=excluded.host,pid=excluded.pid,owner=excluded.owner")
        .run(hostname(), process.pid, this.lockOwner);
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  releaseWorkerLock(): void { this.db.prepare("DELETE FROM worker_lock WHERE owner=?").run(this.lockOwner); }

  isDeliveryConfirmed(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM notification_deliveries WHERE id=? AND delivered_at IS NOT NULL").get(id);
  }

  getMonthlyEvidencePeriods(company: string): string[] {
    return this.db.prepare("SELECT period FROM monthly_evidence WHERE company_name=? ORDER BY period").all(company).map(r => String(r.period));
  }

  pendingBankMatches(company: string): { source: BankTransaction; remoteId: string; reference: string }[] {
    const rows = this.db.prepare(`
      SELECT o.transaction_json, p.remote_id, p.reference FROM posting_attempts p
      JOIN observed_transactions o ON o.company_name=p.company_name AND o.transaction_id=p.transaction_id
      LEFT JOIN bank_matches m ON m.company_name=p.company_name AND m.transaction_id=p.transaction_id
      WHERE p.company_name=? AND p.status='posted' AND m.transaction_id IS NULL
      UNION ALL
      SELECT o.transaction_json, p.remote_id, p.reference FROM transfer_links l
      JOIN posting_attempts p ON p.company_name=l.company_name AND p.transaction_id=l.source_id
      JOIN observed_transactions o ON o.company_name=l.company_name AND o.transaction_id=l.counterpart_id
      LEFT JOIN bank_matches m ON m.company_name=l.company_name AND m.transaction_id=l.counterpart_id
      WHERE l.company_name=? AND p.status='posted' AND m.transaction_id IS NULL
    `).all(company, company);
    return rows.map(row => ({ source: JSON.parse(String(row.transaction_json)) as BankTransaction,
      remoteId: String(row.remote_id), reference: String(row.reference) })).filter(row => !row.source.statement);
  }

  isBankMatched(company: string, transactionId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM bank_matches WHERE company_name=? AND transaction_id=?").get(company, transactionId);
  }

  completeBankMatch(company: string, transactionId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO bank_matches VALUES (?,?,?)").run(company, transactionId, new Date().toISOString());
    this.db.prepare("UPDATE flags SET status='resolved' WHERE company_name=? AND transaction_id=? AND type='source-match'").run(company, transactionId);
  }

  queueDelivery(id: string, company: string, level: number, flagIds: string[]): void {
    this.db.prepare("INSERT OR IGNORE INTO notification_deliveries VALUES (?,?,?,?,NULL,NULL)")
      .run(id, company, level, JSON.stringify(flagIds));
  }

  confirmDelivery(id: string, company: string, receipt: string): void {
    const delivery = this.db.prepare("SELECT * FROM notification_deliveries WHERE id=? AND company_name=?").get(id, company);
    if (!delivery || !receipt.trim()) throw new Error("Delivery acknowledgment requires a known delivery and receipt.");
    if (delivery.delivered_at) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE notification_deliveries SET delivered_at=?, receipt=? WHERE id=?").run(now, receipt, id);
      for (const flagId of JSON.parse(String(delivery.flag_ids_json)) as string[]) {
        this.db.prepare(`UPDATE flags SET last_notified_at=?, escalation_level=MAX(escalation_level,?)
          WHERE id=? AND company_name=? AND status='open' AND escalation_level<=?`)
          .run(now, Number(delivery.level), flagId, company, Number(delivery.level));
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  recordInbound(id: string, hash: string, payload: unknown): void {
    this.db.prepare("INSERT OR IGNORE INTO inbound_records VALUES (?,?,?,?)")
      .run(id, hash, JSON.stringify(payload), new Date().toISOString());
  }

  saveLearnedRule(id: string, company: string, pattern: CategorizationPattern, evidence: string): void {
    this.db.prepare("INSERT OR IGNORE INTO learned_rules VALUES (?,?,?,?,?)")
      .run(id, company, JSON.stringify(pattern), evidence, new Date().toISOString());
  }

  getLearnedRules(company: string): CategorizationPattern[] {
    return this.db.prepare("SELECT pattern_json FROM learned_rules WHERE company_name=? ORDER BY created_at DESC, rowid DESC")
      .all(company).map(r => JSON.parse(String(r.pattern_json)) as CategorizationPattern);
  }

  saveMonthlyEvidence(company: string, period: string, payload: unknown): void {
    // A later statement packet may add missing evidence, but cannot silently replace
    // a mortgage payment already linked to a posting. The importer checks that case.
    this.db.prepare(`INSERT INTO monthly_evidence VALUES (?,?,?)
      ON CONFLICT(company_name,period) DO UPDATE SET payload_json=excluded.payload_json`)
      .run(company, period, JSON.stringify(payload));
  }

  getMonthlyEvidence(company: string, period: string): unknown {
    const row = this.db.prepare("SELECT payload_json FROM monthly_evidence WHERE company_name=? AND period=?").get(company, period);
    return row ? JSON.parse(String(row.payload_json)) : undefined;
  }

  mortgagePaymentTransaction(company: string, paymentId: string): string | undefined {
    const row = this.db.prepare("SELECT transaction_id FROM mortgage_payment_links WHERE company_name=? AND payment_id=?").get(company, paymentId);
    return row ? String(row.transaction_id) : undefined;
  }

  linkMortgagePayment(company: string, paymentId: string, transactionId: string): boolean {
    this.db.prepare("INSERT OR IGNORE INTO mortgage_payment_links VALUES (?,?,?)").run(company, paymentId, transactionId);
    return this.mortgagePaymentTransaction(company, paymentId) === transactionId;
  }

  findDuplicates(company: string, txn: BankTransaction): string[] {
    const rows = this.db.prepare(`SELECT transaction_id FROM observed_transactions
      WHERE company_name = ? AND transaction_id <> ? AND account = ? AND amount_cents = ?
      AND description = ? AND ABS(julianday(date) - julianday(?)) <= 3`)
      .all(company, txn.transactionId, txn.accountName.trim().toUpperCase(), Math.round(txn.amount * 100),
        txn.description.trim().replace(/\s+/g, " ").toUpperCase(), txn.date) as { transaction_id: string }[];
    return rows.map((r) => r.transaction_id);
  }

  isApproved(company: string, txn: BankTransaction, type: Flag["type"]): boolean {
    return !!this.db.prepare(`SELECT 1 FROM review_approvals WHERE company_name = ? AND transaction_id = ?
      AND flag_type = ? AND fingerprint = ?`).get(company, txn.transactionId, type, transactionFingerprint(txn));
  }

  approveFlag(id: string, reviewer: string, notes: string): void {
    if (!reviewer.trim() || !notes.trim()) throw new Error("Approval requires a reviewer and a note.");
    const flag = this.getFlag(id);
    if (!flag?.transactionId || !["amount-threshold", "duplicate"].includes(flag.type)) {
      throw new Error("Only amount-threshold and duplicate flags accept posting approval.");
    }
    const observed = this.getObservation(flag.companyName, flag.transactionId);
    if (!observed || !flag.fingerprint || observed.fingerprint !== flag.fingerprint) {
      throw new Error("Transaction changed or has no saved snapshot; review the current transaction first.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT OR IGNORE INTO review_approvals VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(flag.companyName, flag.transactionId, flag.type, flag.fingerprint, reviewer, notes, new Date().toISOString());
      this.updateFlag(id, { status: "resolved", notes: `${reviewer}: ${notes}` });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  claimPosting(company: string, txn: BankTransaction, action: string, reference: string, payload: unknown): boolean {
    const result = this.db.prepare(`INSERT INTO posting_attempts
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
      ON CONFLICT(company_name, transaction_id) DO UPDATE SET status='pending', updated_at=excluded.updated_at,
      fingerprint=excluded.fingerprint, action=excluded.action, reference=excluded.reference, payload_json=excluded.payload_json
      WHERE posting_attempts.status='retryable'`)
      .run(company, txn.transactionId, transactionFingerprint(txn), action, reference, JSON.stringify(payload), new Date().toISOString());
    return Number(result.changes) === 1;
  }

  getPosting(company: string, id: string): PostingAttempt | undefined {
    const row = this.db.prepare("SELECT * FROM posting_attempts WHERE company_name = ? AND transaction_id = ?").get(company, id);
    return row ? {
      transactionId: String(row.transaction_id), status: row.status as PostingAttempt["status"],
      fingerprint: String(row.fingerprint),
      action: String(row.action), reference: String(row.reference), payload: JSON.parse(String(row.payload_json)),
      remoteId: row.remote_id ? String(row.remote_id) : undefined,
    } : undefined;
  }

  markPostingUncertain(company: string, id: string): void {
    this.db.prepare("UPDATE posting_attempts SET status='uncertain' WHERE company_name=? AND transaction_id=? AND status='pending'")
      .run(company, id);
  }

  completePosting(company: string, id: string, action: string, remoteId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE posting_attempts SET status='posted', remote_id=?, updated_at=? WHERE company_name=? AND transaction_id=?")
        .run(remoteId, new Date().toISOString(), company, id);
      this.markProcessed(id, company, action, remoteId);
      this.db.prepare("UPDATE flags SET status='resolved' WHERE company_name=? AND transaction_id=? AND type='posting-uncertain'")
        .run(company, id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** Operator verifies the remote result and stops all workers before recovery. */
  recoverPosting(company: string, id: string, outcome: { remoteId: string } | { confirmedNotPosted: true }, reviewer: string, notes: string): void {
    const attempt = this.getPosting(company, id);
    if (!reviewer.trim() || !notes.trim() || !attempt || !["pending", "uncertain"].includes(attempt.status)) {
      throw new Error("Recovery requires an uncertain/pending attempt, reviewer, and verification note.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const remoteId = "remoteId" in outcome ? outcome.remoteId.trim() : undefined;
      if ("remoteId" in outcome && !remoteId) throw new Error("Remote ID must not be empty.");
      this.db.prepare("UPDATE posting_attempts SET status=?, remote_id=?, updated_at=? WHERE company_name=? AND transaction_id=?")
        .run(remoteId ? "posted" : "retryable", remoteId ?? null, new Date().toISOString(), company, id);
      if (remoteId) this.markProcessed(id, company, attempt.action, remoteId);
      this.db.prepare("INSERT INTO posting_recoveries(company_name,transaction_id,outcome,reviewer,notes,recorded_at) VALUES(?,?,?,?,?,?)")
        .run(company, id, remoteId ? `posted:${remoteId}` : "confirmed-not-posted", reviewer, notes, new Date().toISOString());
      this.db.prepare("UPDATE flags SET status='resolved' WHERE company_name=? AND transaction_id=? AND type='posting-uncertain'")
        .run(company, id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  findTransferSources(company: string, txn: BankTransaction, from: string, to: string): PostingAttempt[] {
    const rows = this.db.prepare(`SELECT p.transaction_id FROM posting_attempts p
      LEFT JOIN transfer_links l ON l.company_name=p.company_name AND l.source_id=p.transaction_id
      WHERE p.company_name=? AND p.action='transfer' AND p.status='posted' AND l.source_id IS NULL
        AND ROUND(json_extract(p.payload_json,'$.amount')*100)=?
        AND ABS(julianday(json_extract(p.payload_json,'$.date'))-julianday(?))<=3`)
      .all(company, Math.round(Math.abs(txn.amount) * 100), txn.date) as { transaction_id: string }[];
    return rows.map((r) => this.getPosting(company, r.transaction_id)!).filter((p) =>
      p.payload.fromAccount === from && p.payload.toAccount === to);
  }

  linkTransferCounterpart(company: string, source: PostingAttempt, txn: BankTransaction): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("INSERT OR IGNORE INTO transfer_links VALUES (?,?,?)").run(company, source.transactionId, txn.transactionId);
      const linked = Number(result.changes) === 1 || !!this.db.prepare(
        "SELECT 1 FROM transfer_links WHERE company_name=? AND source_id=? AND counterpart_id=?"
      ).get(company, source.transactionId, txn.transactionId);
      if (linked) this.markProcessed(txn.transactionId, company, "transfer-counterpart", source.remoteId);
      this.db.exec("COMMIT");
      return linked;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** Update a flag's status and/or escalation level. */
  updateFlag(
    id: string,
    patch: Partial<Pick<Flag, "status" | "escalationLevel" | "notes" | "lastNotifiedAt">>
  ): void {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.escalationLevel !== undefined) {
      sets.push("escalation_level = ?");
      vals.push(patch.escalationLevel);
    }
    if (patch.notes !== undefined) {
      sets.push("notes = ?");
      vals.push(patch.notes);
    }
    if (patch.lastNotifiedAt !== undefined) {
      sets.push("last_notified_at = ?");
      vals.push(patch.lastNotifiedAt);
    }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE flags SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  /**
   * Record a completed close run with its step results.
   *
   * BUG FIX (rerun crash): the old code used INSERT OR REPLACE on close_runs,
   * which deletes the parent row while checklist_history still references it,
   * violating the foreign key. We now explicitly delete the old run's
   * checklist rows and the old run itself inside a transaction before
   * inserting the fresh run.
   */
  saveCloseRun(report: CloseReport): void {
    const findOld = this.db.prepare(
      `SELECT id FROM close_runs
       WHERE company_name = ? AND period_year = ? AND period_month = ?`
    );
    const old = findOld.get(
      report.companyName,
      report.periodYear,
      report.periodMonth
    ) as { id: number } | undefined;

    const insert = this.db.prepare(
      `INSERT INTO close_runs
       (company_name, period_year, period_month, ran_at, complete, report_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const stepStmt = this.db.prepare(
      `INSERT INTO checklist_history
       (close_run_id, step_id, status, detail, flag_ids_json)
       VALUES (?, ?, ?, ?, ?)`
    );
    const delSteps = this.db.prepare(
      `DELETE FROM checklist_history WHERE close_run_id = ?`
    );
    const delRun = this.db.prepare(`DELETE FROM close_runs WHERE id = ?`);

    const tx = () => {
      this.db.exec("BEGIN");
      try {
        if (old) {
          delSteps.run(old.id);
          delRun.run(old.id);
        }
        const info = insert.run(
          report.companyName,
          report.periodYear,
          report.periodMonth,
          report.ranAt,
          report.complete ? 1 : 0,
          JSON.stringify(report)
        );
        const runId = Number(info.lastInsertRowid);
        for (const step of report.steps) {
          stepStmt.run(
            runId,
            step.stepId,
            step.status,
            step.detail ?? null,
            JSON.stringify(step.flagIds)
          );
        }
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    };
    tx();
  }

  /**
   * Resolve a flag and, when it references a transaction, put that
   * transaction back in the work queue so the next run reprocesses it.
   */
  resolveFlagAndRequeue(id: string, notes?: string): void {
    const row = this.db
      .prepare(`SELECT transaction_id FROM flags WHERE id = ?`)
      .get(id) as { transaction_id: string | null } | undefined;
    this.updateFlag(id, { status: "resolved", notes });
    if (row?.transaction_id) {
      this.requeueTransaction(row.transaction_id);
    }
  }

  /** Most recent close run for a company/period, if any. */
  getCloseRun(
    companyName: string,
    year: number,
    month: number
  ): CloseReport | undefined {
    const row = this.db
      .prepare(
        `SELECT report_json FROM close_runs
         WHERE company_name = ? AND period_year = ? AND period_month = ?
         ORDER BY ran_at DESC LIMIT 1`
      )
      .get(companyName, year, month) as { report_json: string } | undefined;
    return row ? (JSON.parse(row.report_json) as CloseReport) : undefined;
  }

  close(): void {
    this.db.close();
  }
}

function rowToFlag(row: Record<string, unknown>): Flag {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    companyName: row.company_name as string,
    transactionId: (row.transaction_id as string) ?? undefined,
    type: row.type as Flag["type"],
    severity: row.severity as Flag["severity"],
    title: row.title as string,
    detail: row.detail as string,
    amount: (row.amount as number) ?? undefined,
    status: row.status as Flag["status"],
    escalationLevel: row.escalation_level as number,
    lastNotifiedAt: (row.last_notified_at as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    key: (row.dedupe_key as string) ?? undefined,
    period: (row.period as string) ?? undefined,
    fingerprint: (row.fingerprint as string) ?? undefined,
  };
}

export type { ChecklistResult };
