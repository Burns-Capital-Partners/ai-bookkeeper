/**
 * Categorizer: matches uncategorized bank transactions against the
 * company config's categorization patterns and takes the configured action.
 *
 * Actions it can take:
 *  - mortgageSplitJournal: build the mortgage journal from actual statement
 *    principal, interest and escrow, using the configured allocation
 *  - splitExpense: debit expense account (rental share), debit Owner Draws
 *    (personal share), credit the bank account
 *  - escrowDisbursement: debit expense, credit Mortgage Escrow
 *  - rentalIncome: credit Rental Income, debit the bank account
 *  - interAccountTransfer: record a bank-to-bank transfer
 *  - flagForHuman: raise a flag and skip (never auto-categorize)
 *
 * Amount-threshold and receipt flags are raised here too, since they are
 * evaluated per transaction.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  requiredAccount,
  type BankTransaction,
  type CategorizationPattern,
  type CompanyConfig,
  type Flag,
  type JournalEntry,
} from "./types.js";
import { ExistingBankMatchError, type ZohoBooksClient } from "./zoho.js";
import { transactionFingerprint, type BookkeeperState } from "./db.js";
import { mortgagePaymentFor, type MortgagePayment } from "./handoff.js";
import { provisionalPatterns } from "./reviews.js";

export interface CategorizeResult {
  processed: number;
  journalsCreated: string[];
  transfersCreated: string[];
  flagsRaised: Flag[];
  skipped: string[]; // transaction IDs skipped (already processed)
  pending: string[]; // unposted transactions still requiring action
}

export async function categorizeTransactions(
  config: CompanyConfig,
  zoho: ZohoBooksClient,
  state: BookkeeperState,
  opts?: { fromDate?: string; toDate?: string }
): Promise<CategorizeResult> {
  const provisional = provisionalPatterns(config, state);
  config = { ...config, categorizationPatterns: [...state.getLearnedRules(config.company.name), ...provisional, ...config.categorizationPatterns] };
  const result: CategorizeResult = {
    processed: 0,
    journalsCreated: [],
    transfersCreated: [],
    flagsRaised: [],
    skipped: [],
    pending: [],
  };
  for (const pending of state.pendingBankMatches(config.company.name)) {
    if ((opts?.fromDate && pending.source.date < opts.fromDate) || (opts?.toDate && pending.source.date > opts.toDate)) continue;
    await matchPostedSource(config, zoho, state, pending.source, pending.remoteId, pending.reference, result);
  }

  // An owner may resolve an exception directly in Zoho. Preserve that work,
  // including when the source consequently disappears from the uncategorized list.
  const reviewed = new Set<string>();
  for (const flag of state.getOpenFlags(config.company.name)) {
    const id = flag.transactionId;
    if (!id || reviewed.has(id) || state.getPosting(config.company.name, id) || state.isProcessed(id)) continue;
    reviewed.add(id);
    const observed = state.getObservation(config.company.name, id);
    if (!observed) continue;
    const source = JSON.parse(observed.transaction_json) as BankTransaction;
    if (source.statement) continue;
    if ((opts?.fromDate && source.date < opts.fromDate) || (opts?.toDate && source.date > opts.toDate)) continue;
    try {
      if ((await zoho.getBankTransaction(source)).status !== "categorized") continue;
    } catch {
      raiseFlag(config, state, result, { transactionId: id, key: `source-read:${id}`, type: "worker-error", severity: "warning",
        title: "Source transaction could not be reread", detail: "This source remains pending; independent transactions continue and the source read will retry next run." });
      continue;
    }
    state.markProcessed(id, config.company.name, "recorded-externally");
    for (const issue of state.getOpenFlagsForTransaction(id)) {
      if (issue.companyName === config.company.name && issue.severity !== "info") state.updateFlag(issue.id, {
        status: "resolved", notes: "Source is now categorized in Zoho. Preserved the existing entry without creating a posting.",
      });
    }
  }

  const txns = [...await zoho.listBankTransactions({
    fromDate: opts?.fromDate,
    toDate: opts?.toDate,
    uncategorizedOnly: true,
  }), ...state.getStatementTransactions().filter(t => (!opts?.fromDate || t.date >= opts.fromDate) && (!opts?.toDate || t.date <= opts.toDate))];

  // Process source-side transfer debits before counterparts in the same feed batch.
  const ordered = [...txns].sort((a, b) => Number(isTransferSource(config, b)) - Number(isTransferSource(config, a)));
  for (const txn of ordered) {
    try {
    state.resolveIssue(config.company.name, `source-read:${txn.transactionId}`);
    if (txn.status !== "uncategorized") {
      result.skipped.push(txn.transactionId);
      continue;
    }
    if (!Number.isFinite(txn.amount) || txn.amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
      throw new Error(`Invalid amount or date for transaction ${txn.transactionId}.`);
    }
    const attempt = state.getPosting(config.company.name, txn.transactionId);
    if (attempt?.status === "posted" && attempt.fingerprint !== transactionFingerprint(txn)) {
      raiseFlag(config, state, result, {
        transactionId: txn.transactionId, fingerprint: transactionFingerprint(txn),
        type: "posted-source-changed", severity: "blocking",
        title: "Source transaction changed after posting",
        detail: `The current source differs from the snapshot used for ${attempt.reference} (${attempt.remoteId}). Review and correct the existing Zoho entry; no replacement was posted.`,
        amount: Math.abs(txn.amount),
      });
      result.pending.push(txn.transactionId);
      continue;
    }
    if (state.isProcessed(txn.transactionId)) {
      result.skipped.push(txn.transactionId);
      continue;
    }
    state.observeTransaction(config.company.name, txn);
    if (attempt?.status === "posted") {
      state.markProcessed(txn.transactionId, config.company.name, attempt.action, attempt.remoteId);
      result.skipped.push(txn.transactionId);
      continue;
    }
    if (attempt && ["pending", "uncertain"].includes(attempt.status)) {
      raiseUncertainFlag(config, state, result, txn, attempt.reference);
      result.pending.push(txn.transactionId);
      continue;
    }
    let pattern: CategorizationPattern | undefined = txn.statement ? txn.statement.kind === "escrow" ? {
      action: "escrowDisbursement", account: txn.statement.expenseAccount, match: { transactionId: txn.transactionId }, notes: txn.statement.document,
    } : { action: "rentalIncome", unit: txn.statement.unitId, expectedAmount: config.units.find(u => u.id === txn.statement!.unitId)?.monthlyRent,
      match: { transactionId: txn.transactionId }, notes: txn.statement.document } : findPattern(config.categorizationPatterns, txn);
    if (!txn.statement && /\bVENMO\b/i.test(txn.description) && pattern?.action === "rentalIncome") {
      raiseFlag(config, state, result, { transactionId: txn.transactionId, type: "venmo-ask", severity: "warning",
        title: "Venmo cashout must not duplicate tenant rent", detail: "Rent is recognized from the personal Venmo tenant receipt. Identify this cashout as owner funding rather than posting rental income twice." });
      result.pending.push(txn.transactionId); continue;
    }
    const mortgagePayment = pattern?.action === "mortgageSplitJournal" ? mortgagePaymentFor(config, state, txn) : undefined;
    if (mortgagePayment) pattern = { ...pattern!, expectedAmount: mortgagePayment.amount };
    // Counterparts only match an existing posting. They never cause a second external write.
    if (pattern?.action === "interAccountTransfer" && !isTransferSource(config, txn)) {
      await applyPattern(config, zoho, state, txn, pattern, result);
      if (!state.isProcessed(txn.transactionId)) result.pending.push(txn.transactionId);
      continue;
    }
    const expected = pattern?.expectedAmount;
    const recurringMatch = pattern && expected !== undefined && Number.isFinite(expected) && expected > 0 &&
      ["mortgageSplitJournal", "rentalIncome", "interAccountTransfer"].includes(pattern.action) &&
      Math.round(Math.abs(txn.amount) * 100) === Math.round(expected * 100) &&
      (pattern.action === "rentalIncome" ? txn.amount > 0 : txn.amount < 0);
    for (const flag of state.getOpenFlagsForTransaction(txn.transactionId)) {
      if (flag.companyName === config.company.name && ((recurringMatch && flag.type === "amount-threshold") ||
          (mortgagePayment && flag.type === "checklist-blocked" && flag.title.startsWith("Mortgage split failed")))) {
        state.updateFlag(flag.id, { status: "resolved", notes: "Verified statement evidence now supports the configured recurring payment." });
      }
    }
    if (state.getOpenFlagsForTransaction(txn.transactionId).some((f) => f.companyName === config.company.name && f.severity !== "info")) {
      result.skipped.push(txn.transactionId);
      result.pending.push(txn.transactionId);
      continue;
    }
    if (!txn.statement?.existingJournalId && !recurringMatch && !state.isApproved(config.company.name, txn, "amount-threshold") && raiseAmountFlagIfNeeded(config, txn, result, state)) {
      result.processed += 1;
      result.pending.push(txn.transactionId);
      continue;
    }
    const duplicates = config.flagRules.duplicates ? state.findDuplicates(config.company.name, txn) : [];
    if (!txn.statement?.existingJournalId && duplicates.length && !state.isApproved(config.company.name, txn, "duplicate")) {
      raiseFlag(config, state, result, {
        transactionId: txn.transactionId, type: "duplicate", severity: "warning",
        title: `Possible duplicate: ${truncate(txn.description, 60)}`,
        detail: `Same account, signed amount and description within three days of ${duplicates.join(", ")}. Review before posting.`,
        amount: Math.abs(txn.amount),
      });
      result.pending.push(txn.transactionId);
      continue;
    }

    if (!pattern) {
      raiseFlag(config, state, result, {
        transactionId: txn.transactionId,
        type: "uncategorized",
        severity: "warning",
        title: `Uncategorized: ${truncate(txn.description, 60)}`,
        detail:
          `No categorization pattern matched this ${txn.accountName} transaction ` +
          `on ${txn.date}. Human review required.`,
        amount: Math.abs(txn.amount),
      });
      // Left pending (not marked processed) so it retries after a rule is added.
      result.processed += 1;
      result.pending.push(txn.transactionId);
      continue;
    }

    await applyPattern(config, zoho, state, txn, pattern, result);
    result.processed += 1;
    if (!state.isProcessed(txn.transactionId)) result.pending.push(txn.transactionId);
    } catch {
      raiseFlag(config, state, result, { transactionId: txn.transactionId, key: `source-read:${txn.transactionId}`, type: "worker-error", severity: "warning",
        title: "Transaction processing is waiting for a valid source", detail: "The source or its accounting checks could not be verified. No blind write retry was made; independent transactions continue." });
      result.pending.push(txn.transactionId);
    }
  }

  result.pending = [...new Set(result.pending)];
  return result;
}

function isTransferSource(config: CompanyConfig, txn: BankTransaction): boolean {
  const pattern = findPattern(config.categorizationPatterns, txn);
  return pattern?.action === "interAccountTransfer" && !!pattern.match.from &&
    accountMatches(pattern.match.from, txn.accountName) && txn.amount < 0;
}

function findPattern(
  patterns: CategorizationPattern[],
  txn: BankTransaction
): CategorizationPattern | undefined {
  const desc = txn.description.toUpperCase();
  return patterns.find((p) => {
    const m = p.match;
    if (m.transactionId && m.transactionId !== txn.transactionId) return false;
    if (m.fingerprint && m.fingerprint !== transactionFingerprint(txn)) return false;
    if (m.descriptionEquals && m.descriptionEquals.trim().replace(/\s+/g, " ").toUpperCase() !== desc.trim().replace(/\s+/g, " ")) return false;
    if (m.descriptionContains && !desc.includes(m.descriptionContains.toUpperCase())) {
      return false;
    }
    if (m.account && !accountMatches(m.account, txn.accountName)) return false;
    if (m.direction === "credit" && txn.amount <= 0) return false;
    if (m.direction === "debit" && txn.amount >= 0) return false;
    if (m.isTransfer) {
      // BUG FIX (purchases becoming transfers): a transfer pattern must match
      // BOTH a description pattern and one of the accounts involved.
      // Fail closed: a transfer pattern with no descriptionContains never
      // matches, so an ordinary purchase on the same account (e.g. a
      // $100 Home Depot charge on Property Card) can never become a transfer.
      if (!m.descriptionContains) return false;
      const fromOk = m.from ? accountMatches(m.from, txn.accountName) : true;
      const toOk = m.to ? accountMatches(m.to, txn.accountName) : true;
      if (!(fromOk || toOk)) return false;
    }
    if (m.isCashWithdrawal && !looksLikeCashWithdrawal(txn)) return false;
    return true;
  });
}

/**
 * Account names must match exactly apart from case and surrounding whitespace.
 * Substring matches can select a different bank account.
 */
