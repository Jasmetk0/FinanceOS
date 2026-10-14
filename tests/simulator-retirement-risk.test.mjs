import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RETIREMENT_RISK_DEFAULTS, runRetirementMonteCarlo, stressRetirement, validateRetirementRisk,
} from "../lib/simulator/risk.ts";

function config(changes={}) {
  return { ...RETIREMENT_RISK_DEFAULTS, years:10, retirementAfterYears:5, trials:100, ...changes };
}

test("same seed and inputs produce byte-for-byte identical simulated distributions", () => {
  const input=config();
  const first=runRetirementMonteCarlo(input);
  assert.deepEqual(first,runRetirementMonteCarlo(input));
  assert.notDeepEqual(first.points,runRetirementMonteCarlo({...input,seed:123}).points);
});

test("zero volatility yields deterministic percentile paths", () => {
  const r=runRetirementMonteCarlo(config({
    annualVolatilityPct:0,retirementIncomeMonthlyRealCzk:0,annualInflationPct:0,
  }));
  assert.equal(r.points.length,11);
  for(const p of r.points) {
    assert.equal(p.p10RealCzk,p.medianRealCzk);
    assert.equal(p.medianRealCzk,p.p90RealCzk);
  }
  assert.equal(r.incomeFundedPct,100);
  assert.equal(r.exhaustedPaths,0);
  assert.equal(r.medianMarketMaxDrawdownPct,0);
});

test("withdrawals without capital fail, not silently disappear", () => {
  const r=runRetirementMonteCarlo(config({
    initialCzk:0, monthlyContributionCzk:0,
    expectedAnnualReturnPct:0, annualVolatilityPct:0, retirementAfterYears:0,
    retirementIncomeMonthlyRealCzk:1000, years:2,
  }));
  assert.equal(r.incomeFundedPct,0);
  assert.equal(r.retirementGoalHitPct,0);
  assert.equal(r.exhaustedPaths,100);
  assert.equal(r.medianFinalRealCzk,0);
});

test("immediate retirement funded at a sufficient initial portfolio is recognized", () => {
  const r=runRetirementMonteCarlo(config({
    initialCzk:1_000_000,monthlyContributionCzk:0,retirementAfterYears:0,
    annualVolatilityPct:0, expectedAnnualReturnPct:0,
    retirementIncomeMonthlyRealCzk:1000, annualInflationPct:0,
    goalWithdrawalRatePct:5,years:5,
  }));
  assert.equal(r.retirementGoalHitPct,100);
  assert.equal(r.incomeFundedPct,100);
  assert.ok(r.medianFinalRealCzk>0);
});

test("stressed crash changes deterministic end value and shortfall is explicit", () => {
  const input=config({ annualVolatilityPct:0, retirementIncomeMonthlyRealCzk:0 });
  const baseline=stressRetirement(input,3,0);
  const crash=stressRetirement(input,3,-50);
  assert.ok(crash.points.at(-1).realCzk<baseline.points.at(-1).realCzk);
  assert.equal(crash.shortfallCzk,0);
  assert.equal(crash.points.length,input.years+1);
});

test("rejects nonsensical and excessive model inputs", () => {
  assert.throws(()=>validateRetirementRisk(config({annualVolatilityPct:-1})),/Zkontroluj/);
  assert.throws(()=>validateRetirementRisk(config({retirementAfterYears:10})),/Zkontroluj/);
  assert.throws(()=>validateRetirementRisk(config({trials:1})),/Zkontroluj/);
  assert.throws(()=>runRetirementMonteCarlo(config({expectedAnnualReturnPct:-100})),/Zkontroluj/);
  assert.throws(()=>stressRetirement(config(),0,-20),/platný rok/);
  assert.throws(()=>stressRetirement(config(),1,20),/procento/);
});

test("risk view remains separate from provider ledger and linked from base simulator", () => {
  const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  assert.ok(read("app/simulator/page.tsx").includes('href="/simulator/risk"'));
  assert.ok(read("app/simulator/risk/page.tsx").includes("<RetirementRiskSimulator />"));
  assert.ok(read("components/retirement-risk-simulator.tsx").includes("runRetirementMonteCarlo(inputs)"));
  assert.ok(!read("components/retirement-risk-simulator.tsx").includes('fetch('));
});
