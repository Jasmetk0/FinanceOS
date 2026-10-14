import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIMULATOR_DEFAULTS, simulate, solve } from "../lib/simulator/engine.ts";
import { periodFromAges, timelineMonthFlows, validateTimelineRules } from "../lib/simulator/timeline.ts";

function flat(overrides = {}) {
  return { ...SIMULATOR_DEFAULTS, initialCzk: 0, monthlyContributionCzk: 100, annualReturnPct: 0, annualInflationPct: 0, ...overrides };
}
function rule(id, kind, startMonth, endMonth, amountCzk, annualIncreasePct = 0) {
  return { id, label: id, kind, startMonth, endMonth, amountCzk, annualIncreasePct };
}

test("phases replace rather than double-count the base monthly investment", () => {
  const phases = [rule("early", "contribution", 1, 12, 200), rule("later", "contribution", 13, 24, 0)];
  const result = simulate(flat(), 36, [], phases);
  assert.equal(result.points[0].monthlyDepositCzk, 0);
  assert.equal(result.points[1].monthlyDepositCzk, 200);
  assert.equal(result.points[12].monthlyDepositCzk, 200);
  assert.equal(result.points[13].monthlyDepositCzk, 0);
  assert.equal(result.points[24].monthlyDepositCzk, 0);
  assert.equal(result.points[25].monthlyDepositCzk, 100);
  assert.equal(result.last.nominalCzk, 3600);
  assert.equal(result.last.paidInCzk, 3600);
});

test("extra deposits, withdrawals and one-offs layer deterministically", () => {
  const rules = [
    rule("phase1", "contribution", 1, 12, 200),
    rule("phase2", "contribution", 13, 24, 0),
    rule("extra", "deposit", 6, 18, 50),
    rule("expense", "withdrawal", 12, 24, 40),
  ];
  const events = [{ id: "bonus", month: 3, amountCzk: 100 }, { id: "purchase", month: 24, amountCzk: -50 }];
  const result = simulate(flat(), 24, events, rules);
  assert.equal(result.last.paidInCzk, 3150);
  assert.equal(result.last.withdrawnCzk, 570);
  assert.equal(result.last.nominalCzk, 2580);
  assert.equal(result.last.monthlyDepositCzk, 0);
  assert.equal(result.last.monthlyWithdrawalCzk, 90);
  assert.equal(result.last.shortfallCzk, 0);
});

test("annual increase begins after twelve full months of the selected phase", () => {
  const growth = [rule("growing", "contribution", 1, 24, 100, 100)];
  const result = simulate(flat(), 24, [], growth);
  assert.equal(result.points[12].monthlyDepositCzk, 100);
  assert.equal(result.points[13].monthlyDepositCzk, 200);
  assert.equal(result.last.nominalCzk, 3600);
});

test("cannot silently overlap contribution overrides but can stack extra deposits", () => {
  const first = rule("x", "contribution", 1, 20, 100);
  assert.throws(() => validateTimelineRules([first, rule("y", "contribution", 20, 30, 200)]), /překrývají/);
  assert.throws(() => simulate(flat(), 30, [], [first, rule("y", "contribution", 20, 30, 200)]), /překrývají/);
  assert.doesNotThrow(() => validateTimelineRules([first, rule("y", "deposit", 20, 30, 200)]));
  assert.throws(() => validateTimelineRules([rule("x", "deposit", 1, 12, -1)]), /neplatné/);
  assert.throws(() => validateTimelineRules([rule("x", "deposit", 0, 13, 100)]), /neplatné/);
  assert.throws(() => validateTimelineRules([rule("x", "deposit", 1, 12, 100, -100)]), /neplatné/);
  assert.throws(() => validateTimelineRules([first, first]), /neplatné/);
});

test("withdrawals never create negative balances and shortfall is explicit", () => {
  const result = simulate(flat({ monthlyContributionCzk: 0 }), 2, [], [
    rule("expense", "withdrawal", 1, 2, 100),
  ]);
  assert.equal(result.last.nominalCzk, 0);
  assert.equal(result.last.withdrawnCzk, 0);
  assert.equal(result.last.shortfallCzk, 200);
  assert.equal(result.points[2].monthlyShortfallCzk, 100);
});

test("age intervals are inclusive at start, exclusive at end", () => {
  assert.deepEqual(periodFromAges(22, 22, 25), { startMonth: 1, endMonth: 36 });
  assert.deepEqual(periodFromAges(22, 25, 30), { startMonth: 37, endMonth: 96 });
  assert.deepEqual(periodFromAges(22, 121, 122), { startMonth: 1189, endMonth: 1200 });
  assert.throws(() => periodFromAges(22, 24, 24));
  assert.throws(() => periodFromAges(22, 21, 23));
  assert.throws(() => periodFromAges(22, 121, 123));
});

test("solvers consistently respect recurring rule overrides", () => {
  const plans = [rule("override", "contribution", 1, 24, 100)];
  const input = flat({ monthlyContributionCzk: 0, years: 2, withdrawalRatePct: 3, targetMonthlyIncomeCzk: 6 });
  assert.equal(solve(input, "years", [], plans).value, 2);
  assert.equal(solve(input, "initialCzk", [], plans).value, 0);
  assert.equal(solve(input, "targetMonthlyIncomeCzk", [], plans).value, 6);
  // Baseline monthly contribution is completely overridden for the chosen
  // horizon; don't report a made-up solution when changing it has no effect.
  const unreachable = solve({ ...input, targetMonthlyIncomeCzk: 100 }, "monthlyContributionCzk", [], plans);
  assert.equal(unreachable.value, null);
  assert.match(unreachable.error, /nelze najít řešení/);
  assert.equal(timelineMonthFlows(plans, 25).contributionOverrideCzk, null);
});

test("life editor and versioned browser storage are connected", () => {
  const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const source = read("components/financial-simulator.tsx");
  const editor = read("components/life-timeline-editor.tsx");
  assert.ok(source.includes("<LifeTimelineEditor"));
  assert.ok(source.includes('"financeos-financial-simulator-v2"'));
  assert.ok(source.includes('"financeos-financial-simulator-v1"'), "Legacy scenario must remain readable");
  assert.ok(source.includes("simulate(restored, 0, restoredEvents, restoredRules)"));
  assert.ok(editor.includes("validateTimelineRules(next)"));
  assert.ok(editor.includes("periodFromAges(startAge, start, end)"));
  assert.ok(editor.includes("Věk při začátku simulace"));
});
