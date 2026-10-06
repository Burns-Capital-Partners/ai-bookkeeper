import { transactionFingerprint, type BookkeeperState } from "./db.js";
import { nonempty } from "./context.js";
import type { BankTransaction, CategorizationPattern, CompanyConfig, JournalEntry } from "./types.js";

export interface Classification {
  action: "splitExpense" | "rentalIncome" | "ownerContribution";
  accountKey?: string;
  unitId?: string;
  rentalShare?: number;
}
export function classification(value: Record<string, unknown>, config: CompanyConfig, txn: BankTransaction): Classification {
  if (txn.statement) throw new Error("Statement sources require their verified evidence packet.");
  if (!["splitExpense", "rentalIncome", "ownerContribution"].includes(String(value.action))) throw new Error("Unsupported categorization action.");
  const action = value.action as Classification["action"];
  const out: Classification = { action };
  if (action === "splitExpense") {
    if (txn.amount === 0 || ![config.accounts.tdBank, config.accounts.quicksilver].includes(txn.accountName)) throw new Error("Expense/refund classification requires a nonzero configured bank/card source.");
    out.accountKey = nonempty(value.accountKey, "accountKey", 200);
    if (!["utilities", "insurance", "propertyTaxes", "repairsMaintenance", "personalExpenses"].includes(out.accountKey) || !config.accounts[out.accountKey]) throw new Error("Choose a configured expense accountKey.");
    const share = value.rentalShare ?? config.allocation.rentalShare;
    if (typeof share !== "number" || !Number.isFinite(share) || share < 0 || share > 1) throw new Error("rentalShare must be between zero and one.");
    out.rentalShare = share;
  } else {
    if (txn.amount <= 0 || txn.accountName !== config.accounts.tdBank) throw new Error("Income and owner-funding decisions require money into the configured TD account.");
    if (action === "rentalIncome") {
      if (/\bVENMO\b/i.test(txn.description)) throw new Error("Personal Venmo rent is recorded from the tenant receipt. Categorize its bank cashout as ownerContribution.");
      out.unitId = nonempty(value.unitId, "unitId", 200);
      if (!config.units.some(u => u.id === out.unitId)) throw new Error("Rent decisions require a configured unitId.");
    }
  }
  return out;
}
export function decisionPattern(value: Classification, config: CompanyConfig, txn: BankTransaction, notes: string, learn = false): CategorizationPattern {
  const c = classification(value as unknown as Record<string, unknown>, config, txn);
  const ambiguous = /\bVENMO\b|\bATM\b|CASH (WITHDRAWAL|WD)/i.test(txn.description) || !txn.description.trim();
  return { action: c.action, account: c.accountKey ? config.accounts[c.accountKey] : undefined,
    unit: c.unitId, rentalShare: c.rentalShare, notes,
    match: { account: txn.accountName, direction: txn.amount > 0 ? "credit" : "debit",
      descriptionEquals: txn.description.trim().replace(/\s+/g, " "),
      ...(learn && !ambiguous ? {} : { transactionId: txn.transactionId, fingerprint: transactionFingerprint(txn) }) } };
}
export function clearClassificationFlags(config: CompanyConfig, state: BookkeeperState, txn: BankTransaction, note: string): void {
  for (const flag of state.getOpenFlagsForTransaction(txn.transactionId)) {
    if (flag.companyName === config.company.name && ["uncategorized", "venmo-ask", "cash-withdrawal"].includes(flag.type)) state.resolveFlagAndRequeue(flag.id, note);
  }
}

export function classificationJournal(value: Classification, config: CompanyConfig, txn: BankTransaction): JournalEntry {
  const c = classification(value as unknown as Record<string, unknown>, config, txn), amount = Math.abs(txn.amount);
  const entry: JournalEntry = { date: txn.date, notes: "Owner-confirmed classification", lines: [] };
  if (c.action === "splitExpense") {
    if (c.accountKey === "personalExpenses") {
      entry.lines = txn.amount < 0 ? [{ accountName: config.accounts.personalExpenses!, debit: amount },
        { accountName: txn.accountName, credit: amount }] : [{ accountName: txn.accountName, debit: amount },
        { accountName: config.accounts.personalExpenses!, credit: amount }];
      return entry;
    }
    const rental = Math.round(amount * c.rentalShare! * 100) / 100, personal = Math.round((amount - rental) * 100) / 100;
    entry.lines = txn.amount < 0 ? [{ accountName: config.accounts[c.accountKey!]!, debit: rental },
      { accountName: config.accounts.ownerDraws!, debit: personal }, { accountName: txn.accountName, credit: amount }] :
      [{ accountName: txn.accountName, debit: amount }, { accountName: config.accounts[c.accountKey!]!, credit: rental }, { accountName: config.accounts.ownerDraws!, credit: personal }];
  } else {
    const customerId = c.action === "rentalIncome" ? config.units.find(u => u.id === c.unitId)?.customerId : undefined;
    entry.lines = [{ accountName: txn.accountName, debit: amount, ...(customerId ? { customerId } : {}) },
      { accountName: c.action === "rentalIncome" ? config.accounts.rentalIncome! : config.accounts.ownerContributions!, credit: amount, ...(customerId ? { customerId } : {}) }];
  }
  entry.lines = entry.lines.filter(l => (l.debit ?? l.credit) !== 0);
  return entry;
}
