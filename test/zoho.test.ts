import test from "node:test";
import assert from "node:assert/strict";
import { ExistingBankMatchError, ZohoBooksClient } from "../src/zoho.js";
import type { BankTransaction, JournalEntry } from "../src/types.js";

const accounts = [
  { account_id: "1", account_name: "Operating Checking", account_type: "bank" },
  { account_id: "2", account_name: "Property Card", account_type: "credit_card" },
  { account_id: "3", account_name: "Rental Income", account_type: "income" },
  { account_id: "4", account_name: "Mortgage Payable", account_type: "long_term_liability" },
  { account_id: "5", account_name: "Owner Draws", account_type: "equity" },
];
const source: BankTransaction = { transactionId: "feed-1", accountId: "1", accountName: "Operating Checking",
  amount: 2000, description: "RENT", date: "2026-09-01", status: "uncategorized", reference: "bank-reference" };
const row = { transaction_id: source.transactionId, account_id: "1", amount: 2000, description: "RENT",
  date: source.date, status: "uncategorized", debit_or_credit: "debit", reference_number: source.reference };
const journal: JournalEntry = { date: source.date, referenceNumber: "bk-test", notes: "Rent",
  lines: [{ accountName: "Operating Checking", debit: 2000 }, { accountName: "Rental Income", credit: 2000, customerId: "tenant-1" }] };
type Call = { url: URL; method: string; body?: Record<string, unknown> };
const ok = (data: object) => new Response(JSON.stringify({ code: 0, ...data }), { status: 200 });
const page = (key: string, data: unknown[], more = false) => ok({ [key]: data, page_context: { has_more_page: more } });
const reportMeta = (type: string, from: string, to: string, range = true) => ({
  report_type: type, report_basis: "Accrual", applied_filter: "TransactionDate.CustomDate",
  ...(range ? { from_date: from } : { as_of_date: to }), to_date: to,
  is_for_date_range: String(range), cash_based: "false", show_rows: "all",
});
const trial = (rows: object[], context: object = {}) => ok({ trialbalance: [{ name: "Total", account_transactions: [
  { name: "Group", account_transactions: rows },
] }], page_context: { ...reportMeta("trial_balance", "2026-09-30", "2026-09-30", false), ...context } });
const register = (rows: object[], context: object = {}) => ok({
  register_transactions: { account_transactions: [{ account_transactions: rows }] },
  page_context: { ...reportMeta("register_transactions", "2026-08-29", "2026-09-04"), page: 1, has_more_page: false, ...context },
});
function fixture(handle: (call: Call) => Response | Promise<Response>, live = true) {
  const calls: Call[] = [];
  const fetcher = (async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    const call: Call = { url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (url.hostname === "accounts.zoho.com") return ok({ access_token: "test-token", expires_in: 3600, api_domain: "https://www.zohoapis.com" });
    assert.equal(url.searchParams.get("organization_id"), "999000001");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Zoho-oauthtoken test-token");
    if (url.pathname.endsWith("/chartofaccounts")) return page("chartofaccounts", accounts);
    return handle(call);
  }) as typeof fetch;
  return { calls, client: new ZohoBooksClient("999000001", { clientId: "test-id", clientSecret: "test-secret", refreshToken: "test-refresh",
    writeEnabled: live, bankAccounts: ["Operating Checking", "Property Card"], fetch: fetcher }) };
}

test("OAuth refresh is shared across concurrent reads and reused", async () => {
  const f = fixture(() => { throw new Error("Unexpected API request"); });
  assert.deepEqual(await Promise.all([f.client.getAccessToken(), f.client.getAccessToken()]), ["test-token", "test-token"]);
  await f.client.getAccessToken(); assert.equal(f.calls.length, 1);
});

