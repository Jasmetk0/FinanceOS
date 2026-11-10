import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ageOnDate, birthdayAtAge, isCalendarDate, isValidBirthDate,
  monthsUntilAge, monthsUntilDate,
} from "../lib/simulator/age.ts";
import { SIMULATOR_DEFAULTS, goalRealCzk, simulate } from "../lib/simulator/engine.ts";

function read(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("ages are based on actual birthday rather than calendar-year subtraction", () => {
  assert.equal(ageOnDate("2004-12-20", "2026-11-10"), 21);
  assert.equal(ageOnDate("2004-12-20", "2026-12-20"), 22);
  assert.equal(birthdayAtAge("2004-12-20", 40), "2044-12-20");
  assert.equal(monthsUntilAge("2004-12-20", 40, "2026-11-10"), 218);
  assert.equal(monthsUntilDate("2026-11-10", "2026-11-10"), 0);
  assert.equal(monthsUntilDate("2026-11-10", "2026-11-20"), 1);
  assert.equal(monthsUntilDate("2026-11-10", "2026-12-01"), 1);
  assert.equal(monthsUntilDate("2026-11-10", "2026-12-11"), 2);
});

test("Feb 29 birthdays roll to Feb 28 in a non-leap year", () => {
  assert.equal(birthdayAtAge("2000-02-29", 24), "2024-02-29");
  assert.equal(birthdayAtAge("2000-02-29", 25), "2025-02-28");
  assert.equal(ageOnDate("2000-02-29", "2024-02-28"), 23);
  assert.equal(ageOnDate("2000-02-29", "2025-02-28"), 25);
});

test("calendar and birth date validation rejects impossible and future dates", () => {
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2025-02-29"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
  assert.equal(isCalendarDate("2026-2-9"), false);
  assert.equal(isValidBirthDate("2004-12-20", "2026-11-10"), true);
  assert.equal(isValidBirthDate("2030-01-01", "2026-11-10"), false);
  assert.equal(isValidBirthDate("1899-12-31", "2026-11-10"), false);
  assert.throws(() => monthsUntilDate("2026-11-10", "2026-11-09"), RangeError);
  assert.throws(() => ageOnDate("2026-11-11", "2026-11-10"), RangeError);
});

test("FIRE target and nominal-vs-real projections share the existing engine", () => {
  const inputs = { ...SIMULATOR_DEFAULTS, initialCzk: 500_000,
    monthlyContributionCzk: 8_000, withdrawalRatePct: 3,
    targetMonthlyIncomeCzk: 50_000, annualInflationPct: 2.9 };
  const months = monthsUntilAge("2004-12-20", 40, "2026-11-10");
  assert.equal(goalRealCzk(inputs), 20_000_000);
  const projection = simulate(inputs, months);
  assert.ok(projection.last.nominalCzk > projection.last.realCzk);
  assert.ok(projection.goalRealCzk === 20_000_000);
  assert.ok(projection.last.realCzk * .03 / 12 >= 0);
});

test("local-only age settings do not mutate portfolio or allocation", () => {
  const route = read("app/api/age-goal/route.ts");
  const server = read("lib/server/age-goal.ts");
  const component = read("components/age-goal-planner.tsx");
  const simulator = read("components/financial-simulator.tsx");
  const history = read("app/history/page.tsx");
  assert.ok(route.includes("localOnly(request)"));
  assert.ok(route.includes("saveAgeGoalSettings"));
  assert.ok(server.includes("plan_settings"));
  assert.ok(server.includes("BEGIN IMMEDIATE;"));
  assert.ok(!server.includes("UPDATE holdings"));
  assert.ok(!server.includes("UPDATE accounts"));
  for (const id of ["age-goal-birth", "age-goal-target",
    "age-goal-monthly", "age-goal-withdrawal"]) {
    assert.ok(component.includes(id));
  }
  assert.ok(component.includes("simulate(inputs, maxMonths, events, rules)"));
  assert.ok(component.includes('fetch("/api/age-goal"'));
  assert.ok(simulator.includes("<AgeGoalPlanner"));
  assert.ok(history.includes("snapshotsByAge"));
  assert.ok(history.includes("Skutečně evidovaný majetek podle věku"));
});
