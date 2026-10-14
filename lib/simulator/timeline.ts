/**
 * A life timeline is a collection of nominal monthly cash flows relative to
 * month one of a scenario. Rules never read or modify real FinanceOS accounts.
 */
export type TimelineRuleKind = "contribution" | "deposit" | "withdrawal";

export interface TimelineRule {
  id: string;
  label: string;
  kind: TimelineRuleKind;
  startMonth: number; // inclusive, one-based
  endMonth: number; // inclusive, one-based
  amountCzk: number; // non-negative nominal CZK in the rule's first month
  annualIncreasePct: number; // compounded after every 12 active months
}

export const MAX_TIMELINE_RULES = 48;
export const MAX_TIMELINE_MONTHS = 1_200;

export function validateTimelineRules(rules: TimelineRule[]): void {
  if (!Array.isArray(rules) || rules.length > MAX_TIMELINE_RULES) {
    throw new RangeError("Časová osa podporuje maximálně 48 pravidelných událostí.");
  }
  const ids = new Set<string>();
  const overrides: TimelineRule[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule.id !== "string" || !rule.id.trim() ||
      ids.has(rule.id) || typeof rule.label !== "string" || rule.label.length > 70 ||
      !["contribution", "deposit", "withdrawal"].includes(rule.kind) ||
      !Number.isInteger(rule.startMonth) || !Number.isInteger(rule.endMonth) ||
      rule.startMonth < 1 || rule.endMonth > MAX_TIMELINE_MONTHS || rule.endMonth < rule.startMonth ||
      !Number.isFinite(rule.amountCzk) || rule.amountCzk < 0 || rule.amountCzk > 1e12 ||
      !Number.isFinite(rule.annualIncreasePct) ||
      rule.annualIncreasePct <= -100 || rule.annualIncreasePct > 100) {
      throw new RangeError("Časová osa obsahuje neplatné období, název nebo finanční hodnotu.");
    }
    ids.add(rule.id);
    if (rule.kind === "contribution") overrides.push(rule);
  }
  const sorted = [...overrides].sort((a, b) => a.startMonth - b.startMonth);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMonth <= sorted[i-1].endMonth) {
      throw new RangeError("Dvě změny základního vkladu se časově překrývají. Uprav jejich období.");
    }
  }
}

export interface TimelineMonthFlows {
  contributionOverrideCzk: number | null;
  extraDepositCzk: number;
  withdrawalCzk: number;
}

export function timelineMonthFlows(rules: TimelineRule[], month: number): TimelineMonthFlows {
  const flows: TimelineMonthFlows = {
    contributionOverrideCzk: null,
    extraDepositCzk: 0,
    withdrawalCzk: 0,
  };
  for (const rule of rules) {
    if (month < rule.startMonth || month > rule.endMonth) continue;
    const yearsActive = Math.floor((month - rule.startMonth) / 12);
    const amount = rule.amountCzk * Math.pow(1 + rule.annualIncreasePct / 100, yearsActive);
    if (rule.kind === "contribution") flows.contributionOverrideCzk = amount;
    else if (rule.kind === "deposit") flows.extraDepositCzk += amount;
    else flows.withdrawalCzk += amount;
  }
  return flows;
}

export function ageFromMonth(startAge: number, month: number) {
  return startAge + (month - 1) / 12;
}

export function periodFromAges(startAge: number, fromAge: number, untilAge: number) {
  if (!Number.isInteger(startAge) || !Number.isInteger(fromAge) || !Number.isInteger(untilAge) ||
      startAge < 0 || startAge > 100 || fromAge < startAge ||
      untilAge <= fromAge || untilAge > startAge + 100) {
    throw new RangeError("Zvol platný počáteční věk a věkové období (od včetně, do bez daného roku).");
  }
  const startMonth = (fromAge - startAge) * 12 + 1;
  const endMonth = (untilAge - startAge) * 12;
  if (endMonth > MAX_TIMELINE_MONTHS) {
    throw new RangeError("Finanční časová osa podporuje maximálně 100 let.");
  }
  return { startMonth, endMonth };
}