test("bank feed exhausts pages, maps ledger signs, and excludes existing entries", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.searchParams.get("filter_by"), "Status.Uncategorized");
    if (url.searchParams.get("account_id") === "2") return page("banktransactions", [{ ...row, transaction_id: "card-charge", account_id: "2", amount: 30, debit_or_credit: "credit" }]);
    return url.searchParams.get("page") === "1" ? page("banktransactions", [row], true) :
      page("banktransactions", [{ ...row, transaction_id: "already-recorded", status: "categorized" }]);
  });
  const items = await f.client.listBankTransactions({ uncategorizedOnly: true });
  assert.deepEqual(items.map(t => [t.transactionId, t.amount]), [["feed-1", 2000], ["card-charge", -30]]);
});

test("missing pagination metadata and foreign accounts fail closed", async () => {
  const f = fixture(() => ok({ banktransactions: [row] }));
  await assert.rejects(f.client.listBankTransactions(), /pagination metadata/);
  const other = fixture(() => page("banktransactions", [{ ...row, account_id: "999" }]));
  await assert.rejects(other.client.listBankTransactions(), /another account/);
});
test("a month-scoped feed excludes other months even when Zoho ignores date filters", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.searchParams.get("date_start"), "2026-09-01");
    assert.equal(url.searchParams.get("date_end"), "2026-09-30");
    return url.searchParams.get("page") === "1" ? page("banktransactions", [
      { ...row, transaction_id: "august", date: "2026-08-31" },
      { ...row, transaction_id: "september-first", date: "2026-09-01" },
    ], true) : page("banktransactions", [
      { ...row, transaction_id: "september-last", date: "2026-09-30" },
      { ...row, transaction_id: "october", date: "2026-10-01" },
    ]);
  }, false);
  const items = await f.client.listBankTransactions({ accountName: "Operating Checking", fromDate: "2026-09-01", toDate: "2026-09-30", uncategorizedOnly: true });
  assert.deepEqual(items.map(t => t.transactionId), ["september-first", "september-last"]);
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith("/banktransactions")).length, 2);
});
test("invalid or reversed feed cutoffs fail before any provider request", async () => {
  const f = fixture(() => { throw new Error("Unexpected API request"); }, false);
  await assert.rejects(f.client.listBankTransactions({ fromDate: "2026-09-31" }), /Invalid Zoho date/);
  await assert.rejects(f.client.listBankTransactions({ fromDate: "2026-10-01", toDate: "2026-09-30" }), /dates are reversed/);
  assert.equal(f.calls.length, 0);
});
test("out-of-period feed rows still fail closed for a foreign account", async () => {
  const f = fixture(() => page("banktransactions", [{ ...row, account_id: "999", date: "2026-08-31" }]), false);
  await assert.rejects(f.client.listBankTransactions({ accountName: "Operating Checking", fromDate: "2026-09-01", toDate: "2026-09-30" }), /another account/);
});
test("metadata repair preserves line identity and monetary fields and rereads the published result", async () => {
  let raw = { status: "published", journal_date: source.date, notes: "Keep note", reference_number: "keep-ref", currency_code: "USD", currency_id: "usd", exchange_rate: 1,
    line_items: [{ line_id: "bank-line", account_id: "1", amount: 2000, debit_or_credit: "debit", description: "Keep bank detail", customer_id: "" },
      { line_id: "income-line", account_id: "3", amount: 2000, debit_or_credit: "credit", description: "Keep income detail", customer_id: "" }] };
  const f = fixture(({ method, body, url }) => {
    assert.equal(url.pathname, "/books/v3/journals/journal-1");
    if (method === "PUT") {
      assert.equal(body!.notes, raw.notes); assert.equal(body!.reference_number, raw.reference_number);
      assert.deepEqual((body!.line_items as typeof raw.line_items).map(l => [l.line_id, l.account_id, l.amount, l.debit_or_credit, l.description]), raw.line_items.map(l => [l.line_id, l.account_id, l.amount, l.debit_or_credit, l.description]));
      raw = { ...raw, journal_date: body!.journal_date as string, line_items: body!.line_items as typeof raw.line_items };
    }
    return ok({ journal: raw });
  });
  const before = await f.client.getJournalSnapshot("journal-1"), expected = structuredClone(before);
  expected.date = "2026-09-02"; expected.lines[1]!.customerId = "tenant-1";
  const after = await f.client.repairJournalMetadata("journal-1", before, expected);
  assert.equal(after.date, expected.date); assert.equal(after.lines[1]!.customerId, "tenant-1");
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 1);
  const changed = structuredClone(expected); changed.lines[0]!.debit = 2001;
  await assert.rejects(f.client.repairJournalMetadata("journal-1", after, changed), /cannot change/);
  await assert.rejects(f.client.repairJournalMetadata("journal-1", before, expected), /changed after/);
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 1);
});
test("an ambiguous metadata edit response never repeats the PUT", async () => {
  const raw = { status: "published", journal_date: source.date, notes: "", reference_number: "", currency_code: "USD", line_items: [
    { line_id: "a", account_id: "1", amount: 2000, debit_or_credit: "debit" }, { line_id: "b", account_id: "3", amount: 2000, debit_or_credit: "credit" }] };
  const f = fixture(({ method }) => method === "PUT" ? new Response("unavailable", { status: 503 }) : ok({ journal: raw }));
  const before = await f.client.getJournalSnapshot("journal-1");
  await assert.rejects(f.client.repairJournalMetadata("journal-1", before, { ...before, date: "2026-09-02" }));
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 1);
});