function accountMatches(patternAccount: string, txnAccount: string): boolean {
  const p = patternAccount.trim().toUpperCase();
  const t = txnAccount.trim().toUpperCase();
  return p === t;
}

/** Heuristic: ATM withdrawals and "cash withdrawal" descriptions. */
function looksLikeCashWithdrawal(txn: BankTransaction): boolean {
  const desc = txn.description.toUpperCase();
  return (
    txn.amount < 0 &&
    (desc.includes("ATM") || desc.includes("CASH WITHDRAWAL") || desc.includes("CASH WD"))
  );
}

async function applyPattern(
  config: CompanyConfig,
  zoho: ZohoBooksClient,
  state: BookkeeperState,
  txn: BankTransaction,
  pattern: CategorizationPattern,
  result: CategorizeResult
): Promise<void> {
  const company = config.company.name;
  const accounts = config.accounts;

  switch (pattern.action) {
    case "flagForHuman": {
      raiseFlag(config, state, result, {
        transactionId: txn.transactionId,
        type: pattern.match.descriptionContains?.toUpperCase().includes("VENMO")
          ? "venmo-ask"
          : "cash-withdrawal",
        severity: "warning",
        title: `Needs owner input: ${truncate(txn.description, 60)}`,
        detail: pattern.reason ?? pattern.notes,
        amount: Math.abs(txn.amount),
      });
      // Receipt rule: anything not on a credit card statement needs a receipt.
      raiseReceiptFlagIfNeeded(config, txn, result, state);
      // Left pending (not marked processed): retries once the owner answers
      // and the flag is resolved via resolveFlagAndRequeue().
      break;
    }

    case "mortgageSplitJournal": {
      // A mortgage "payment" that is money IN is anomalous (lender refund?);
      // never journal it as a payment. Flag for human review instead.
      if (txn.amount > 0) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId,
          type: "checklist-blocked",
          severity: "warning",
          title: "Unexpected mortgage credit: needs review",
          detail:
            `A ${fmt(txn.amount)} credit matching EXAMPLE MORTGAGE PAYMENT on ${txn.date} ` +
            `is not a normal mortgage payment. Not posted; pending your review.`,
          amount: Math.abs(txn.amount),
        });
        break;
      }
      const payment = mortgagePaymentFor(config, state, txn);
      const journal = buildMortgageJournal(config, txn, payment);
      if (!journal) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId,
          type: "checklist-blocked",
          severity: "blocking",
          title: "Mortgage split failed: statement evidence needed",
          detail:
            `EXAMPLE MORTGAGE PAYMENT of ${fmt(txn.amount)} on ${txn.date} could not be split ` +
            `because no single unused statement payment matches its month, amount and date. ` +
            `Muse must supply the actual principal, interest and escrow breakdown.`,
          amount: Math.abs(txn.amount),
        });
        // Left pending (not marked processed) so it retries automatically
        // once the actual payment breakdown is supplied.
        break;
      }
      if (!state.linkMortgagePayment(company, payment!.id, txn.transactionId)) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId, type: "duplicate", severity: "warning",
          title: "Mortgage statement payment already used",
          detail: "Another transaction is linked to this statement payment. Review the duplicate before posting.",
          amount: Math.abs(txn.amount),
        });
        break;
      }
      await postJournal(config, zoho, state, txn, "mortgage-split", journal, result);
      break;
    }

    case "splitExpense": {
      // BUG FIX (refunds posted backward): respect the transaction direction.
      // Money out (negative) = purchase: debit expenses, credit bank.
      // Money in (positive) = refund: debit bank, credit expenses.
      const total = Math.abs(txn.amount);
      const expenseAccount = resolveAccountName(accounts, pattern);
      if (expenseAccount === requiredAccount(accounts, "personalExpenses")) {
        const journal: JournalEntry = { date: txn.date, notes: `Personal ${txn.amount > 0 ? "refund" : "expense"}: ${txn.description}`,
          lines: txn.amount < 0 ? [{ accountName: expenseAccount, debit: total }, { accountName: txn.accountName, credit: total }] :
            [{ accountName: txn.accountName, debit: total }, { accountName: expenseAccount, credit: total }] };
        if (await postJournal(config, zoho, state, txn, "split-expense", journal, result)) raiseReceiptFlagIfNeeded(config, txn, result, state);
        break;
      }
      const rentalShare = pattern.rentalShare ?? config.allocation.rentalShare;
      const rental = round2(total * rentalShare);
      const personal = round2(total - rental);
      const isRefund = txn.amount > 0;
      const journal: JournalEntry = {
        date: txn.date,
        notes: `${isRefund ? "Refund" : "Auto-categorized"}: ${txn.description}`,
        lines: isRefund
          ? [
              {
                accountName: txn.accountName,
                debit: total,
                description: "Refund received",
              },
              {
                accountName: resolveAccountName(accounts, pattern),
                credit: rental,
                description: `Rental share refund (${pct(rentalShare)})`,
              },
              {
                accountName: requiredAccount(accounts, "ownerDraws"),
                credit: personal,
                description: `Personal share refund (${pct(1 - rentalShare)})`,
              },
            ]
          : [
              {
                accountName: resolveAccountName(accounts, pattern),
                debit: rental,
                description: `Rental share (${pct(rentalShare)})`,
              },
              {
                accountName: requiredAccount(accounts, "ownerDraws"),
                debit: personal,
                description: `Personal share (${pct(1 - rentalShare)})`,
              },
              {
                accountName: txn.accountName,
                credit: total,
              },
            ],
      };
      if (await postJournal(config, zoho, state, txn, "split-expense", journal, result)) {
        raiseReceiptFlagIfNeeded(config, txn, result, state);
      }
      break;
    }

    case "escrowDisbursement": {
      if (!accountMatches(requiredAccount(accounts, "mortgageEscrow"), txn.accountName)) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId, type: "uncategorized", severity: "warning",
          title: "Tax or insurance payment source needs review",
          detail: `This payment is from ${txn.accountName}, not verified mortgage escrow. The bank transaction was not posted as an escrow disbursement.`,
          amount: Math.abs(txn.amount),
        });
        break;
      }
      // Escrow disbursements are money OUT of escrow (taxes/insurance paid
      // by Example Mortgage). A credit here is anomalous; flag instead of posting.
      if (txn.amount > 0) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId,
          type: "checklist-blocked",
          severity: "warning",
          title: "Unexpected escrow credit: needs review",
          detail:
            `A ${fmt(txn.amount)} credit matching an escrow pattern on ${txn.date} ` +
            `is not a normal disbursement. Not posted; pending your review.`,
          amount: Math.abs(txn.amount),
        });
        break;
      }
      // Taxes/insurance paid by Example Mortgage out of escrow.
      const total = Math.abs(txn.amount);
      const rental = round2(total * config.allocation.rentalShare);
      const journal: JournalEntry = {
        date: txn.date,
        notes: `Escrow disbursement: ${txn.description}`,
        lines: [
          { accountName: resolveAccountName(accounts, pattern), debit: rental },
          { accountName: requiredAccount(accounts, "mortgageEscrow"), credit: rental },
        ],
      };
      await postJournal(config, zoho, state, txn, "escrow-disbursement", journal, result);
      break;
    }

    case "rentalIncome": {
      // BUG FIX (refunds posted backward): money in = rent received
      // (debit bank, credit income). Money out = rent refunded to tenant
      // (debit income, credit bank).
      const amount = Math.abs(txn.amount);
      const isRefund = txn.amount < 0;
      // Personal Venmo receipts tag the owner-funds line to the same unit as
      // the income line, so verified manual receipts can be reused exactly.
      const statementCustomerId = txn.statement?.kind === "venmo-rent"
        ? config.units.find(u => u.id === pattern.unit)?.customerId : undefined;
      const journal: JournalEntry = {
        date: txn.date,
        notes: `${isRefund ? "Rent refund" : "Rent received"}: ${pattern.unit ?? ""} - ${txn.description}`,
        lines: isRefund
          ? [
              {
                accountName: requiredAccount(accounts, "rentalIncome"),
                debit: amount,
                description: pattern.unit,
                customerId: config.units.find(u => u.id === pattern.unit)?.customerId,
              },
              { accountName: txn.accountName, credit: amount, ...(statementCustomerId ? { customerId: statementCustomerId } : {}) },
            ]
          : [
              { accountName: txn.accountName, debit: amount, ...(statementCustomerId ? { customerId: statementCustomerId } : {}) },
              {
                accountName: requiredAccount(accounts, "rentalIncome"),
                credit: amount,
                description: pattern.unit,
                customerId: config.units.find(u => u.id === pattern.unit)?.customerId,
              },
            ],
      };
      await postJournal(config, zoho, state, txn, "rental-income", journal, result);
      break;
    }

    case "ownerContribution": {
      const amount = Math.abs(txn.amount);
      await postJournal(config, zoho, state, txn, "owner-contribution", {
        date: txn.date, notes: `Owner contribution: ${txn.description}`,
        lines: txn.amount > 0 ? [
          { accountName: txn.accountName, debit: amount },
          { accountName: requiredAccount(accounts, "ownerContributions"), credit: amount },
        ] : [
          { accountName: requiredAccount(accounts, "ownerContributions"), debit: amount },
          { accountName: txn.accountName, credit: amount },
        ],
      }, result);
      break;
    }

    case "interAccountTransfer": {
      // Defensive: the matcher should already guarantee one side matches,
      // but never create a transfer when neither configured account matches
      // the transaction's account.
      const from = pattern.match.from ?? txn.accountName;
      const to = pattern.match.to ?? txn.accountName;
      if (!isTransferSource(config, txn)) {
        const candidates = txn.amount > 0 && accountMatches(to, txn.accountName)
          ? state.findTransferSources(company, txn, from, to) : [];
        if (candidates.length === 1 && state.linkTransferCounterpart(company, candidates[0]!, txn)) {
          for (const flag of state.getOpenFlagsForTransaction(txn.transactionId, "transfer-counterpart")) {
            if (flag.companyName === company) state.updateFlag(flag.id, { status: "resolved", notes: `Matched source ${candidates[0]!.transactionId}` });
          }
          await matchPostedSource(config, zoho, state, txn, candidates[0]!.remoteId!, candidates[0]!.reference, result);
        } else if (!state.isProcessed(txn.transactionId)) {
          raiseFlag(config, state, result, {
            transactionId: txn.transactionId, type: "transfer-counterpart", severity: "warning",
            title: "Transfer counterpart needs matching",
            detail: `Found ${candidates.length} eligible source postings for ${from} -> ${to}. No transfer was created from this counterpart.`,
            amount: Math.abs(txn.amount),
          });
        }
        break;
      }
      if (!accountMatches(from, txn.accountName) && !accountMatches(to, txn.accountName)) {
        raiseFlag(config, state, result, {
          transactionId: txn.transactionId,
          type: "uncategorized",
          severity: "warning",
          title: `Transfer account mismatch: ${truncate(txn.description, 50)}`,
          detail:
            `Pattern expects ${from} -> ${to} but the transaction is on ` +
            `${txn.accountName}. Not posted; pending your review.`,
          amount: Math.abs(txn.amount),
        });
        break;
      }
      const referenceNumber = postingReference(config, txn);
      if (!await checkBeforePosting(config, zoho, state, txn, result)) break;
      const transfer = {
        fromAccount: from,
        toAccount: to,
        amount: Math.abs(txn.amount),
        date: txn.date,
        description: txn.description,
        referenceNumber,
      };
      if (!state.claimPosting(company, txn, "transfer", referenceNumber, transfer)) {
        raiseUncertainFlag(config, state, result, txn, referenceNumber);
        break;
      }
      try {
        const transferId = await zoho.createTransfer(transfer, txn);
        if (!transferId?.trim()) throw new Error("Transfer response has no remote ID.");
        state.completePosting(company, txn.transactionId, "transfer", transferId);
        result.transfersCreated.push(transferId);
        await matchPostedSource(config, zoho, state, txn, transferId, referenceNumber, result);
      } catch {
        state.markPostingUncertain(company, txn.transactionId);
        raiseUncertainFlag(config, state, result, txn, referenceNumber);
      }
      break;
    }
  }
}

