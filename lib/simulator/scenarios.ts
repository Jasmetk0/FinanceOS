import { SIMULATOR_DEFAULTS, simulate, solve, type SimulatorEvent, type SimulatorInputs, type SolveKey } from "./engine.ts";
import { validateTimelineRules, type TimelineRule } from "./timeline.ts";

export const SCENARIO_LIBRARY_KEY = "financeos-simulator-scenarios-v3";
export const SCENARIO_LIBRARY_LIMIT = 30;
const KEYS: SolveKey[] = ["years", "initialCzk", "monthlyContributionCzk", "annualReturnPct", "targetMonthlyIncomeCzk"];

export interface FinancialScenario {
  inputs: SimulatorInputs;
  unknown: SolveKey;
  events: SimulatorEvent[];
  rules: TimelineRule[];
  startAge: number;
}

export interface NamedFinancialScenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scenario: FinancialScenario;
}

export interface ScenarioLibrary {
  version: 3;
  records: NamedFinancialScenario[];
}

export function validateFinancialScenario(value: FinancialScenario): void {
  if (!value || typeof value !== "object" || !value.inputs ||
    !KEYS.includes(value.unknown) || !Array.isArray(value.events) ||
    value.events.length > 40 || !Array.isArray(value.rules) ||
    !Number.isInteger(value.startAge) || value.startAge < 0 || value.startAge > 100) {
    throw new RangeError("Neplatné nastavení finančního scénáře.");
  }
  if (!Number.isFinite(value.inputs.years) || value.inputs.years < 0 || value.inputs.years > 100) {
    throw new RangeError("Horizont scénáře musí být mezi 0 a 100 lety.");
  }
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!event || typeof event.id !== "string" || !event.id.trim() || ids.has(event.id)) {
      throw new RangeError("Duplicitní nebo neplatné jednorázové události.");
    }
    ids.add(event.id);
  }
  validateTimelineRules(value.rules);
  // Same validation as the deterministic engine, even for unsolved scenarios.
  simulate(value.inputs, 0, value.events, value.rules);
}

export function readLegacyScenario(raw: string): FinancialScenario {
  const record: unknown = JSON.parse(raw);
  if (!record || typeof record !== "object") throw new RangeError("Starý scénář neobsahuje platný objekt.");
  const old = record as Partial<FinancialScenario> & { version?: number };
  if (old.version !== undefined && old.version !== 2) throw new RangeError("Nepodporovaná stará verze.");
  const result: FinancialScenario = {
    inputs: { ...SIMULATOR_DEFAULTS, ...old.inputs },
    unknown: old.unknown ?? "years",
    events: old.events ?? [],
    rules: old.rules ?? [],
    startAge: old.startAge ?? 22,
  };
  validateFinancialScenario(result);
  return result;
}

export function parseScenarioLibrary(serialized: string | null, legacy: string | null): ScenarioLibrary {
  if (!serialized) {
    if (!legacy) return { version: 3, records: [] };
    const scenario = readLegacyScenario(legacy);
    return {
      version: 3,
      records: [{ id: "legacy-v2", name: "Původní uložený scénář", createdAt: "2026-10-14T00:00:00.000Z",
        updatedAt: "2026-10-14T00:00:00.000Z", scenario }],
    };
  }
  const data: unknown = JSON.parse(serialized);
  if (!data || typeof data !== "object") throw new RangeError("Neplatná knihovna scénářů.");
  const object = data as ScenarioLibrary;
  if (object.version !== 3 || !Array.isArray(object.records) || object.records.length > SCENARIO_LIBRARY_LIMIT) {
    throw new RangeError("Knihovna má nepodporovaný formát.");
  }
  const seen = new Set<string>();
  for (const record of object.records) {
    if (!record || typeof record.id !== "string" || !record.id.trim() ||
      seen.has(record.id) || typeof record.name !== "string" ||
      !record.name.trim() || record.name.length > 60 ||
      typeof record.createdAt !== "string" || typeof record.updatedAt !== "string") {
      throw new RangeError("Knihovna obsahuje duplicitní nebo neplatně pojmenovaný scénář.");
    }
    seen.add(record.id);
    validateFinancialScenario(record.scenario);
  }
  return object;
}

export function addNamedScenario(library: ScenarioLibrary, record: NamedFinancialScenario): ScenarioLibrary {
  validateFinancialScenario(record.scenario);
  if (!record.name.trim() || record.name.trim().length > 60 ||
    !record.id.trim() || library.records.some((existing) => existing.id === record.id)) {
    throw new RangeError("Scénář musí mít jedinečné ID a název do 60 znaků.");
  }
  if (library.records.length >= SCENARIO_LIBRARY_LIMIT) {
    throw new RangeError("Dosáhl jsi limitu 30 uložených variant.");
  }
  return { version: 3, records: [...library.records, { ...record, name: record.name.trim() }] };
}

export function scenarioComparison(scenario: FinancialScenario, displayMonths: number) {
  validateFinancialScenario(scenario);
  if (!Number.isInteger(displayMonths) || displayMonths < 1 || displayMonths > 1_200) {
    throw new RangeError("Neplatný horizont srovnání.");
  }
  const solved = solve(scenario.inputs, scenario.unknown, scenario.events, scenario.rules);
  if (solved.error || solved.value === null) return { error: solved.error || "Scénář nelze dopočítat.", points: [] as number[], firstGoalMonth: null as number | null, finalRealCzk: null as number | null };
  const active = { ...scenario.inputs, [scenario.unknown]: solved.value };
  const forecast = simulate(active, displayMonths, scenario.events, scenario.rules);
  return {
    error: null,
    points: forecast.points.filter((p) => p.month % 12 === 0 || p.month === displayMonths).map((p) => p.realCzk),
    firstGoalMonth: forecast.firstGoalMonth,
    finalRealCzk: forecast.last.realCzk,
  };
}