test("feed recheck uses uncategorized list IDs and never the book-entry detail endpoint", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.pathname, "/books/v3/banktransactions");
    assert.equal(url.searchParams.get("filter_by"), "Status.Uncategorized");
    return url.searchParams.get("page") === "1" ? page("banktransactions", [{ ...row, transaction_id: "different" }], true) : page("banktransactions", [row]);
  }, false);
  assert.deepEqual(await f.client.getBankTransaction(source), source);
});

test("a disappeared feed needs an explicit source link, not a similar manual entry", async () => {
  for (const linked of [true, false]) {
    const f = fixture(({ url }) => url.searchParams.get("filter_by") === "Status.Uncategorized" ? page("banktransactions", []) :
      page("banktransactions", [{ ...row, transaction_id: "journal-1", imported_transaction_id: linked ? source.transactionId : "", status: linked ? "matched" : "manually_added", reference_number: journal.referenceNumber }]));
    if (linked) {
      assert.equal((await f.client.getBankTransaction(source)).status, "categorized");
      await f.client.matchBankTransaction(source, "journal-1", journal.referenceNumber!);
    } else await assert.rejects(f.client.getBankTransaction(source), /missing or.*ambiguous/);
    assert.equal(f.calls.filter(c => c.method === "POST" && c.url.hostname !== "accounts.zoho.com").length, 0);
  }
});

test("bank duplicate preflight finds a matching entry beyond the first candidate page", async () => {
  const f = fixture(({ url }) => {
    if (url.pathname.endsWith("/banktransactions")) return page("banktransactions", [row]);
    return url.searchParams.get("page") === "1" ? page("matching_transactions", [{ amount: 30, debit_or_credit: "debit" }], true) :
      page("matching_transactions", [{ transaction_id: "existing", amount: 2000, debit_or_credit: "debit" }]);
  }, false);
  await assert.rejects(f.client.checkSourceForPosting(source), ExistingBankMatchError);
});

test("historical balances use native as-of trial balance, explicit custom filter and account IDs", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.pathname, "/books/v3/reports/trialbalance");
    assert.equal(url.searchParams.get("filter_by"), "TransactionDate.CustomDate");
    assert.equal(url.searchParams.get("from_date"), "2026-09-30");
    assert.equal(url.searchParams.get("to_date"), "2026-09-30");
    assert.equal(url.searchParams.get("is_for_date_range"), "false");
    assert.equal(url.searchParams.get("show_rows"), "all");
    assert.equal(url.searchParams.get("cash_based"), "false");
    return trial([
      { account_id: "4", name: "Mortgage Payable", net_debit_total: "", net_credit_total: 900 },
      { account_id: "1", name: "Renamed bank in report", net_debit_total: "", net_credit_total: "100.25" },
      { account_id: "2", name: "Property Card", net_debit_total: "", net_credit_total: 0 },
    ]);
  }, false);
  assert.equal(await f.client.getLedgerBalance("Mortgage Payable", "2026-09-30"), 900);
  assert.equal(await f.client.getAccountBalance("Operating Checking", "2026-09-30"), -100.25);
  assert.equal(await f.client.getLedgerBalance("Property Card", "2026-09-30"), 0);
  await assert.rejects(f.client.getAccountBalance("Operating Checking"), /cutoff/);
});

