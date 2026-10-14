/**
 * FinanceOS financial simulator v1.
 * Pure math: no provider data, network access, storage or side effects.
 * All rates represent EFFECTIVE annual rates. Payments occur at month end.
 */
import { timelineMonthFlows, validateTimelineRules, type TimelineRule } from "./timeline.ts";

export type SolveKey = "years" | "initialCzk" | "monthlyContributionCzk" | "annualReturnPct" | "targetMonthlyIncomeCzk";

export interface SimulatorInputs {
  initialCzk: number;
  monthlyContributionCzk: number;
  annualReturnPct: number;
  annualInflationPct: number;
  annualContributionIncreasePct: number;
  withdrawalRatePct: number;
  targetMonthlyIncomeCzk: number;
  years: number;
}

export interface SimulatorEvent {
  id: string;
  month: number;
  amountCzk: number;
}

export interface SimulatorPoint {
  month: number;
  nominalCzk: number;
  realCzk: number;
  paidInCzk: number;
  withdrawnCzk: number;
  shortfallCzk: number;
  targetNominalCzk: number;
  monthlyDepositCzk: number;
  monthlyWithdrawalCzk: number;
  monthlyShortfallCzk: number;
}

export interface SimulatorForecast {
  points: SimulatorPoint[];
  firstGoalMonth: number | null;
  last: SimulatorPoint;
  goalRealCzk: number;
}

export interface SolveResult {
  value: number | null;
  error: string | null;
}

export const SIMULATOR_DEFAULTS: SimulatorInputs = {
  initialCzk: 500_000,
  monthlyContributionCzk: 5_000,
  annualReturnPct: 12,
  annualInflationPct: 2.9,
  annualContributionIncreasePct: 0,
  withdrawalRatePct: 3,
  targetMonthlyIncomeCzk: 50_000,
  years: 20,
};

export const MAX_SIMULATION_MONTHS = 1_200;

function assertValid(input: SimulatorInputs, months: number, events: SimulatorEvent[]) {
  const values = Object.values(input);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new RangeError("Všechny hodnoty musí být konečná čísla.");
  }
  if (input.initialCzk < 0 || input.monthlyContributionCzk < 0 || input.targetMonthlyIncomeCzk < 0 ||
      input.withdrawalRatePct <= 0 || input.withdrawalRatePct > 100 ||
      input.annualReturnPct <= -100 || input.annualReturnPct > 300 ||
      input.annualInflationPct <= -100 || input.annualInflationPct > 100 ||
      input.annualContributionIncreasePct <= -100 || input.annualContributionIncreasePct > 100) {
    throw new RangeError("Zkontroluj částky a procenta: výnos nad −100 % až 300 %, inflace do 100 % a výběry nad 0 %.");
  }
  if (!Number.isInteger(months) || months < 0 || months > MAX_SIMULATION_MONTHS) {
    throw new RangeError("Horizont simulace musí být 0 až 100 let.");
  }
  if (events.some((event) => !Number.isInteger(event.month) || event.month < 1 ||
      event.month > MAX_SIMULATION_MONTHS || !Number.isFinite(event.amountCzk))) {
    throw new RangeError("Neplatné datum nebo částka jednorázové události.");
  }
}

export function goalRealCzk(input: SimulatorInputs) {
  return input.targetMonthlyIncomeCzk * 12 / (input.withdrawalRatePct / 100);
}

