import type { CompanyConfig } from "./types.js";

/** USD rental deployments: explicit identities, isolated state and reviewed rules. */
export function validateConfig(value: unknown): CompanyConfig {
  const config = value as CompanyConfig;
  if (!/^\d+$/.test(config?.company?.zohoOrgId ?? "") || !config.company.name?.trim() || config.company.currency !== "USD") {
    throw new Error("A named USD company with a numeric Zoho organization ID is required.");
  }
  if (config.company.example !== undefined && typeof config.company.example !== "boolean") throw new Error("Invalid example marker.");
  const ids = config.bankAccountIds;
  if (!ids || !/^\d+$/.test(ids.tdBank) || !/^\d+$/.test(ids.quicksilver) || ids.tdBank === ids.quicksilver) throw new Error("Two distinct verified bank account IDs are required.");
  new Intl.DateTimeFormat("en-US", { timeZone: config.company.timezone }).format();
  for (const key of ["tdBank", "quicksilver", "mortgageEscrow", "mortgageInterest", "mortgagePayable", "ownerDraws", "ownerContributions", "rentalIncome", "insurance", "propertyTaxes", "utilities", "repairsMaintenance", "personalExpenses"]) {
    if (typeof config.accounts?.[key] !== "string" || !config.accounts[key]!.trim()) throw new Error(`Missing configured account: ${key}.`);
  }
  if (new Set(Object.values(config.accounts)).size !== Object.values(config.accounts).length) throw new Error("Account names must be distinct.");
  for (const share of [config.allocation.rentalShare, config.allocation.personalShare]) {
    if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error("Invalid allocation share.");
  }
  if (Math.abs(config.allocation.rentalShare + config.allocation.personalShare - 1) > 1e-9) throw new Error("Allocation shares must add to one.");
  if (!Array.isArray(config.units) || config.units.length < 1 || config.units.some(u => !/^[a-z0-9][a-z0-9-]*$/.test(u.id)) || new Set(config.units.map(u => u.id)).size !== config.units.length) throw new Error("At least one distinct rental unit is required.");
  for (const unit of config.units) {
    if (!Number.isFinite(unit.monthlyRent) || unit.monthlyRent <= 0 || !/^\d+$/.test(unit.customerId ?? "")) throw new Error("Each unit requires positive rent and a Zoho customer ID.");
  }
  if (!Number.isFinite(config.flagRules.amountThreshold) || config.flagRules.amountThreshold <= 0) throw new Error("Invalid review threshold.");
  if (!Array.isArray(config.categorizationPatterns)) throw new Error("Categorization rules are required.");
  for (const rule of config.categorizationPatterns) {
    if (!["mortgageSplitJournal", "splitExpense", "escrowDisbursement", "rentalIncome", "ownerContribution", "flagForHuman", "interAccountTransfer"].includes(rule.action) || !rule.match) throw new Error("Invalid categorization rule.");
    if (rule.account && !Object.values(config.accounts).includes(rule.account)) throw new Error("Rule references an unknown account.");
    if (rule.expectedAmount !== undefined && (!Number.isFinite(rule.expectedAmount) || rule.expectedAmount <= 0 || Math.abs(rule.expectedAmount * 100 - Math.round(rule.expectedAmount * 100)) > 1e-6)) throw new Error("Expected amounts must be positive cents.");
    if (rule.rentalShare !== undefined && (!Number.isFinite(rule.rentalShare) || rule.rentalShare < 0 || rule.rentalShare > 1)) throw new Error("Invalid rule allocation.");
  }
  const steps = ["import-complete", "all-categorized", "td-reconciled", "quicksilver-reconciled", "rent-verified", "mortgage-split", "escrow-recorded", "mortgage-tieout", "escrow-tieout", "pl-review", "flags-resolved", "owner-accounts-reviewed"];
  if (config.closeChecklist.length !== steps.length || steps.some(s => config.closeChecklist.filter(c => c.id === s).length !== 1)) throw new Error("Close checklist is missing or repeats required steps.");
  if (!config.escalation.steps.length || config.escalation.steps.some(s => !["notification", "email"].includes(s.channel))) throw new Error("Use Muse notifications and email for this deployment.");
  return config;
}
