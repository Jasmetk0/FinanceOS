/**
 * Reproducible, local-only retirement Monte Carlo.
 *
 * Nominal monthly gross returns are i.i.d. lognormal with E[gross per
 * calendar year] = 1 + expectedAnnualReturnPct/100. Geometric median
 * growth is LOWER when volatility > 0; do not confuse expected simple
 * annual return with long-run investor CAGR.
 *
 * No brokerage transactions or provider secrets are read or mutated.
 */
export interface RetirementRiskInputs {
  currentAge: number;
  years: number;
  retirementAfterYears: number;
  initialCzk: number;
  monthlyContributionCzk: number;
  annualContributionIncreasePct: number;
  expectedAnnualReturnPct: number;
  annualVolatilityPct: number;
  annualInflationPct: number;
  retirementIncomeMonthlyRealCzk: number;
  goalWithdrawalRatePct: number;
  trials: number;
  seed: number;
}

export interface RetirementRiskYearPoint {
  year: number;
  p10RealCzk: number;
  medianRealCzk: number;
  p90RealCzk: number;
}

export interface RetirementRiskResult {
  points: RetirementRiskYearPoint[];
  trials: number;
  retirementGoalRealCzk: number;
  retirementGoalHitPct: number;
  incomeFundedPct: number;
  exhaustedPaths: number;
  medianFinalRealCzk: number;
  p10FinalRealCzk: number;
  p90FinalRealCzk: number;
  medianMarketMaxDrawdownPct: number;
}

export const RETIREMENT_RISK_DEFAULTS: RetirementRiskInputs = {
  currentAge: 22,
  years: 60,
  retirementAfterYears: 25,
  initialCzk: 500_000,
  monthlyContributionCzk: 5_000,
  annualContributionIncreasePct: 2.9,
  expectedAnnualReturnPct: 10,
  annualVolatilityPct: 20,
  annualInflationPct: 2.9,
  retirementIncomeMonthlyRealCzk: 50_000,
  goalWithdrawalRatePct: 3,
  trials: 2000,
  seed: 42,
};

function finite(value: number) { return typeof value === "number" && Number.isFinite(value); }
export function validateRetirementRisk(input: RetirementRiskInputs) {
  if (Object.values(input).some((value) => !finite(value))) throw new RangeError("Všechny parametry musí být konečná čísla.");
  if (!Number.isInteger(input.currentAge) || input.currentAge < 0 || input.currentAge > 100 ||
    !Number.isInteger(input.years) || input.years < 1 || input.years > 100 ||
    !Number.isInteger(input.retirementAfterYears) || input.retirementAfterYears < 0 ||
    input.retirementAfterYears >= input.years ||
    input.initialCzk < 0 || input.initialCzk > 1e12 ||
    input.monthlyContributionCzk < 0 || input.monthlyContributionCzk > 1e9 ||
    input.retirementIncomeMonthlyRealCzk < 0 || input.retirementIncomeMonthlyRealCzk > 1e9 ||
    input.expectedAnnualReturnPct <= -100 || input.expectedAnnualReturnPct > 100 ||
    input.annualVolatilityPct < 0 || input.annualVolatilityPct > 150 ||
    input.annualInflationPct <= -100 || input.annualInflationPct > 100 ||
    input.annualContributionIncreasePct <= -100 || input.annualContributionIncreasePct > 100 ||
    input.goalWithdrawalRatePct <= 0 || input.goalWithdrawalRatePct > 100 ||
    !Number.isInteger(input.trials) || input.trials < 100 || input.trials > 10000 ||
    !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new RangeError("Zkontroluj horizont, věk, částky, výnos, volatilitu, inflaci, počet běhů a seed.");
  }
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function normalGenerator(seed: number) {
  const rng = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const z = spare; spare = null; return z; }
    const a = Math.max(Number.MIN_VALUE, rng());
    const b = rng();
    const radius = Math.sqrt(-2 * Math.log(a));
    spare = radius * Math.sin(2 * Math.PI * b);
    return radius * Math.cos(2 * Math.PI * b);
  };
}

function quantile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const a = Math.floor(index), b = Math.ceil(index);
  return sorted[a] + (sorted[b] - sorted[a]) * (index - a);
}

function monthlyParameters(input: RetirementRiskInputs) {
  const sigma = input.annualVolatilityPct / 100 / Math.sqrt(12);
  const logDrift = Math.log1p(input.expectedAnnualReturnPct / 100) / 12 - sigma * sigma / 2;
  return { sigma, logDrift };
}