function postingReference(config: CompanyConfig, txn: BankTransaction): string {
  return `bk-${createHash("sha256").update(`${config.company.zohoOrgId}:${txn.transactionId}`).digest("hex").slice(0, 24)}`;
}

async function postJournal(config: CompanyConfig, zoho: ZohoBooksClient, state: BookkeeperState,
  txn: BankTransaction, action: string, journal: JournalEntry, result: CategorizeResult): Promise<boolean> {
  if (!await checkBeforePosting(config, zoho, state, txn, result)) return false;
  journal.referenceNumber = postingReference(config, txn);
  let verifiedExistingId: string | undefined;
  if (txn.statement?.existingJournalId) {
    try { verifiedExistingId = await zoho.verifyExistingJournal(journal, txn.statement.existingJournalId); }
    catch {
      raiseFlag(config, state, result, { transactionId: txn.transactionId, type: "existing-match", severity: "warning",
        title: "Existing statement journal could not be verified", detail: "Check the supplied journal ID, published status, date, accounts and amounts. No new entry was submitted." });
      result.pending.push(txn.transactionId); return false;
    }
  }
  if (!state.claimPosting(config.company.name, txn, action, journal.referenceNumber, journal)) {
    raiseUncertainFlag(config, state, result, txn, journal.referenceNumber);
    return false;
  }
  try {
    const id = verifiedExistingId ?? await zoho.createJournal(journal, txn.statement ? undefined : txn);
    if (!id?.trim()) throw new Error("Journal response has no remote ID.");
    state.completePosting(config.company.name, txn.transactionId, action, id);
    if (txn.statement?.existingJournalId) result.skipped.push(txn.transactionId);
    else result.journalsCreated.push(id);
    await matchPostedSource(config, zoho, state, txn, id, journal.referenceNumber, result);
    return true;
  } catch {
    state.markPostingUncertain(config.company.name, txn.transactionId);
    raiseUncertainFlag(config, state, result, txn, journal.referenceNumber);
    return false;
  }
}

