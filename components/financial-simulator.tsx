"use client";

import { useMemo, useState } from "react";
import {
  SIMULATOR_DEFAULTS, durationLabel, goalRealCzk, simulate, solve,
  type SimulatorEvent, type SimulatorInputs, type SolveKey,
} from "@/lib/simulator/engine";

type FieldKey = keyof SimulatorInputs;
const solveKeys: SolveKey[] = ["years", "initialCzk", "monthlyContributionCzk", "annualReturnPct", "targetMonthlyIncomeCzk"];
const fields: Array<{ key: FieldKey; label: string; unit: string; step: number; min: number }> = [
  { key: "initialCzk", label: "Počáteční portfolio", unit: "Kč", step: 10000, min: 0 },
  { key: "annualReturnPct", label: "Roční zhodnocení", unit: "%", step: .1, min: -99.9 },
  { key: "annualInflationPct", label: "Roční inflace", unit: "%", step: .1, min: -99.9 },
  { key: "monthlyContributionCzk", label: "Měsíční vklad", unit: "Kč", step: 500, min: 0 },
  { key: "annualContributionIncreasePct", label: "Roční růst vkladů", unit: "%", step: .1, min: -99.9 },
  { key: "withdrawalRatePct", label: "Roční míra výběru", unit: "%", step: .1, min: .1 },
  { key: "targetMonthlyIncomeCzk", label: "Cílový měsíční příjem dnes", unit: "Kč", step: 1000, min: 0 },
  { key: "years", label: "Investiční horizont", unit: "let", step: 1, min: 0 },
];

const money = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
const number = (value: number, digits = 1) => value.toLocaleString("cs-CZ", { maximumFractionDigits: digits });
const compact = (value: number) =>
  Math.abs(value) >= 1_000_000 ? number(value / 1_000_000, 1) + " mil." :
  Math.abs(value) >= 1000 ? number(value / 1000, 0) + " tis." : number(value, 0);

function ProjectionChart({
  points, target, real, selectedMonth, onSelect,
}: {
  points: ReturnType<typeof simulate>["points"];
  target: number;
  real: boolean;
  selectedMonth: number;
  onSelect: (month: number) => void;
}) {
  const width = 980, height = 318, left = 78, right = 18, top = 18, bottom = 40;
  const w = width - left - right, h = height - top - bottom;
  const maxMonth = Math.max(1, points.length - 1);
  const values = points.map((p) => real ? p.realCzk : p.nominalCzk);
  const targets = points.map((p) => real ? target : p.targetNominalCzk);
  const maximum = Math.max(1, ...values, ...targets) * 1.08;
  const x = (month: number) => left + month / maxMonth * w;
  const y = (amount: number) => top + h - amount / maximum * h;
  const line = (series: number[]) => series.map((value, i) =>
    (i ? "L" : "M") + x(i).toFixed(2) + " " + y(value).toFixed(2)).join(" ");
  const path = line(values);
  const activeIndex = Math.max(0, Math.min(selectedMonth, points.length - 1));
  const active = points[activeIndex];
  if (!active) return null;

  return (
    <div className="space-y-3">
      <div className="finance-chart-canvas overflow-hidden p-2 sm:p-3">
        <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label="Vývoj hodnoty portfolia a cíle v čase" className="block w-full">
          <defs>
            <linearGradient id="simulator-projection-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7be6bc" stopOpacity=".24" />
              <stop offset="100%" stopColor="#7be6bc" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0,.25,.5,.75,1].map((v) => (
            <g key={v}>
              <line x1={left} x2={width-right} y1={y(maximum*v)} y2={y(maximum*v)} stroke="rgba(200,220,245,.13)" strokeDasharray="4 5" />
              <text x={left-12} y={y(maximum*v)+4} fill="#a5b7ca" fontSize="12" textAnchor="end">{compact(maximum*v)}</text>
            </g>
          ))}
          {[0,.25,.5,.75,1].map((v) => (
            <text key={v} x={x(maxMonth*v)} y={height-12} fontSize="12" fill="#a5b7ca" textAnchor="middle">{number(maxMonth*v/12,0)} l.</text>
          ))}
          <path d={path + " L" + x(maxMonth) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z"} fill="url(#simulator-projection-fill)" />
          <path d={line(targets)} stroke="#f4c47c" strokeWidth="2" fill="none" strokeDasharray="7 7" />
          <path d={path} stroke="#7be6bc" strokeWidth="3" strokeLinejoin="round" fill="none" />
          <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={top+h} stroke="rgba(255,255,255,.35)" strokeDasharray="3 4" />
          <circle cx={x(activeIndex)} cy={y(values[activeIndex])} r="6" fill="#7be6bc" stroke="#0a1422" strokeWidth="3" />
        </svg>
      </div>
      <label htmlFor="simulator-chart-scrub" className="flex items-center justify-between gap-3 text-xs">
        <span className="text-[var(--muted)]">Prozkoumat měsíc</span>
        <strong>{durationLabel(active.month)} · {money(real ? active.realCzk : active.nominalCzk)}</strong>
      </label>
      <input id="simulator-chart-scrub" className="w-full accent-[var(--accent)]" type="range" min="0" max={maxMonth} step="1" value={activeIndex} onChange={(e) => onSelect(Number(e.target.value))} />
      <div className="flex flex-wrap gap-4 text-[11px] text-[var(--muted)]">
        <span><span className="mr-1 text-[var(--accent)]">━━</span> Portfolio</span>
        <span><span className="mr-1 text-[var(--warning)]">┄┄</span> Cílové portfolio</span>
      </div>
    </div>
  );
}