export function simulate(
  input: SimulatorInputs,
  months: number,
  events: SimulatorEvent[] = [],
  rules: TimelineRule[] = [],
): SimulatorForecast {
  assertValid(input, months, events);
  validateTimelineRules(rules);
  const rate = Math.pow(1 + input.annualReturnPct / 100, 1 / 12) - 1;
  const inflation = 1 + input.annualInflationPct / 100;
  const contributionGrowth = 1 + input.annualContributionIncreasePct / 100;
  const target = goalRealCzk(input);
  const eventTotals = new Map<number, number>();
  for (const event of events) {
    eventTotals.set(event.month, (eventTotals.get(event.month) ?? 0) + event.amountCzk);
  }

  let balance = input.initialCzk;
  let paidIn = input.initialCzk;
  let withdrawn = 0;
  let shortfall = 0;
  let firstGoalMonth: number | null = null;
  const points: SimulatorPoint[] = [];

  for (let month = 0; month <= months; month++) {
    let monthlyDepositCzk = 0;
    let monthlyWithdrawalCzk = 0;
    let monthlyShortfallCzk = 0;
    if (month > 0) {
      const schedule = timelineMonthFlows(rules, month);
      const baseDeposit = schedule.contributionOverrideCzk ??
        input.monthlyContributionCzk *
          Math.pow(contributionGrowth, Math.floor((month - 1) / 12));
      const eventAmount = eventTotals.get(month) ?? 0;
      monthlyDepositCzk = baseDeposit + schedule.extraDepositCzk + Math.max(0, eventAmount);
      const beforeWithdrawal = balance * (1 + rate) + monthlyDepositCzk;
      const requestedWithdrawal = schedule.withdrawalCzk + Math.max(0, -eventAmount);
      monthlyWithdrawalCzk = Math.min(Math.max(0, beforeWithdrawal), requestedWithdrawal);
      monthlyShortfallCzk = requestedWithdrawal - monthlyWithdrawalCzk;
      shortfall += monthlyShortfallCzk;
      balance = beforeWithdrawal - monthlyWithdrawalCzk;
      paidIn += monthlyDepositCzk;
      withdrawn += monthlyWithdrawalCzk;
    }
    const factor = Math.pow(inflation, month / 12);
    const realCzk = balance / factor;
    if (!Number.isFinite(balance) || !Number.isFinite(realCzk)) {
      throw new RangeError("Hodnoty simulace jsou příliš vysoké.");
    }
    const point = {
      month,
      nominalCzk: balance,
      realCzk,
      paidInCzk: paidIn,
      withdrawnCzk: withdrawn,
      shortfallCzk: shortfall,
      targetNominalCzk: target * factor,
      monthlyDepositCzk,
      monthlyWithdrawalCzk,
      monthlyShortfallCzk,
    };
    if (firstGoalMonth === null && realCzk >= target) firstGoalMonth = month;
    points.push(point);
  }
  return { points, firstGoalMonth, last: points[points.length - 1], goalRealCzk: target };
}

export function solve(
  input: SimulatorInputs,
  unknown: SolveKey,
  events: SimulatorEvent[] = [],
  rules: TimelineRule[] = [],
): SolveResult {
  try {
    if (unknown === "years") {
      const forecast = simulate(input, MAX_SIMULATION_MONTHS, events, rules);
      return forecast.firstGoalMonth === null
        ? { value: null, error: "Cíl nebyl dosažen ani za 100 let při zadaných předpokladech." }
        : { value: forecast.firstGoalMonth / 12, error: null };
    }

    const months = Math.round(input.years * 12);
    if (input.years < 0 || input.years > 100 || months < 0) {
      return { value: null, error: "Nastav horizont 0–100 let." };
    }
    const target = goalRealCzk(input);
    if (unknown === "targetMonthlyIncomeCzk") {
      const projected = simulate(input, months, events, rules).last.realCzk;
      return { value: projected * input.withdrawalRatePct / 100 / 12, error: null };
    }

    const bounds: Record<"initialCzk" | "monthlyContributionCzk" | "annualReturnPct", [number, number]> = {
      initialCzk: [0, 1_000_000_000_000],
      monthlyContributionCzk: [0, 1_000_000_000],
      annualReturnPct: [-99.9, 300],
    };
    const key = unknown;
    const [lower, upper] = bounds[key];
    const projection = (value: number) =>
      simulate({ ...input, [key]: value }, months, events, rules).last.realCzk;
    if (projection(lower) >= target) return { value: lower, error: null };
    if (projection(upper) < target) {
      return { value: null, error: "Při daných omezeních nelze najít řešení. Uprav cíl nebo časový horizont." };
    }
    let lo = lower;
    let hi = upper;
    for (let i = 0; i < 75; i++) {
      const mid = (lo + hi) / 2;
      if (projection(mid) >= target) hi = mid;
      else lo = mid;
    }
    return { value: hi, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "Výpočet se nezdařil." };
  }
}

export function durationLabel(months: number) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = y === 1 ? "rok" : y >= 2 && y <= 4 ? "roky" : "let";
  const monthWord = m === 1 ? "měsíc" : m >= 2 && m <= 4 ? "měsíce" : "měsíců";
  return y + " " + years + " " + m + " " + monthWord;
}
