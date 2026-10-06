import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BookkeeperState } from "../src/db.js";
import { classificationJournal } from "../src/decisions.js";
import { categorizeTransactions } from "../src/categorizer.js";
import type { BankTransaction, CompanyConfig, JournalEntry } from "../src/types.js";
import type { ZohoBooksClient } from "../src/zoho.js";

const template = JSON.parse(readFileSync("config/example-property.json", "utf8")) as CompanyConfig;
test("personal purchases and refunds use only the personal expense account and their bank/card", async () => {
  for (const accountName of [template.accounts.tdBank!, template.accounts.quicksilver!]) {
    for (const amount of [-42.00, 42.00]) for (const rentalShare of [undefined, 0, 0.506, 1]) {
      const config = structuredClone(template), state = new BookkeeperState(":memory:");
      try {
        const source: BankTransaction = { transactionId: "personal", accountName, amount, date: "2026-09-10",
          description: "PERSONAL ONLY VENDOR", status: "uncategorized" };
        const expected = amount < 0 ? [{ accountName: config.accounts.personalExpenses!, debit: 42.00 }, { accountName, credit: 42.00 }] :
          [{ accountName, debit: 42.00 }, { accountName: config.accounts.personalExpenses!, credit: 42.00 }];
        assert.deepEqual(classificationJournal({ action: "splitExpense", accountKey: "personalExpenses", rentalShare }, config, source).lines, expected);
        config.categorizationPatterns = [{ action: "splitExpense", account: config.accounts.personalExpenses, rentalShare,
          match: { descriptionEquals: source.description, account: accountName }, notes: "Owner confirmed this vendor is wholly personal." }];
        const journals: JournalEntry[] = [];
        const api = { listBankTransactions: async () => [source], getBankTransaction: async () => source,
          checkSourceForPosting: async () => {}, matchBankTransaction: async () => {},
          createJournal: async (entry: JournalEntry) => { journals.push(entry); return "personal-journal"; } } as unknown as ZohoBooksClient;
        await categorizeTransactions(config, api, state);
        assert.equal(journals.length, 1);
        assert.deepEqual(journals[0]!.lines, expected);
        await categorizeTransactions(config, api, state);
        assert.equal(journals.length, 1, "Rerun must not post the personal charge/refund twice.");
      } finally { state.close(); }
    }
  }
});
test("legitimate shared costs retain the approved rental and Owner Draws allocation", () => {
  for (const amount of [-100.01, 100.01]) {
    const source: BankTransaction = { transactionId: "shared", accountName: template.accounts.tdBank!, amount,
      date: "2026-09-10", description: "EXAMPLE UTILITY", status: "uncategorized" };
    const lines = classificationJournal({ action: "splitExpense", accountKey: "utilities" }, template, source).lines;
    const direction = amount < 0 ? "debit" : "credit";
    assert.equal(lines.find(l => l.accountName === template.accounts.utilities)?.[direction], 50.61);
    assert.equal(lines.find(l => l.accountName === template.accounts.ownerDraws)?.[direction], 49.40);
    assert.equal(lines.some(l => l.accountName === template.accounts.personalExpenses), false);
  }
});
