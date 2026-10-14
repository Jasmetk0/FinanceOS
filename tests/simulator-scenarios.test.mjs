import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIMULATOR_DEFAULTS } from "../lib/simulator/engine.ts";
import {
  SCENARIO_LIBRARY_LIMIT, addNamedScenario, parseScenarioLibrary,
  readLegacyScenario, scenarioComparison, validateFinancialScenario,
} from "../lib/simulator/scenarios.ts";

function scenario(overrides={}) {
  return { inputs: { ...SIMULATOR_DEFAULTS, ...overrides }, unknown:"years", events:[], rules:[], startAge:22 };
}
function item(id, name) {
  return {id,name,createdAt:"2026-10-14T10:00:00.000Z",updatedAt:"2026-10-14T10:00:00.000Z",scenario:scenario()};
}

test("new scenario library starts empty and legacy V1/V2 is offered as a named variant", () => {
  assert.deepEqual(parseScenarioLibrary(null,null),{version:3,records:[]});
  const old=JSON.stringify({inputs: { ...SIMULATOR_DEFAULTS },unknown:"years",events:[]});
  const v1=parseScenarioLibrary(null,old);
  assert.equal(v1.records.length,1);
  assert.equal(v1.records[0].scenario.startAge,22);
  assert.equal(v1.records[0].scenario.rules.length,0);
  const v2=readLegacyScenario(JSON.stringify({version:2,inputs:{...SIMULATOR_DEFAULTS},unknown:"years",startAge:21,events:[],rules:[]}));
  assert.equal(v2.startAge,21);
});

test("each named variant stores independent inputs and imposes finite maximum", () => {
  const first=item("one","Počáteční plán");
  const initial={version:3,records:[]};
  const one=addNamedScenario(initial,first);
  assert.equal(initial.records.length,0);
  assert.equal(one.records.length,1);
  assert.throws(()=>addNamedScenario(one,item("one","Duplicate ID")) ,/jedinečné/);
  assert.throws(()=>addNamedScenario(one,item("two"," ")),/jedinečné/);
  const many={version:3,records:Array.from({length:SCENARIO_LIBRARY_LIMIT},(_,i)=>item("item"+i,"Scénář "+i))};
  assert.throws(()=>addNamedScenario(many,item("extra","Limit")),/limitu/);
  assert.equal(parseScenarioLibrary(JSON.stringify(one),null).records[0].name,"Počáteční plán");
});

test("invalid imported data is never silently repaired into a plausible scenario", () => {
  assert.throws(()=>parseScenarioLibrary('{"version":99,"records":[]}',null),/nepodporovaný/);
  assert.throws(()=>validateFinancialScenario(scenario({annualReturnPct:-100})),/Zkontroluj/);
  assert.throws(()=>validateFinancialScenario(scenario({years:200})),/Horizont/);
  assert.throws(()=>validateFinancialScenario({...scenario(),unknown:"foo"}),/Neplatné/);
  assert.throws(()=>validateFinancialScenario({...scenario(),events:[{id:"x",month:1,amountCzk:100},{id:"x",month:2,amountCzk:200}]}),/Duplicitní/);
  assert.throws(()=>parseScenarioLibrary(JSON.stringify({version:3,records:[item("a","One"),item("a","Two")]}),null),/duplicitní/);
});

test("saved scenarios compare real portfolio trajectories without mixing target definitions", () => {
  const a=scenario();
  const b=scenario({ monthlyContributionCzk: 0 });
  const pa=scenarioComparison(a,600);
  const pb=scenarioComparison(b,600);
  assert.equal(pa.error,null);
  assert.equal(pb.error,null);
  assert.equal(pa.firstGoalMonth,422);
  assert.equal(pb.firstGoalMonth,523);
  assert.ok(pa.finalRealCzk>pb.finalRealCzk);
  assert.equal(pa.points.length,51);
  assert.equal(pa.points[0],500_000);
  assert.throws(()=>scenarioComparison(a,1201),/horizont/);
});

test("scenario UI exposes named variants, load and comparison controls", () => {
  const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const editor=read("components/financial-simulator.tsx");
  const manager=read("components/simulator-scenario-library.tsx");
  assert.ok(editor.includes("<SimulatorScenarioLibrary"));
  assert.ok(manager.includes("scenarioComparison(entry.scenario, horizon * 12)"));
  assert.ok(manager.includes("Původní uložený scénář") || read("lib/simulator/scenarios.ts").includes("Původní uložený scénář"));
  assert.ok(manager.includes("financeos-financial-simulator-v2"));
  assert.ok(manager.includes("addNamedScenario(library"));
});
