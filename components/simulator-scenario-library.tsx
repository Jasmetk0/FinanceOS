"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCENARIO_LIBRARY_KEY, addNamedScenario, parseScenarioLibrary, scenarioComparison,
  type FinancialScenario, type ScenarioLibrary,
} from "@/lib/simulator/scenarios";
import { durationLabel } from "@/lib/simulator/engine";

const EMPTY: ScenarioLibrary = { version: 3, records: [] };
const PALETTE = ["#7be6bc", "#80b8ff", "#f4c47c", "#d6acff"];
const money = (n: number | null) => n === null ? "—" : n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : "sim-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

export function SimulatorScenarioLibrary({
  scenario, onRestore,
}: {
  scenario: FinancialScenario;
  onRestore: (loaded: FinancialScenario) => void;
}) {
  const [library, setLibrary] = useState<ScenarioLibrary>(EMPTY);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("Nová varianta");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [horizon, setHorizon] = useState(40);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const fromV3 = localStorage.getItem(SCENARIO_LIBRARY_KEY);
        const legacy = localStorage.getItem("financeos-financial-simulator-v2") ??
          localStorage.getItem("financeos-financial-simulator-v1");
        const loaded = parseScenarioLibrary(fromV3, legacy);
        if (active) setLibrary(loaded);
      } catch (error) {
        if (active) setMessage("Uloženou knihovnu nelze bezpečně načíst: " +
          (error instanceof Error ? error.message : String(error)) +
          ". Původní data zůstala zachována.");
      } finally { if (active) setReady(true); }
    });
    return () => { active = false; };
  }, []);

  function persist(next: ScenarioLibrary) {
    localStorage.setItem(SCENARIO_LIBRARY_KEY, JSON.stringify(next));
    setLibrary(next);
  }

  function saveNew() {
    if (!ready) return;
    try {
      const timestamp = new Date().toISOString();
      const next = addNamedScenario(library, {
        id: newId(), name, createdAt: timestamp, updatedAt: timestamp,
        scenario: JSON.parse(JSON.stringify(scenario)) as FinancialScenario,
      });
      persist(next);
      setMessage("Nová varianta byla bezpečně uložena pouze do tohoto prohlížeče.");
    } catch (error) {
      setMessage("Uložení se nezdařilo: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  function remove(id: string) {
    const record = library.records.find((item) => item.id === id);
    if (!record || !window.confirm("Trvale smazat uloženou variantu „" + record.name + "“?")) return;
    try {
      persist({ version: 3, records: library.records.filter((item) => item.id !== id) });
      setSelected((previous) => previous.filter((x) => x !== id));
      setMessage("Varianta byla smazána. Aktuální rozpracovaná simulace zůstala beze změny.");
    } catch (error) {
      setMessage("Smazání se nezdařilo: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  function toggleCompare(id: string) {
    setSelected((previous) => previous.includes(id)
      ? previous.filter((x) => x !== id)
      : previous.length < 4 ? [...previous, id] : previous);
  }

  const comparison = useMemo(() => selected.map((id) => {
    const entry = library.records.find((item) => item.id === id);
    if (!entry) return null;
    try {
      return { id, name: entry.name, result: scenarioComparison(entry.scenario, horizon * 12) };
    } catch (error) {
      return { id, name: entry.name,
        result: { error: error instanceof Error ? error.message : String(error), points: [] as number[], firstGoalMonth: null, finalRealCzk: null } };
    }
  }).filter((x) => x !== null), [selected, library, horizon]);

  const viewW = 960, viewH = 300, l = 88, r = 20, t = 17, b = 40;
  const xScale = (year: number) => l + year / horizon * (viewW - l - r);
  const largest = Math.max(1, ...comparison.flatMap((item) => item.result.points));
  const yScale = (amount: number) => t + (1 - amount / (largest * 1.08)) * (viewH - t - b);
  const seriesPath = (points: number[]) => points.map((value, i) =>
    (i ? "L" : "M") + xScale(i).toFixed(2) + " " + yScale(value).toFixed(2)).join(" ");

  return (
    <section className="finance-surface p-4 sm:p-5" aria-labelledby="scenario-library-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="scenario-library-heading" className="text-base font-semibold">Knihovna finančních scénářů</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Ulož si různé výnosy, vklady, cíle a životní fáze. Každá varianta je samostatný neměnný snímek;
            načtení jedné nepřepisuje ostatní.
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">{ready ? library.records.length + " / 30 uložených" : "Načítám scénáře…"}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[180px] flex-1 text-[11px] font-medium text-[var(--muted)]" htmlFor="scenario-new-name">
          Název nové varianty
          <input id="scenario-new-name" className="finance-field mt-1 block w-full text-xs" maxLength={60} value={name}
            onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="button" disabled={!ready || library.records.length >= 30} className="finance-action finance-action-primary" onClick={saveNew}>
          + Uložit aktuální jako novou variantu
        </button>
      </div>

      <div className="finance-scrollbar mt-4 max-h-[340px] space-y-2 overflow-y-auto pr-1">
        {!library.records.length && ready ? <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">
          Zatím žádné uložené varianty. První uložíš tlačítkem výše.
        </p> : null}
        {library.records.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-3">
              <input type="checkbox" checked={selected.includes(entry.id)} onChange={() => toggleCompare(entry.id)} disabled={!selected.includes(entry.id) && selected.length >= 4} aria-label={"Porovnat " + entry.name}/>
              <span className="min-w-0">
                <strong className="block break-words text-xs">{entry.name}</strong>
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  Výnos {entry.scenario.inputs.annualReturnPct.toLocaleString("cs-CZ")} % ·
                  základní vklad {money(entry.scenario.inputs.monthlyContributionCzk)} · {entry.scenario.rules.length} pravidelných událostí
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <button type="button" className="finance-action !min-h-8 !px-3" onClick={() => {
                onRestore(JSON.parse(JSON.stringify(entry.scenario)) as FinancialScenario);
                setMessage("Varianta „" + entry.name + "“ načtena do editoru. Nyní ji můžeš upravovat bez změny uložené kopie.");
              }}>Načíst</button>
              <button type="button" className="finance-action !min-h-8 !px-3 text-[var(--warning)]" onClick={() => remove(entry.id)} aria-label={"Smazat variantu " + entry.name}>Smazat</button>
            </div>
          </div>
        ))}
      </div>

      {message ? <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-[var(--border)] bg-white/[.02] p-3 text-xs leading-5">{message}</p> : null}

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Porovnání uložených variant</h3>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Vyber 2–4 scénáře zaškrtnutím výše. Graf používá pouze dnešní kupní sílu.</p>
          </div>
          <label className="text-[11px] text-[var(--muted)]">Horizont grafu
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="finance-field ml-2 !min-h-8 !py-1.5 text-xs">
              {[10,20,30,40,50,60,80,100].map(y=><option key={y} value={y}>{y} let</option>)}
            </select>
          </label>
        </div>
        {comparison.length ? <>
          <div className="finance-chart-canvas mt-4 overflow-hidden p-2 sm:p-3">
            <svg viewBox={"0 0 " + viewW + " " + viewH} className="block w-full" role="img" aria-label="Porovnání reálných hodnot portfolia podle uložených variant">
              {[0,.25,.5,.75,1].map((n)=><g key={n}>
                <line x1={l} x2={viewW-r} y1={yScale(largest*1.08*n)} y2={yScale(largest*1.08*n)} stroke="rgba(190,211,239,.17)" strokeDasharray="3 4"/>
                <text x={l-10} y={yScale(largest*1.08*n)+4} fill="#a5b7ca" fontSize="12" textAnchor="end">
                  {(largest*1.08*n/1e6).toLocaleString("cs-CZ",{maximumFractionDigits:1})} mil.
                </text>
              </g>)}
              {[0,.25,.5,.75,1].map((n)=><text key={n} x={xScale(n*horizon)} y={viewH-9} fill="#a5b7ca" textAnchor="middle" fontSize="12">{Math.round(n*horizon)} let</text>)}
              {comparison.map((item,i)=>item.result.points.length ?
                <path key={item.id} d={seriesPath(item.result.points)} stroke={PALETTE[i]} strokeWidth="3" fill="none" strokeLinejoin="round"/>:null)}
            </svg>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {comparison.map((item,i)=>(
              <div key={item.id} className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
                <div className="flex items-center gap-2 text-xs font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{background:PALETTE[i]}}/>{item.name}</div>
                {item.result.error ? <p className="mt-2 text-xs text-[var(--warning)]">{item.result.error}</p> :
                <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                  Na konci období: <strong className="text-[var(--foreground)]">{money(item.result.finalRealCzk)}</strong>
                  {" · "}Cílový kapitál: {item.result.firstGoalMonth===null?"v tomto období nedosažen":
                    durationLabel(item.result.firstGoalMonth)}
                </p>}
              </div>
            ))}
          </div>
        </> : <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">Vyber uložené varianty pro vzájemné porovnání.</p>}
      </div>
      <p className="mt-4 text-[11px] leading-5 text-[var(--muted)]">
        Data knihovny zůstávají pouze v tomto prohlížeči (localStorage). Staré scénáře V1/V2 jsou při prvním otevření nabídnuty jako původní varianta.
        Graf je deterministický scénář, nikoliv zaručený výsledek ani pravděpodobnost dosažení cíle.
      </p>
    </section>
  );
}