async function checkBeforePosting(config: CompanyConfig, zoho: ZohoBooksClient, state: BookkeeperState,
  txn: BankTransaction, result: CategorizeResult): Promise<boolean> {
  try {
    if (txn.statement) {
      if (!txn.statement.existingJournalId) await zoho.checkStatementSourceForPosting(txn,
        txn.statement.kind === "escrow" ? round2(Math.abs(txn.amount) * config.allocation.rentalShare) : Math.abs(txn.amount));
    } else await zoho.checkSourceForPosting(txn);
    return true;
  }
  catch (error) {
    if (!(error instanceof ExistingBankMatchError)) throw error;
    raiseFlag(config, state, result, { transactionId: txn.transactionId, type: "existing-match", severity: "warning",
      title: "Possible existing entry in Zoho", detail: error.message, amount: Math.abs(txn.amount) });
    result.pending.push(txn.transactionId);
    return false;
  }
}

async function matchPostedSource(config: CompanyConfig, zoho: ZohoBooksClient, state: BookkeeperState,
  txn: BankTransaction, remoteId: string, reference: string, result: CategorizeResult): Promise<void> {
  if (state.isBankMatched(config.company.name, txn.transactionId)) return;
  if (txn.statement) { state.completeBankMatch(config.company.name, txn.transactionId); return; }
  try {
    await zoho.matchBankTransaction(txn, remoteId, reference);
    state.completeBankMatch(config.company.name, txn.transactionId);
  } catch {
    if (state.isBankMatched(config.company.name, txn.transactionId)) return;
    raiseFlag(config, state, result, {
      transactionId: txn.transactionId, type: "source-match", severity: "blocking",
      title: "Posted entry still needs its bank-feed match",
      detail: `The entry ${remoteId} (${reference}) is saved. Matching will retry after checking Zoho; no second journal or transfer will be created.`,
      amount: Math.abs(txn.amount),
    });
    result.pending.push(txn.transactionId);
  }
}