test("historical reports reject default Today even when requested dates are echoed", async () => {
  for (const context of [
    { applied_filter: "TransactionDate.Today" }, { as_of_date: "2026-10-01" },
    { is_for_date_range: "true" }, { cash_based: "true" }, { report_basis: "Cash" },
    { is_inv_txn_job_in_progress: true }, { is_comparision_report: true },
    { show_rows: "non_zero" }, { has_more_page: true },
  ]) {
    const f = fixture(() => trial([{ account_id: "1", net_debit_total: 10, net_credit_total: "" }], context));
    await assert.rejects(f.client.getLedgerBalance("Operating Checking", "2026-09-30"), /cutoff|incomplete/);
  }
});

test("missing, duplicate and malformed trial balance accounts cannot become zero", async () => {
  for (const rows of [[], [{ account_id: "1", net_debit_total: 10 }],
    [{ account_id: "1", net_debit_total: "NaN", net_credit_total: 0 }],
    [1, 2].map(() => ({ account_id: "1", net_debit_total: 10, net_credit_total: 0 })),
  ]) {
    const f = fixture(() => trial(rows));
    await assert.rejects(f.client.getLedgerBalance("Operating Checking", "2026-09-30"), /exactly once|Invalid Zoho/);
  }
});

test("native accrual P&L returns account totals without counting group totals", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.pathname, "/books/v3/reports/profitandloss");
    assert.equal(url.searchParams.get("filter_by"), "TransactionDate.CustomDate");
    assert.equal(url.searchParams.get("from_date"), "2025-01-01");
    assert.equal(url.searchParams.get("to_date"), "2025-12-31");
    return ok({ profit_and_loss: [
      { name: "Gross Profit", total: 3000, account_transactions: [{ name: "Operating Income", total: 3000,
        account_transactions: [{ account_id: "3", name: "Rental Income", total: 3000 }] }] },
      { name: "Operating Expense", total: 50, account_transactions: [{ account_id: "6", name: "Repairs", total: "50.00" }] },
      { name: "Net Profit/Loss", total: 2950 },
    ], page_context: reportMeta("profit_and_loss", "2025-01-01", "2025-12-31") });
  }, false);
  assert.deepEqual(await f.client.getProfitAndLoss("2025-01-01", "2025-12-31"), { "Rental Income": 3000, Repairs: 50 });
  await assert.rejects(f.client.getProfitAndLoss("2025-12-31", "2025-01-01"), /reversed/);
});

test("P&L rejects wrong dates, duplicate accounts and missing amounts", async () => {
  const income = { account_id: "3", name: "Rental Income", total: 10 };
  for (const [rows, context] of [
    [[income], { from_date: "2026-01-01" }], [[income], { applied_filter: "TransactionDate.Today" }],
    [[income, income], {}], [[{ ...income, total: undefined }], {}], [[], {}],
  ] as [object[], object][]) {
    const f = fixture(() => ok({ profit_and_loss: rows,
      page_context: { ...reportMeta("profit_and_loss", "2025-01-01", "2025-12-31"), ...context } }));
    await assert.rejects(f.client.getProfitAndLoss("2025-01-01", "2025-12-31"), /cutoff|duplicate|Invalid Zoho|omitted account/);
  }
});

