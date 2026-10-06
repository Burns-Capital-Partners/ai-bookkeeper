import { setTimeout as delay } from "node:timers/promises";
import type { BankTransaction, JournalEntry } from "./types.js";

type Json = Record<string, unknown>;
interface Account { id: string; name: string; type: string }
export interface LedgerMovement { id: string; date: string; amount: number; description: string; reference: string; journalId?: string }
export interface ZohoClientOptions {
  clientId: string;
  clientSecret?: string;
  refreshToken?: string;
  apiDomain?: string;
  writeEnabled?: boolean;
  bankAccounts?: string[];
  accountIds?: Record<string, string>;
  fetch?: typeof fetch;
}
export class ZohoNotConfiguredError extends Error {
  constructor() { super("Set the three ZOHO OAuth variables in private runtime configuration."); this.name = "ZohoNotConfiguredError"; }
}
export class ExistingBankMatchError extends Error {
  constructor() { super("Zoho found an existing entry that may match this feed item. Review or match it in Zoho before posting."); }
}
function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Zoho ${label} response.`);
  return value as Json;
}
function array(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`Missing Zoho ${label} response array.`);
  return value.map(v => object(v, label));
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing Zoho ${label}.`);
  return value;
}
function number(value: unknown, label: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) throw new Error(`Invalid Zoho ${label}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(Math.round(n * 100))) throw new Error(`Zoho ${label} exceeds supported precision.`);
  return n;
}
function date(value: unknown): string {
  const s = string(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error("Invalid Zoho date.");
  return s;
}
const canonical = (name: string) => name.trim().toUpperCase();
const cents = (n: number) => Math.round(n * 100);

// Reports nest groups and accounts under the same key. Keep account rows once,
// including parent accounts, but never mistake group totals for account values.
function reportAccounts(value: unknown): Json[] {
  return array(value, "report rows").flatMap(row => [
    ...(row.account_id ? [row] : []),
    ...(row.account_transactions === undefined ? [] : reportAccounts(row.account_transactions)),
  ]);
}
function reportAmount(value: unknown, label: string): number {
  return value === "" ? 0 : number(value, label);
}
function registerRows(value: unknown): Json[] {
  return array(value, "register rows").flatMap(row => row.account_transactions === undefined ? [row] : registerRows(row.account_transactions));
}
function reportContext(data: Json, type: string, from: string, to: string, range: boolean): Json {
  const context = object(data.page_context, "report context");
  // Zoho can echo supplied dates while silently applying its default Today
  // filter. Check the effective filter as well as the requested date fields.
  if (context.report_type !== type || context.report_basis !== "Accrual" ||
    context.applied_filter !== "TransactionDate.CustomDate" || (range && context.from_date !== from) || context.to_date !== to ||
    String(context.cash_based) !== "false" || String(context.is_for_date_range) !== String(range) ||
    (!range && context.as_of_date !== to) || context.is_comparision_report === true ||
    context.is_inv_txn_job_in_progress === true) throw new Error("Zoho report did not confirm the requested cutoff and accrual basis.");
  return context;
}

/** US Books API v3. Reads may retry; accounting writes never retry blindly. */
export class ZohoBooksClient {
  private token?: { value: string; expires: number };
  private refreshing?: Promise<string>;
  private accounts?: Account[];
  private fetcher: typeof fetch;
  constructor(private orgId: string, private opts: ZohoClientOptions) {
    if (!/^\d+$/.test(orgId)) throw new Error("Zoho organization ID must be numeric.");
    if (opts.apiDomain && !["zohoapis.com", "www.zohoapis.com"].includes(opts.apiDomain)) throw new Error("This deployment supports the US Zoho data center only.");
    this.fetcher = opts.fetch ?? fetch;
  }
  isConfigured(): boolean { return !!(this.opts.clientId.trim() && this.opts.clientSecret?.trim() && this.opts.refreshToken?.trim()); }
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) throw new ZohoNotConfiguredError();
    if (this.token && this.token.expires > Date.now() + 60000) return this.token.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await this.fetcher("https://accounts.zoho.com/oauth/v2/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret!, refresh_token: this.opts.refreshToken! }),
      }).catch(() => { throw new Error("Zoho OAuth refresh did not return a response."); });
      if (!response.ok) throw new Error(`Zoho OAuth refresh failed (HTTP ${response.status}).`);
      const data = object(await response.json().catch(() => { throw new Error("Zoho OAuth returned invalid JSON."); }), "OAuth");
      if (data.error) throw new Error("Zoho OAuth refresh was rejected. Check the private runtime credentials.");
      if (data.api_domain && data.api_domain !== "https://www.zohoapis.com") throw new Error("OAuth token belongs to a different Zoho data center.");
      this.token = { value: string(data.access_token, "access token"), expires: Date.now() + number(data.expires_in, "token lifetime") * 1000 };
      return this.token.value;
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
  private async request(method: "GET" | "POST" | "PUT", path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<Json> {
    if (method !== "GET" && !this.opts.writeEnabled) throw new Error("Live posting is disabled. Enable BOOKKEEPER_LIVE=1 when launching the worker.");
    const url = new URL(`https://www.zohoapis.com/books/v3${path}`);
    url.searchParams.set("organization_id", this.orgId);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const attempts = method === "GET" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.getAccessToken();
      let response: Response;
      try {
        response = await this.fetcher(url, { method, redirect: "error", signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch {
        if (attempt + 1 < attempts) { await delay(250 * (attempt + 1)); continue; }
        throw new Error(`Zoho ${method} ${path} did not return a response; verify any write before retrying.`);
      }
      if (method === "GET" && response.status === 401 && attempt + 1 < attempts) { this.token = undefined; continue; }
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 250 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`Zoho ${method} ${path} failed (HTTP ${response.status}).`);
      const data = object(await response.json().catch(() => { throw new Error(`Zoho ${method} ${path} returned invalid JSON; verify any write before retrying.`); }), "API");
      if (data.code !== 0) throw new Error(`Zoho ${method} ${path} rejected the request (code ${typeof data.code === "number" ? data.code : "missing"}).`);
      return data;
    }
    throw new Error("Zoho read retry limit reached.");
  }
  private async pages(path: string, key: string, query: Record<string, string | number | undefined> = {}): Promise<Json[]> {
    const records: Json[] = [];
    for (let page = 1; page <= 1000; page++) {
      const data = await this.request("GET", path, { ...query, page, per_page: 200 });
      const rows = array(data[key], key);
      records.push(...rows);
      const context = data.page_context === undefined ? undefined : object(data.page_context, "pagination");
      if (context?.has_more_page === false || (rows.length === 0 && context?.has_more_page !== true)) return records;
      if (rows.length === 0) throw new Error("Zoho returned an empty intermediate page; cannot establish completeness.");
      if (context?.has_more_page !== true) throw new Error("Zoho omitted pagination metadata; cannot establish a complete transaction list.");
    }
    throw new Error("Zoho pagination limit exceeded; no partial list was accepted.");
  }
  private async listAccounts(): Promise<Account[]> {
    if (!this.accounts) {
      const rows = await this.pages("/chartofaccounts", "chartofaccounts");
      this.accounts = rows.filter(r => r.is_active !== false).map(r => {
        if (r.currency_code && r.currency_code !== "USD") throw new Error("Non-USD account requires separate configuration.");
        return { id: string(r.account_id, "account id"), name: string(r.account_name, "account name"), type: string(r.account_type, "account type") };
      });
    }
    return this.accounts;
  }
  private async account(name: string): Promise<Account> {
    const configuredId = this.opts.accountIds?.[name];
    const found = (await this.listAccounts()).filter(a => canonical(a.name) === canonical(name) && (!configuredId || a.id === configuredId));
    if (found.length !== 1) throw new Error(`Expected one active Zoho account for ${name}; found ${found.length}.`);
    return found[0]!;
  }
  private mapBankTransaction(row: Json, account: Account): BankTransaction {
    if (row.account_id !== account.id) throw new Error("Zoho returned a transaction from another account.");
    if (row.currency_code && row.currency_code !== "USD") throw new Error("Unexpected bank transaction currency.");
    if (!["debit", "credit"].includes(String(row.debit_or_credit))) throw new Error("Zoho bank transaction direction is missing.");
    const amount = number(row.amount, "bank transaction amount");
    if (amount < 0) throw new Error("Expected an unsigned Zoho amount with debit_or_credit direction.");
    // Ledger debit increases a bank asset / reduces a credit-card liability.
    return { transactionId: string(row.transaction_id, "transaction id"), date: date(row.date),
      amount: row.debit_or_credit === "debit" ? amount : -amount, accountName: account.name, accountId: account.id,
      description: typeof row.description === "string" ? row.description : "",
      status: row.status === "uncategorized" ? "uncategorized" : "categorized",
      reference: typeof row.reference_number === "string" ? row.reference_number : undefined };
  }
  async listBankTransactions(opts?: { accountName?: string; fromDate?: string; toDate?: string; uncategorizedOnly?: boolean }): Promise<BankTransaction[]> {
    const allowed = this.opts.bankAccounts ?? [];
    if (!allowed.length || (opts?.accountName && !allowed.includes(opts.accountName))) throw new Error("Configure the exact bank accounts allowed for this worker.");
    const from = opts?.fromDate === undefined ? undefined : date(opts.fromDate);
    const to = opts?.toDate === undefined ? undefined : date(opts.toDate);
    if (from && to && from > to) throw new Error("Bank transaction dates are reversed.");
    const results: BankTransaction[] = [];
    for (const name of opts?.accountName ? [opts.accountName] : allowed) {
      const account = await this.account(name);
      if (!["bank", "credit_card"].includes(account.type)) throw new Error("Configured feed account is not a bank or credit card.");
      const rows = await this.pages("/banktransactions", "banktransactions", { account_id: account.id,
        date_start: from, date_end: to,
        filter_by: opts?.uncategorizedOnly ? "Status.Uncategorized" : "Status.All" });
      for (const row of rows) {
        if (opts?.uncategorizedOnly && row.status !== "uncategorized") continue;
        const txn = this.mapBankTransaction(row, account);
        // Uncategorized feeds can ignore the documented date parameters. Exhaust
        // pagination and apply the bounds after validating account, sign and date.
        if ((from && txn.date < from) || (to && txn.date > to)) continue;
        results.push(txn);
      }
    }
    return results;
  }
  async getBankTransaction(source: BankTransaction): Promise<BankTransaction> {
    const account = await this.account(source.accountName);
    // The detail endpoint accepts book-entry IDs, not uncategorized feed IDs.
    // Status.All is the book register and does not include uncategorized feeds.
    const pending = await this.pages("/banktransactions", "banktransactions", { account_id: account.id, filter_by: "Status.Uncategorized" });
    const matches = pending.filter(row => row.transaction_id === source.transactionId);
    if (matches.length === 1) return this.mapBankTransaction(matches[0]!, account);
    if (matches.length > 1) throw new Error("Zoho returned duplicate bank source IDs.");
    const booked = await this.pages("/banktransactions", "banktransactions", { account_id: account.id, filter_by: "Status.All" });
    const linked = booked.filter(row => row.imported_transaction_id === source.transactionId && ["matched", "categorized"].includes(String(row.status)));
    if (linked.length !== 1) throw new Error("Bank source is missing or has ambiguous linked entries; verify its status in Zoho.");
    return { ...this.mapBankTransaction(linked[0]!, account), transactionId: source.transactionId };
  }
  async checkSourceForPosting(source: BankTransaction): Promise<void> {
    await this.assertSource(source);
    const matches = await this.pages(`/banktransactions/uncategorized/${encodeURIComponent(source.transactionId)}/match`, "matching_transactions");
    // Even a plausible existing manual entry must be reviewed before a new write.
    // Do not infer that an uncategorized feed item means no journal exists.
    if (matches.some(candidate => cents(number(candidate.amount, "match amount")) === cents(Math.abs(source.amount)) &&
      candidate.debit_or_credit === (source.amount > 0 ? "debit" : "credit"))) throw new ExistingBankMatchError();
  }
  private async assertSource(source?: BankTransaction): Promise<void> {
    if (!source) return;
    const current = await this.getBankTransaction(source);
    if (current.status !== "uncategorized" || current.date !== source.date || cents(current.amount) !== cents(source.amount) || current.description !== source.description || current.reference !== source.reference) {
      throw new Error("Bank source changed or was categorized since review; no new posting was submitted.");
    }
  }
  async createJournal(entry: JournalEntry, source?: BankTransaction): Promise<string> {
    if (!entry.referenceNumber?.trim()) throw new Error("Journal requires a durable reference.");
    const lines: Json[] = []; let total = 0;
    for (const line of entry.lines) {
      if ((line.debit !== undefined) === (line.credit !== undefined)) throw new Error("Each journal line must have exactly one debit or credit.");
      const amount = number(line.debit ?? line.credit, "journal amount");
      if (amount < 0 || Math.abs(amount * 100 - cents(amount)) > 0.00001) throw new Error("Journal amounts must be nonnegative cents.");
      if (amount === 0) continue;
      const account = await this.account(line.accountName);
      total += line.debit !== undefined ? cents(amount) : -cents(amount);
      lines.push({ account_id: account.id, amount, debit_or_credit: line.debit !== undefined ? "debit" : "credit",
        description: line.description, customer_id: line.customerId });
    }
    if (total !== 0 || lines.length < 2) throw new Error("Journal must contain balanced nonzero debit and credit lines.");
    await this.assertSource(source);
    const data = await this.request("POST", "/journals", {}, { journal_date: date(entry.date), reference_number: entry.referenceNumber,
      notes: entry.notes, journal_type: "both", line_items: lines });
    const journal = object(data.journal, "journal"), id = string(journal.journal_id, "journal id");
    if (journal.status === "draft") await this.request("POST", `/journals/${encodeURIComponent(id)}/status/publish`);
    else if (journal.status !== "published") throw new Error("Created journal has an unverified publication status; inspect its reference.");
    const verified = object((await this.request("GET", `/journals/${encodeURIComponent(id)}`)).journal, "published journal");
    if (verified.status !== "published" || verified.reference_number !== entry.referenceNumber) throw new Error("Journal publication could not be verified.");
    await this.verifyJournalBody(entry, verified);
    return id;
  }
  async createTransfer(opts: { fromAccount: string; toAccount: string; amount: number; date: string; description?: string; referenceNumber?: string }, source?: BankTransaction): Promise<string> {
    if (!opts.referenceNumber || !(opts.amount > 0) || !Number.isFinite(opts.amount)) throw new Error("Transfer requires a reference and positive amount.");
    const from = await this.account(opts.fromAccount), to = await this.account(opts.toAccount);
    if (from.id === to.id || from.type !== "bank" || !["bank", "credit_card"].includes(to.type)) throw new Error("Unsupported transfer account pair.");
    await this.assertSource(source);
    const data = await this.request("POST", "/banktransactions", {}, { from_account_id: from.id, to_account_id: to.id,
      transaction_type: to.type === "credit_card" ? "card_payment" : "transfer_fund", amount: opts.amount,
      date: date(opts.date), description: opts.description, reference_number: opts.referenceNumber });
    return string(object(data.banktransaction, "transfer").transaction_id, "transfer id");
  }
  async verifyExistingJournal(entry: JournalEntry, id: string): Promise<string> {
    const found = object((await this.request("GET", `/journals/${encodeURIComponent(id)}`)).journal, "existing journal");
    await this.verifyJournalBody(entry, found);
    return id;
  }
  private async verifyJournalBody(entry: JournalEntry, found: Json): Promise<void> {
    const expected = [];
    for (const line of entry.lines.filter(l => cents(l.debit ?? l.credit!) !== 0)) expected.push(`${(await this.account(line.accountName)).id}:${line.debit !== undefined ? "debit" : "credit"}:${cents(line.debit ?? line.credit!)}:${line.customerId ?? ""}`);
    const actual = array(found.line_items, "existing journal lines").map(line => `${string(line.account_id, "line account")}:${line.debit_or_credit}:${cents(number(line.amount, "line amount"))}:${line.customer_id ?? ""}`);
    if (found.status !== "published" || found.journal_date !== entry.date || JSON.stringify(expected.sort()) !== JSON.stringify(actual.sort())) {
      throw new Error("Existing statement journal does not match the expected date, accounts and amounts.");
    }
  }

  async getJournalSnapshot(id: string): Promise<JournalEntry> {
    const journal = object((await this.request("GET", `/journals/${encodeURIComponent(id)}`)).journal, "journal");
    return this.journalSnapshot(journal);
  }
  private async journalSnapshot(journal: Json): Promise<JournalEntry> {
    if (journal.status !== "published") throw new Error("Journal is not published.");
    const accounts = await this.listAccounts();
    return { date: date(journal.journal_date), notes: typeof journal.notes === "string" ? journal.notes : "",
      referenceNumber: typeof journal.reference_number === "string" ? journal.reference_number : "",
      lines: array(journal.line_items, "journal lines").map(line => {
        const account = accounts.find(a => a.id === line.account_id), amount = number(line.amount, "journal amount");
        if (!account || amount <= 0 || !["debit", "credit"].includes(String(line.debit_or_credit))) throw new Error("Invalid journal account, amount or direction.");
        return { accountName: account.name, ...(line.debit_or_credit === "debit" ? { debit: amount } : { credit: amount }),
          ...(line.customer_id ? { customerId: string(line.customer_id, "customer id") } : {}) };
      }) };
  }

  /** Targeted edit only: no account, amount, direction, line count, reference or note changes. */
  async repairJournalMetadata(id: string, before: JournalEntry, expected: JournalEntry): Promise<JournalEntry> {
    const raw = object((await this.request("GET", `/journals/${encodeURIComponent(id)}`)).journal, "journal to repair");
    const current = await this.journalSnapshot(raw);
    const signature = (entry: JournalEntry, metadata: boolean) => JSON.stringify([
      ...(metadata ? [entry.date, entry.referenceNumber, entry.notes] : []),
      entry.lines.map(l => [l.accountName, l.debit ?? null, l.credit ?? null, ...(metadata ? [l.customerId ?? ""] : [])]).map(l => JSON.stringify(l)).sort(),
    ]);
    if (signature(current, true) !== signature(before, true)) throw new Error("Journal changed after repair preparation; no edit submitted.");
    if (signature(current, false) !== signature(expected, false)) throw new Error("Automatic repair cannot change accounts, amounts or line count.");
    if (raw.currency_code !== "USD" || (raw.exchange_rate !== undefined && Number(raw.exchange_rate) !== 1) ||
      (Array.isArray(raw.custom_fields) && raw.custom_fields.length) || (Array.isArray(raw.tags) && raw.tags.length)) throw new Error("Journal has unsupported currency/custom metadata; manual repair required.");
    const rows = array(raw.line_items, "repair lines"), desired = new Map<string, string>();
    for (const line of expected.lines) {
      const key = `${(await this.account(line.accountName)).id}:${line.debit === undefined ? "credit" : "debit"}:${cents(line.debit ?? line.credit!)}`;
      if (desired.has(key)) throw new Error("Ambiguous repeated journal lines require manual repair.");
      desired.set(key, line.customerId ?? "");
    }
    const lineItems = rows.map(line => {
      if (line.tax_id || line.project_id || line.location_id || (Array.isArray(line.tags) && line.tags.length)) throw new Error("Journal line has additional accounting metadata; manual repair required.");
      const key = `${line.account_id}:${line.debit_or_credit}:${cents(number(line.amount, "repair amount"))}`;
      if (!desired.has(key)) throw new Error("Repair line differs from source expectation.");
      return { line_id: string(line.line_id, "existing line id"), account_id: line.account_id,
        amount: line.amount, debit_or_credit: line.debit_or_credit, description: line.description ?? "", customer_id: desired.get(key) };
    });
    await this.request("PUT", `/journals/${encodeURIComponent(id)}`, {}, { journal_date: date(expected.date),
      notes: raw.notes ?? "", reference_number: raw.reference_number ?? "", journal_type: raw.journal_type ?? "both",
      currency_id: raw.currency_id, exchange_rate: raw.exchange_rate, line_items: lineItems });
    const after = await this.getJournalSnapshot(id);
    await this.verifyExistingJournal(expected, id);
    return after;
  }
  async checkStatementSourceForPosting(source: BankTransaction, rentalAmount: number): Promise<void> {
    const account = await this.account(source.accountName);
    const when = Date.parse(date(source.date));
    const start = new Date(when - 3 * 86400000).toISOString().slice(0, 10);
    const end = new Date(when + 3 * 86400000).toISOString().slice(0, 10);
    const rows = await this.registerActivity(account, start, end);
    for (const row of rows) {
      if (row.account_id !== account.id || date(row.date) < start || date(row.date) > end) throw new Error("Statement history returned an unexpected account or date.");
      if (row.currency_code && row.currency_code !== "USD") throw new Error("Unexpected statement history currency.");
      reportAmount(row.debit, "statement debit"); reportAmount(row.credit, "statement credit");
    }
    if (rows.some(row => cents(reportAmount(source.amount < 0 ? row.credit : row.debit, "statement activity")) === cents(rentalAmount))) throw new ExistingBankMatchError();
  }
  async matchBankTransaction(source: BankTransaction, remoteId: string, reference: string): Promise<void> {
    const current = await this.getBankTransaction(source);
    if (current.date !== source.date || cents(current.amount) !== cents(source.amount)) throw new Error("Source changed before bank matching.");
    if (current.status === "categorized") {
      if (current.reference === reference) return;
      throw new Error("Source is categorized but cannot be verified against this posting.");
    }
    if (current.description !== source.description || current.reference !== source.reference) throw new Error("Source changed before bank matching.");
    const path = `/banktransactions/uncategorized/${encodeURIComponent(source.transactionId)}/match`;
    const matches = (await this.pages(path, "matching_transactions")).filter(candidate =>
      (candidate.transaction_id === remoteId || candidate.reference_number === reference) &&
      cents(number(candidate.amount, "match amount")) === cents(Math.abs(source.amount)) &&
      candidate.debit_or_credit === (source.amount > 0 ? "debit" : "credit") &&
      ["journal", "card_payment", "transfer_fund"].includes(String(candidate.transaction_type)));
    if (matches.length !== 1) throw new Error("Could not identify one exact bank match for the saved posting.");
    const candidate = matches[0]!;
    await this.request("POST", path, {}, { transactions_to_be_matched: [{ transaction_id: string(candidate.transaction_id, "match id"), transaction_type: candidate.transaction_type }] });
  }
  private async registerActivity(account: Account, from: string, to: string): Promise<Json[]> {
    const records: Json[] = [];
    for (let page = 1; page <= 1000; page++) {
      // The path ID alone does not filter the live register; account_id is also
      // required or Zoho returns the other accounts' journal lines as well.
      const data = await this.request("GET", `/registers/${encodeURIComponent(account.id)}/transactions`, {
        account_id: account.id, filter_by: "TransactionDate.CustomDate", from_date: from, to_date: to,
        cash_based: "false", page, per_page: 200,
      });
      const context = reportContext(data, "register_transactions", from, to, true);
      const rows = registerRows(object(data.register_transactions, "register").account_transactions);
      if (context.page !== page) throw new Error("Zoho register returned an unexpected page.");
      records.push(...rows);
      if (context.has_more_page === false) return records;
      if (context.has_more_page !== true || rows.length === 0) throw new Error("Zoho register omitted complete pagination metadata.");
    }
    throw new Error("Zoho register pagination limit exceeded; no partial history was accepted.");
  }
  async getAccountBalance(name: string, asOfDate?: string): Promise<number> { return this.getLedgerBalance(name, asOfDate); }
  async listAccountActivity(name: string, fromDate: string, toDate: string): Promise<LedgerMovement[]> {
    const account = await this.account(name), from = date(fromDate), to = date(toDate);
    if (from > to) throw new Error("Register dates are reversed.");
    const rows = await this.registerActivity(account, from, to);
    return rows.map(row => {
      const when = date(row.date), debit = reportAmount(row.debit, "register debit"), credit = reportAmount(row.credit, "register credit");
      if (row.account_id !== account.id || when < from || when > to || (row.currency_code && row.currency_code !== "USD") || debit < 0 || credit < 0) throw new Error("Unexpected account, date, currency or sign in register.");
      const id = string(row.transaction_id, "register transaction id");
      return { id, date: when, amount: (cents(debit) - cents(credit)) / 100,
        description: typeof row.transaction_details === "string" ? row.transaction_details : "",
        reference: typeof row.reference_number === "string" ? row.reference_number : "",
        ...(row.transaction_type === "journal" ? { journalId: id } : {}) };
    });
  }
  async getLedgerBalance(name: string, asOfDate?: string): Promise<number> {
    if (!asOfDate) throw new Error("Historical reconciliation requires an explicit cutoff date.");
    const cutoff = date(asOfDate), account = await this.account(name);
    const data = await this.request("GET", "/reports/trialbalance", {
      filter_by: "TransactionDate.CustomDate", from_date: cutoff, to_date: cutoff,
      is_for_date_range: "false", cash_based: "false", show_rows: "all",
    });
    const context = reportContext(data, "trial_balance", cutoff, cutoff, false);
    if (context.show_rows !== "all" || context.has_more_page === true) throw new Error("Zoho trial balance is incomplete.");
    const matches = reportAccounts(data.trialbalance).filter(row => row.account_id === account.id);
    if (matches.length !== 1) throw new Error("Zoho trial balance must contain the requested account exactly once.");
    const row = matches[0]!;
    const balance = cents(reportAmount(row.net_debit_total, "ledger debit")) - cents(reportAmount(row.net_credit_total, "ledger credit"));
    const creditNormal = ["credit_card", "other_current_liability", "long_term_liability", "accounts_payable", "equity", "income", "other_income"].includes(account.type);
    return balance === 0 ? 0 : (creditNormal ? -balance : balance) / 100;
  }
  async getProfitAndLoss(fromDate: string, toDate: string): Promise<Record<string, number>> {
    const from = date(fromDate), to = date(toDate);
    if (from > to) throw new Error("Profit and loss dates are reversed.");
    const data = await this.request("GET", "/reports/profitandloss", {
      filter_by: "TransactionDate.CustomDate", from_date: from, to_date: to, cash_based: "false", show_rows: "all",
    });
    const context = reportContext(data, "profit_and_loss", from, to, true);
    if (context.show_rows !== "all" || context.has_more_page === true) throw new Error("Zoho profit and loss is incomplete.");
    const totals: Record<string, number> = {};
    const seen = new Set<string>();
    const rows = reportAccounts(data.profit_and_loss);
    if (!rows.length) throw new Error("Zoho profit and loss omitted account rows despite show_rows=all.");
    for (const row of rows) {
      const id = string(row.account_id, "P&L account id"), name = string(row.name, "P&L account name");
      if (seen.has(id) || Object.hasOwn(totals, name)) throw new Error("Zoho profit and loss contains duplicate accounts.");
      seen.add(id);
      Object.defineProperty(totals, name, { value: reportAmount(row.total, "P&L total"), enumerable: true });
    }
    return totals;
  }
}