function raiseUncertainFlag(config: CompanyConfig, state: BookkeeperState, result: CategorizeResult,
  txn: BankTransaction, reference: string): void {
  if (state.getPosting(config.company.name, txn.transactionId)?.status === "posted") return;
  raiseFlag(config, state, result, {
    transactionId: txn.transactionId, type: "posting-uncertain", severity: "blocking",
    title: "Posting outcome needs verification",
    detail: `A posting attempt already exists for ${reference}. Stop workers, verify this reference in Zoho, then record its remote ID or confirm no posting occurred. Automatic retries are disabled.`,
    amount: Math.abs(txn.amount),
  });
}

/**
 * Build the 5-line mortgage split journal.
 * Returns undefined without a verified statement payment.
 */
export function buildMortgageJournal(
  config: CompanyConfig,
  txn: BankTransaction,
  payment?: MortgagePayment
): JournalEntry | undefined {
  const total = Math.abs(txn.amount);
  const yearMonth = txn.date.slice(0, 7); // YYYY-MM
  if (!payment) return undefined;

  const accounts = config.accounts;
  const rentalInterest = round2(payment.interest * config.allocation.rentalShare);
  const rentalPrincipal = round2(payment.principal * config.allocation.rentalShare);
  const rentalEscrow = round2(payment.escrow * config.allocation.rentalShare);
  const personalShare = round2(total - rentalInterest - rentalPrincipal - rentalEscrow);

  return {
    date: txn.date,
    notes: `Mortgage payment split: ${txn.description}`,
    lines: [
      {
        accountName: requiredAccount(accounts, "mortgageInterest"),
        debit: rentalInterest,
        description: `Rental interest ${yearMonth}`,
      },
      {
        accountName: requiredAccount(accounts, "mortgagePayable"),
        debit: rentalPrincipal,
        description: `Rental principal ${yearMonth}`,
      },
      {
        accountName: requiredAccount(accounts, "mortgageEscrow"),
        debit: rentalEscrow,
        description: `Rental escrow ${yearMonth}`,
      },
      {
        accountName: requiredAccount(accounts, "ownerDraws"),
        debit: personalShare,
        description: `Personal share (${pct(config.allocation.personalShare)})`,
      },
      { accountName: txn.accountName, credit: total },
    ],
  };
}

