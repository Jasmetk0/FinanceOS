import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIMULATOR_DEFAULTS, simulate, solve, durationLabel } from "../lib/simulator/engine.ts";

const defaults = { ...SIMULATOR_DEFAULTS };

test("FIRE target is 20 million real CZK and no-contribution crossing is 43 years 7 months", () => {
  const result = solve({ ...defaults, monthlyContributionCzk: 0 }, "years");
  assert.equal(Math.round(result.value * 12), 523);
  assert.equal(simulate(defaults, 0).goalRealCzk, 20_000_000);
});

test("5000 CZK monthly crosses after 35 years and 2 months", () => {
  const result = solve(defaults, "years");
  assert.equal(result.error, null);
  assert.equal(Math.round(result.value * 12), 422);
  assert.equal(durationLabel(422), "35 let 2 měsíců");
  const previous = simulate(defaults, 421).last;
  const reached = simulate(defaults, 422).last;
  assert.ok(previous.realCzk < 20_000_000);
  assert.ok(reached.realCzk >= 20_000_000);
});

test("indexed deposits reach goal sooner than fixed nominal deposits", () => {
  const indexed = solve({ ...defaults, annualContributionIncreasePct: 2.9 }, "years");
  assert.equal(Math.round(indexed.value * 12), 404);
});

test("inverse solver finds monthly amount at a chosen horizon", () => {
  const input = { ...defaults, years: 20 };
  const result = solve(input, "monthlyContributionCzk");
  assert.equal(result.error, null);
  assert.ok(result.value > 0);
  assert.ok(simulate({ ...input, monthlyContributionCzk: result.value }, 240).last.realCzk >= 20_000_000 - 0.01);
});

test("inverse solver finds initial capital, required annual return and possible income", () => {
  const baseline = { ...defaults, years: 30 };
  const initial = solve(baseline, "initialCzk");
  assert.ok(initial.value >= 0);
  assert.ok(simulate({ ...baseline, initialCzk: initial.value }, 360).last.realCzk >= 20_000_000 - 0.01);
  const rate = solve(baseline, "annualReturnPct");
  assert.ok(rate.value > 0 && rate.value < 300);
  assert.ok(simulate({ ...baseline, annualReturnPct: rate.value }, 360).last.realCzk >= 20_000_000 - 0.01);
  const income = solve(baseline, "targetMonthlyIncomeCzk");
  assert.ok(income.value > 0);
  assert.ok(Math.abs(income.value - simulate(baseline, 360).last.realCzk * 0.03 / 12) < 0.01);
});

test("event deposits increase capital and withdrawals cannot silently create debt", () => {
  const base = { ...defaults, initialCzk: 0, monthlyContributionCzk: 0, annualReturnPct: 0 };
  const events = [{ id: "a", month: 12, amountCzk: 100_000 }, { id: "b", month: 24, amountCzk: -150_000 }];
  const result = simulate(base, 24, events);
  assert.equal(result.last.nominalCzk, 0);
  assert.equal(result.last.paidInCzk, 100_000);
  assert.equal(result.last.withdrawnCzk, 100_000);
  assert.equal(result.last.shortfallCzk, 50_000);
});

test("rejects invalid rates and reports unreachable 100-year targets", () => {
  assert.throws(() => simulate({ ...defaults, annualReturnPct: -100 }, 12), RangeError);
  assert.throws(() => simulate(defaults, 1201), RangeError);
  const impossible = solve({ ...defaults, initialCzk: 0, monthlyContributionCzk: 0, annualReturnPct: 0 }, "years");
  assert.equal(impossible.value, null);
  assert.match(impossible.error, /100 let/);
});

test("simulator is navigable, local-first and keeps the existing plan separate", () => {
  const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const shell = read("components/app-shell.tsx");
  const route = read("app/simulator/page.tsx");
  const client = read("components/financial-simulator.tsx");
  assert.ok(shell.includes('href: "/simulator"'));
  assert.ok(route.includes("<FinancialSimulator trackedPortfolioCzk={trackedPortfolioCzk} />"));
  assert.ok(client.includes('"financeos-financial-simulator-v1"'));
  assert.ok(client.includes("Převzít evidované portfolio"));
  assert.ok(client.includes('onClick={() => setReal(false)}'));
  assert.ok(!client.includes('fetch("/api/plan"'));
});