test("journal uses account IDs, preserves customer, publishes and verifies reference", async () => {
  const f = fixture(({ url, method, body }) => {
    if (url.pathname.endsWith("/banktransactions")) return page("banktransactions", [row]);
    if (url.pathname.endsWith("/journals") && method === "POST") {
      assert.equal(body?.reference_number, "bk-test");
      assert.deepEqual(body?.line_items, [
        { account_id: "1", amount: 2000, debit_or_credit: "debit" },
        { account_id: "3", amount: 2000, debit_or_credit: "credit", customer_id: "tenant-1" },
      ]);
      return ok({ journal: { journal_id: "j1", status: "draft" } });
    }
    if (url.pathname.endsWith("/status/publish")) return ok({});
    return ok({ journal: { journal_id: "j1", status: "published", reference_number: "bk-test", journal_date: source.date,
      line_items: [{ account_id: "1", amount: 2000, debit_or_credit: "debit" }, { account_id: "3", amount: 2000, debit_or_credit: "credit", customer_id: "tenant-1" }] } });
  });
  assert.equal(await f.client.createJournal(journal, source), "j1");
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url.hostname !== "accounts.zoho.com").length, 2);
});

test("unbalanced, disabled, or changed-source journals never reach create endpoint", async () => {
  const f = fixture(() => page("banktransactions", [{ ...row, amount: 1999 }]));
  await assert.rejects(f.client.createJournal({ ...journal, lines: [{ accountName: "Operating Checking", debit: 1 }] }), /balanced/);
  await assert.rejects(f.client.createJournal(journal, source), /Source changed|source changed/);
  const disabled = fixture(() => page("banktransactions", [row]), false);
  await assert.rejects(disabled.client.createJournal(journal, source), /disabled/);
  assert.equal([...f.calls, ...disabled.calls].filter(c => c.method === "POST" && c.url.pathname.endsWith("/journals")).length, 0);
});

test("possible existing manual posting blocks a new posting before a claim", async () => {
  const f = fixture(({ url }) => url.pathname.endsWith("/match") ? page("matching_transactions", [
    { transaction_id: "manual-existing", amount: 2000, debit_or_credit: "debit", transaction_type: "journal" },
  ]) : page("banktransactions", [row]));
  await assert.rejects(f.client.checkSourceForPosting(source), ExistingBankMatchError);
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url.hostname !== "accounts.zoho.com").length, 0);
});

test("card payment uses banktransactions and never a fictitious banktransfers endpoint", async () => {
  const f = fixture(({ url, body }) => {
    assert.equal(url.pathname, "/books/v3/banktransactions");
    assert.equal(body?.transaction_type, "card_payment");
    assert.equal(body?.from_account_id, "1"); assert.equal(body?.to_account_id, "2");
    return ok({ banktransaction: { transaction_id: "transfer-1" } });
  });
  assert.equal(await f.client.createTransfer({ fromAccount: "Operating Checking", toAccount: "Property Card", amount: 30, date: "2026-09-01", referenceNumber: "bk-transfer" }), "transfer-1");
});

test("ambiguous POST failure is never retried", async () => {
  let posts = 0;
  const f = fixture(({ method }) => { if (method === "POST") posts++; throw new Error("Socket closed after commit"); });
  await assert.rejects(f.client.createJournal(journal), /verify any write/);
  assert.equal(posts, 1);
});

test("read failures retry without duplicating a write", async () => {
  let reads = 0;
  const f = fixture(() => ++reads === 1 ? new Response("temporary", { status: 503 }) : page("banktransactions", []));
  assert.deepEqual(await f.client.listBankTransactions({ accountName: "Operating Checking" }), []);
  assert.equal(reads, 2);
});