/** Resolve a pattern's account display name to the config's account key. */
function resolveAccountName(
  accounts: Record<string, string>,
  pattern: CategorizationPattern
): string {
  if (!pattern.account) {
    throw new Error(`Pattern has no account configured: ${pattern.notes}`);
  }
  // pattern.account holds the display name; find the config key whose value matches.
  for (const displayName of Object.values(accounts)) {
    if (displayName === pattern.account) return displayName;
  }
  // Fall back to the display name as given.
  return pattern.account;
}

/**
 * Raises the over-threshold flag when needed.
 * Returns true when the transaction must NOT be posted (left pending
 * for human review). "Info"-level flags never block posting.
 */
function raiseAmountFlagIfNeeded(
  config: CompanyConfig,
  txn: BankTransaction,
  result: CategorizeResult,
  state: BookkeeperState
): boolean {
  const threshold = config.flagRules.amountThreshold;
  if (Math.abs(txn.amount) > threshold) {
    raiseFlag(config, state, result, {
      transactionId: txn.transactionId,
      type: "amount-threshold",
      severity: "warning",
      title: `Over $${threshold.toLocaleString()}: ${truncate(txn.description, 50)}`,
      detail:
        `${fmt(txn.amount)} on ${txn.date} exceeds the $${threshold.toLocaleString()} ` +
        `review threshold. ${config.flagRules.amountThresholdNote} ` +
        `The transaction was NOT posted; it is pending your review.`,
      amount: Math.abs(txn.amount),
    });
    return true;
  }
  return false;
}