export function FinancialSimulator({ trackedPortfolioCzk }: { trackedPortfolioCzk: number | null }) {
  const [inputs, setInputs] = useState<SimulatorInputs>({ ...SIMULATOR_DEFAULTS });
  const [unknown, setUnknown] = useState<SolveKey>("years");
  const [events, setEvents] = useState<SimulatorEvent[]>([]);
  const [eventYear, setEventYear] = useState("5");
  const [eventAmount, setEventAmount] = useState("100000");
  const [real, setReal] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [message, setMessage] = useState("");

  const answer = useMemo(() => solve(inputs, unknown, events), [inputs, unknown, events]);
  const derived = useMemo<SimulatorInputs>(() => answer.value === null ? inputs : { ...inputs, [unknown]: answer.value }, [inputs, unknown, answer.value]);
  const projectedMonths = unknown === "years" && answer.value !== null
    ? Math.min(1200, Math.round(answer.value * 12) + 12)
    : Math.max(0, Math.min(1200, Math.round(inputs.years * 12)));
  const forecast = useMemo(() => {
    try { return simulate(derived, projectedMonths, events); }
    catch { return null; }
  }, [derived, projectedMonths, events]);
  const yearComparisons = useMemo(() => [0, 5000, 10000, 20000].map((monthly) => ({
    monthly,
    result: solve({ ...derived, monthlyContributionCzk: monthly }, "years", events),
  })), [derived, events]);

  function chooseUnknown(key: SolveKey) {
    if (key === unknown) return;
    if (answer.value !== null) setInputs((current) => ({ ...current, [unknown]: answer.value }));
    setUnknown(key);
    setMessage("");
  }

  function setField(key: FieldKey, value: string) {
    setInputs((current) => ({ ...current, [key]: Number(value) }));
    setMessage("");
  }

  function addEvent() {
    const month = Math.round(Number(eventYear) * 12);
    const amountCzk = Number(eventAmount);
    if (!Number.isInteger(month) || month < 1 || month > 1200 || !Number.isFinite(amountCzk) || amountCzk === 0) {
      setMessage("Zadej platný rok (0–100) a nenulovou částku události.");
      return;
    }
    if (events.length >= 40) { setMessage("Maximum je 40 událostí na scénář."); return; }
    setEvents((current) => [...current, { id: String(Date.now()) + "-" + current.length, month, amountCzk }].sort((a,b) => a.month-b.month));
    setMessage("");
  }

  function saveScenario() {
    try {
      window.localStorage.setItem("financeos-financial-simulator-v1", JSON.stringify({ inputs, unknown, events }));
      setMessage("Scénář byl uložen pouze do tohoto prohlížeče.");
    } catch {
      setMessage("Prohlížeč nedovolil uložit scénář.");
    }
  }

  function loadScenario() {
    try {
      const raw = window.localStorage.getItem("financeos-financial-simulator-v1");
      if (!raw) { setMessage("Zatím nemáš uložený scénář."); return; }
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") throw new Error("Neplatný soubor");
      const entry = value as { inputs?: Partial<SimulatorInputs>; unknown?: SolveKey; events?: SimulatorEvent[] };
      const restored = { ...SIMULATOR_DEFAULTS, ...entry.inputs };
      simulate(restored, 0, Array.isArray(entry.events) ? entry.events : []);
      if (!solveKeys.includes(entry.unknown as SolveKey)) throw new Error("Neplatný dopočet");
      setInputs(restored);
      setUnknown(entry.unknown as SolveKey);
      setEvents(Array.isArray(entry.events) ? entry.events.slice(0, 40) : []);
      setMessage("Uložený scénář načten.");
    } catch {
      setMessage("Uložený scénář je neplatný a nebyl načten.");
    }
  }

  const resultLabel = unknown === "years" && answer.value !== null
    ? durationLabel(Math.round(answer.value * 12))
    : answer.value === null ? "—"
    : unknown === "annualReturnPct" ? number(answer.value, 2) + " %"
    : money(answer.value);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-[var(--muted)]">Vyber „Dopočítat“ u jedné proměnné. Ostatní hodnoty jsou pevné předpoklady.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="finance-action" onClick={loadScenario}>Načíst scénář</button>
          <button type="button" className="finance-action finance-action-primary" onClick={saveScenario}>Uložit scénář</button>
        </div>
      </div>
      <section className="finance-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Proměnné simulace</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Jedno aktivní dopočítávání, všechny ostatní hodnoty uzamčené</p>
          </div>
          {trackedPortfolioCzk !== null && Number.isFinite(trackedPortfolioCzk) && trackedPortfolioCzk > 0 ? (
            <button type="button" className="finance-action" onClick={() => {
              setInputs((current) => ({ ...current, initialCzk: trackedPortfolioCzk }));
              if (unknown === "initialCzk") setUnknown("years");
              setMessage("Evidovaná hodnota načtena jako počáteční kapitál. Ostatní nastavení zůstalo beze změny.");
            }}>Převzít evidované portfolio: {money(trackedPortfolioCzk)}</button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {fields.map((field) => {
            const isUnknown = field.key === unknown;
            const canSolve = solveKeys.includes(field.key as SolveKey);
            const shown = isUnknown ? answer.value : inputs[field.key];
            return (
              <div key={field.key} className={["rounded-[16px] border p-3", isUnknown ? "border-[var(--accent)]/45 bg-[var(--accent)]/[.065]" : "border-[var(--border)] bg-white/[.025]"].join(" ")}>
                <div className="flex min-h-8 items-start justify-between gap-2">
                  <label htmlFor={"sim-" + field.key} className="text-[11px] font-semibold leading-4 text-[var(--muted)]">{field.label}</label>
                  {canSolve ? (
                    <button type="button" aria-label={isUnknown ? "Právě dopočítáváno: " + field.label : "Dopočítat: " + field.label} aria-pressed={isUnknown} onClick={() => chooseUnknown(field.key as SolveKey)} className={["shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold", isUnknown ? "border-[var(--accent)]/35 text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)] hover:text-white"].join(" ")}>{isUnknown ? "∑ Dopočítat" : "🔒"}</button>
                  ) : <span title="Pevný předpoklad" className="text-[11px] text-[var(--muted)]">🔒</span>}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input id={"sim-" + field.key} type="number" step={field.step} min={field.min}
                    max={field.key === "years" ? 100 : field.key === "annualReturnPct" ? 300 : undefined}
                    value={shown === null ? "" : isUnknown ? Number(shown.toFixed(field.key === "years" ? 3 : 2)) : shown}
                    readOnly={isUnknown}
                    onChange={(e) => setField(field.key, e.target.value)}
                    aria-invalid={!isUnknown && (!Number.isFinite(inputs[field.key]) || inputs[field.key] < field.min)}
                    className={["finance-field !min-h-9 min-w-0 w-full !px-2 !py-1.5 text-right text-sm font-semibold tabular-nums", isUnknown ? "!border-[var(--accent)]/20 !bg-transparent text-[var(--accent)]" : ""].join(" ")} />
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">{field.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="finance-surface p-4">
          <p className="text-[11px] font-medium text-[var(--muted)]">Vypočítaná proměnná</p>
          <p aria-live="polite" className="mt-2 text-xl font-semibold tabular-nums text-[var(--accent)] sm:text-2xl">{resultLabel}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{fields.find((field) => field.key === unknown)?.label}</p>
        </div>
        <div className="finance-surface p-4">
          <p className="text-[11px] font-medium text-[var(--muted)]">Potřebné portfolio v dnešních Kč</p>
          <p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{money(goalRealCzk(derived))}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Cílový příjem × 12 ÷ míra výběru</p>
        </div>
        <div className="finance-surface p-4">
          <p className="text-[11px] font-medium text-[var(--muted)]">Portfolio na konci zobrazeného období</p>
          <p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{forecast ? money(real ? forecast.last.realCzk : forecast.last.nominalCzk) : "—"}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{real ? "Dnešní kupní síla" : "Nominální budoucí koruny"}</p>
        </div>
      </section>

      {answer.error ? <p role="alert" className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.06] p-3 text-sm text-[var(--warning)]">{answer.error}</p> : null}
      {message ? <p role="status" aria-live="polite" className="rounded-xl border border-[var(--border)] bg-white/[.03] p-3 text-xs text-[var(--muted)]">{message}</p> : null}

      <section className="finance-surface finance-chart p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold">Vývoj portfolia</h2><p className="mt-1 text-xs text-[var(--muted)]">Měsíční výpočet · vklady na konci měsíce · efektivní roční sazby</p></div>
          <div role="group" aria-label="Kupní síla" className="flex rounded-xl border border-[var(--border)] p-1">
            <button type="button" aria-pressed={real} className={["finance-chart-tab !min-h-8", real ? "!bg-[var(--accent)]/10 !text-[var(--accent)]" : ""].join(" ")} onClick={() => setReal(true)}>Dnešní Kč</button>
            <button type="button" aria-pressed={!real} className={["finance-chart-tab !min-h-8", !real ? "!bg-[var(--accent)]/10 !text-[var(--accent)]" : ""].join(" ")} onClick={() => setReal(false)}>Nominálně</button>
          </div>
        </div>
        {forecast ? <ProjectionChart points={forecast.points} target={forecast.goalRealCzk} real={real} selectedMonth={selectedMonth} onSelect={setSelectedMonth} /> : <p className="text-sm text-[var(--warning)]">Graf se zobrazí po zadání platných hodnot.</p>}
        {forecast && forecast.last.shortfallCzk > 0 ? <p className="mt-3 text-xs text-[var(--warning)]">Pozor: události požadovaly více výběrů, než kolik bylo k dispozici ({money(forecast.last.shortfallCzk)} neuspokojeno). Simulátor nezakládá automaticky dluh.</p> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
        <div className="finance-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold">Časová osa · jednorázové události</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Kladná částka = mimořádný vklad, záporná = výběr. Částky jsou nominální v budoucím datu.</p>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="flex min-w-[100px] flex-1 flex-col gap-1 text-[11px] text-[var(--muted)]">Rok od dneška
              <input className="finance-field w-full" type="number" min=".083" max="100" step=".083333" value={eventYear} onChange={(e) => setEventYear(e.target.value)} />
            </label>
            <label className="flex min-w-[150px] flex-[1.5] flex-col gap-1 text-[11px] text-[var(--muted)]">Částka v Kč (+/−)
              <input className="finance-field w-full" type="number" step="10000" value={eventAmount} onChange={(e) => setEventAmount(e.target.value)} />
            </label>
            <button type="button" onClick={addEvent} className="finance-action finance-action-primary">+ Přidat událost</button>
          </div>
          <div className="mt-3 space-y-2">
            {events.length ? events.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white/[.025] px-3 py-2 text-xs">
                <span>{durationLabel(event.month)} · <strong className={event.amountCzk < 0 ? "text-[var(--warning)]" : "text-[var(--accent)]"}>{event.amountCzk > 0 ? "+" : "−"}{money(Math.abs(event.amountCzk))}</strong></span>
                <button type="button" className="finance-action !min-h-8 !px-2" aria-label={"Odebrat událost v měsíci " + event.month} onClick={() => setEvents((current) => current.filter((item) => item.id !== event.id))}>Odebrat</button>
              </div>
            )) : <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">Zatím žádné mimořádné události.</p>}
          </div>
        </div>
        <div className="finance-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold">Porovnání měsíčních vkladů</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Stejné předpoklady a události, mění se pouze výše vkladu.</p>
          <div className="mt-4 space-y-2">
            {yearComparisons.map(({ monthly, result }) => (
              <div key={monthly} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/[.025] px-3 py-3">
                <span className="text-xs font-medium">{money(monthly)} / měsíc</span>
                <span className="text-xs font-semibold tabular-nums text-[var(--accent)]">{result.value === null ? "Mimo 100 let" : durationLabel(Math.round(result.value * 12))}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <p className="rounded-xl border border-[var(--border)] bg-white/[.02] p-4 text-xs leading-5 text-[var(--muted)]">
        <strong className="text-[var(--foreground)]">Předpoklady a omezení:</strong> Model počítá s konstantním nominálním zhodnocením, bez daní, poplatků a volatility. Pravidelné vklady lze indexovat o vlastní roční procento. Cílový příjem 3 % z portfolia není zaručený doživotní příjem ani pravidlo bezpečného čerpání. Jednorázové výběry neumožňují záporné portfolio. Scénář se ukládá pouze v tomto prohlížeči a nijak nemění transakce FinanceOS.
      </p>
    </div>
  );
}