test("matching uses the saved remote entry without choosing an unrelated candidate", async () => {
  let matched = false;
  const f = fixture(({ url, method, body }) => {
    if (!url.pathname.endsWith("/match")) return page("banktransactions", [row]);
    if (method === "POST") { matched = true; assert.deepEqual(body, { transactions_to_be_matched: [{ transaction_id: "j1", transaction_type: "journal" }] }); return ok({}); }
    return page("matching_transactions", [
      { transaction_id: "j1", transaction_type: "journal", amount: 2000, debit_or_credit: "debit", reference_number: "bk-test" },
      { transaction_id: "other", transaction_type: "journal", amount: 2000, debit_or_credit: "debit", reference_number: "manual" },
    ]);
  });
  await f.client.matchBankTransaction(source, "j1", "bk-test"); assert.ok(matched);
});
test("ambiguous bank matching never submits a match", async () => {
  const f = fixture(({ url }) => url.pathname.endsWith("/match") ? page("matching_transactions", ["j1", "j2"].map(id => ({
    transaction_id: id, transaction_type: "journal", amount: 2000, debit_or_credit: "debit", reference_number: "bk-test",
  }))) : page("banktransactions", [row]));
  await assert.rejects(f.client.matchBankTransaction(source, "j1", "bk-test"), /one exact/);
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url.pathname.endsWith("/match")).length, 0);
});
test("existing journal verification compares actual lines and never writes", async () => {
  const f = fixture(() => ok({ journal: { journal_date: source.date, status: "published", line_items: [
    { account_id: "1", amount: 2000, debit_or_credit: "debit" }, { account_id: "3", amount: 2000, debit_or_credit: "credit", customer_id: "tenant-1" },
  ] } }));
  assert.equal(await f.client.verifyExistingJournal(journal, "12345"), "12345");
  await assert.rejects(f.client.verifyExistingJournal({ ...journal, date: "2026-09-02" }, "12345"), /does not match/);
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url.hostname !== "accounts.zoho.com").length, 0);
});
test("personal Venmo receipt checks for an existing owner-draw debit before posting", async () => {
  const f = fixture(({ url }) => {
    assert.equal(url.pathname, "/books/v3/registers/5/transactions");
    assert.equal(url.searchParams.get("account_id"), "5");
    assert.equal(url.searchParams.get("filter_by"), "TransactionDate.CustomDate");
    assert.equal(url.searchParams.get("from_date"), "2026-08-29");
    assert.equal(url.searchParams.get("to_date"), "2026-09-04");
    return register([{ account_id: "5", date: "2026-09-01", debit: 1000, credit: "", currency_code: "USD" }]);
  }, false);
  await assert.rejects(f.client.checkStatementSourceForPosting({ ...source, accountName: "Owner Draws", amount: 1000 }, 1000), ExistingBankMatchError);
  assert.equal(f.calls.filter(c => c.method === "POST" && c.url.hostname !== "accounts.zoho.com").length, 0);
});

test("statement preflight exhausts nested register pages including debit and credit matches", async () => {
  for (const direction of [1, -1]) {
    const f = fixture(({ url }) => url.searchParams.get("page") === "1" ?
      register([{ account_id: "5", date: source.date, debit: 30, credit: "" }], { has_more_page: true }) :
      register([{ account_id: "5", date: source.date, debit: direction > 0 ? 1000 : "", credit: direction < 0 ? 1000 : "" }], { page: 2 }));
    await assert.rejects(f.client.checkStatementSourceForPosting({ ...source, accountName: "Owner Draws", amount: direction * 1000 }, 1000), ExistingBankMatchError);
  }
});

test("statement preflight rejects incomplete or foreign register data and permits complete empty history", async () => {
  const activity = { account_id: "5", date: source.date, debit: 25, credit: "" };
  for (const [rows, context] of [
    [[activity], { has_more_page: undefined }], [[], { has_more_page: true }], [[activity], { page: 2 }],
    [[activity], { applied_filter: "TransactionDate.Today" }],
    [[{ ...activity, account_id: "1" }], {}], [[{ ...activity, account_id: undefined }], {}],
    [[{ ...activity, date: "2026-09-06" }], {}], [[{ ...activity, credit: undefined }], {}],
  ] as [object[], object][]) {
    const f = fixture(() => register(rows, context));
    await assert.rejects(f.client.checkStatementSourceForPosting({ ...source, accountName: "Owner Draws" }, 1000), /pagination|page|cutoff|unexpected|Invalid Zoho/);
  }
  const f = fixture(() => register([]), false);
  await f.client.checkStatementSourceForPosting({ ...source, accountName: "Owner Draws" }, 1000);
});