/**
 * Receipt rule: anything that does NOT appear on a credit card statement
 * (cash, Venmo, checks, bank debits) needs a receipt.
 */
function raiseReceiptFlagIfNeeded(
  config: CompanyConfig,
  txn: BankTransaction,
  result: CategorizeResult,
  state: BookkeeperState
): void {
  const cardAccount = config.accounts["quicksilver"];
  const looksLikeCard = !!cardAccount && accountMatches(cardAccount, txn.accountName);
  if (config.flagRules.needsReceipt && !looksLikeCard && txn.amount < 0) {
    raiseFlag(config, state, result, {
      transactionId: txn.transactionId,
      type: "needs-receipt",
      severity: "info",
      title: `Receipt needed: ${truncate(txn.description, 50)}`,
      detail: config.flagRules.needsReceiptNote,
      amount: Math.abs(txn.amount),
    });
  }
}

function raiseFlag(
  config: CompanyConfig,
  state: BookkeeperState,
  result: CategorizeResult,
  partial: Omit<Flag, "id" | "createdAt" | "companyName" | "status" | "escalationLevel">
): Flag {
  const flag: Flag = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    companyName: config.company.name,
    status: "open",
    escalationLevel: 0,
    ...partial,
  };
  const saved = state.saveFlag(flag);
  if (!result.flagsRaised.some((f) => f.id === saved.id)) result.flagsRaised.push(saved);
  return saved;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