export function runRetirementMonteCarlo(input: RetirementRiskInputs): RetirementRiskResult {
  validateRetirementRisk(input);
  const months = input.years * 12;
  const retirementStartMonth = input.retirementAfterYears * 12 + 1;
  const factor = 1 + input.annualInflationPct / 100;
  const savingsIncrease = 1 + input.annualContributionIncreasePct / 100;
  const { sigma, logDrift } = monthlyParameters(input);
  const gaussian = normalGenerator(input.seed);
  const annualValues: number[][] = Array.from({ length: input.years + 1 }, () => []);
  const finalValues: number[] = [];
  const drawdowns: number[] = [];
  const requiredRealCzk = input.retirementIncomeMonthlyRealCzk * 12 / (input.goalWithdrawalRatePct / 100);
  let goalHits = 0, incomeFunded = 0, exhausted = 0;
  for (let run = 0; run < input.trials; run++) {
    let balance = input.initialCzk, failed = false;
    let marketIndex = 1, marketPeak = 1, worstMarketDrawdown = 0;
    annualValues[0].push(balance);
    if (input.retirementAfterYears === 0 && balance >= requiredRealCzk) goalHits++;
    for (let month = 1; month <= months; month++) {
      const gross = Math.exp(logDrift + sigma * gaussian());
      marketIndex *= gross;
      marketPeak = Math.max(marketPeak, marketIndex);
      worstMarketDrawdown = Math.max(worstMarketDrawdown, 1 - marketIndex / marketPeak);
      balance *= gross;
      if (month < retirementStartMonth) {
        balance += input.monthlyContributionCzk *
          Math.pow(savingsIncrease, Math.floor((month - 1) / 12));
      } else {
        const nominalWithdrawal = input.retirementIncomeMonthlyRealCzk * Math.pow(factor, month / 12);
        if (balance + 1e-8 < nominalWithdrawal) failed = true;
        balance = Math.max(0, balance - nominalWithdrawal);
      }
      if (!Number.isFinite(balance)) throw new RangeError("Výsledná hodnota simulace přesáhla podporovaný rozsah.");
      if (month === input.retirementAfterYears * 12 && input.retirementAfterYears > 0 &&
          balance / Math.pow(factor, month / 12) >= requiredRealCzk) goalHits++;
      if (month % 12 === 0) annualValues[month / 12].push(balance / Math.pow(factor, month / 12));
    }
    if (!failed) incomeFunded++;
    else exhausted++;
    finalValues.push(balance / Math.pow(factor, input.years));
    drawdowns.push(worstMarketDrawdown * 100);
  }
  const points: RetirementRiskYearPoint[] = annualValues.map((values, year) => {
    values.sort((a, b) => a - b);
    return { year, p10RealCzk: quantile(values, .1), medianRealCzk: quantile(values, .5), p90RealCzk: quantile(values, .9) };
  });
  finalValues.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  return {
    points, trials: input.trials,
    retirementGoalRealCzk: requiredRealCzk,
    retirementGoalHitPct: goalHits / input.trials * 100,
    incomeFundedPct: incomeFunded / input.trials * 100,
    exhaustedPaths: exhausted,
    medianFinalRealCzk: quantile(finalValues, .5),
    p10FinalRealCzk: quantile(finalValues, .1),
    p90FinalRealCzk: quantile(finalValues, .9),
    medianMarketMaxDrawdownPct: quantile(drawdowns, .5),
  };
}

/** Fixed compound-return counterfactual with one explicit market shock. */
export function stressRetirement(input: RetirementRiskInputs, shockYear: number, shockPct: number) {
  validateRetirementRisk(input);
  if (!Number.isInteger(shockYear) || shockYear < 1 || shockYear > input.years ||
      !finite(shockPct) || shockPct > 0 || shockPct < -100) {
    throw new RangeError("Nastav platný rok propadu a procento ztráty.");
  }
  const returnMonth = Math.pow(1 + input.expectedAnnualReturnPct / 100, 1 / 12);
  const factor = 1 + input.annualInflationPct / 100;
  const contributionGrowth = 1 + input.annualContributionIncreasePct / 100;
  let balance = input.initialCzk;
  const points = [{ year: 0, realCzk: balance }];
  let shortfallCzk = 0;
  for (let month = 1; month <= input.years * 12; month++) {
    balance *= returnMonth;
    if (month === shockYear * 12) balance *= 1 + shockPct / 100;
    if (month <= input.retirementAfterYears * 12) {
      balance += input.monthlyContributionCzk *
        Math.pow(contributionGrowth, Math.floor((month - 1) / 12));
    } else {
      const demanded = input.retirementIncomeMonthlyRealCzk * Math.pow(factor, month / 12);
      const paid = Math.min(balance, demanded);
      shortfallCzk += demanded - paid;
      balance -= paid;
    }
    if (month % 12 === 0) points.push({ year: month / 12, realCzk: balance / Math.pow(factor, month / 12) });
  }
  return { points, shortfallCzk };
}
