"use client";

import { useEffect, useMemo, useState } from "react";
import { ageOnDate, birthdayAtAge, isValidBirthDate, monthsUntilAge } from "@/lib/simulator/age";
import { SIMULATOR_DEFAULTS, goalRealCzk, simulate, type SimulatorEvent, type SimulatorInputs } from "@/lib/simulator/engine";
import type { TimelineRule } from "@/lib/simulator/timeline";

const money = (n: number) =>
  n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
const localToday = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
};
const prettyDate = (iso: string) => iso.split("-").reverse().join(".");

interface Props {
  inputs: SimulatorInputs;
  events: SimulatorEvent[];
  rules: TimelineRule[];
  onGoalInputChange: (key: "targetMonthlyIncomeCzk" | "withdrawalRatePct", value: number) => void;
  onSolveForTargetAge: (months: number) => void;
  onBirthDateSaved: (birthDate: string | null, currentAge: number | null) => void;
}

export function AgeGoalPlanner({
  inputs, events, rules, onGoalInputChange, onSolveForTargetAge, onBirthDateSaved,
}: Props) {
  const [today, setToday] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [targetAge, setTargetAge] = useState("40");
  const [saved, setSaved] = useState({ birthDate: "", targetAge: "" });
  const [savedGoalNumbers, setSavedGoalNumbers] = useState({
    monthly: SIMULATOR_DEFAULTS.targetMonthlyIncomeCzk,
    withdrawal: SIMULATOR_DEFAULTS.withdrawalRatePct,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setToday(localToday());
    (async () => {
      try {
        const response = await fetch("/api/age-goal", { cache: "no-store" });
        const data = (await response.json()) as {
          settings?: { birthDate: string | null; targetAge: number | null;
            targetMonthlyIncomeCzk: number | null; withdrawalRatePct: number | null };
          error?: string;
        };
        if (!response.ok || !data.settings) {
          throw new Error(data.error || "Nastavení se nepodařilo načíst.");
        }
        if (!active) return;
        const date = data.settings.birthDate || "";
        const age = date && isValidBirthDate(date, localToday())
          ? ageOnDate(date, localToday()) : null;
        const goal = data.settings.targetAge ?? Math.max(40, (age ?? 20) + 15);
        setBirthDate(date);
        setTargetAge(String(goal));
        setSaved({ birthDate: date, targetAge: data.settings.targetAge === null ? "" : String(goal) });
        const monthly = data.settings.targetMonthlyIncomeCzk ?? SIMULATOR_DEFAULTS.targetMonthlyIncomeCzk;
        const withdrawal = data.settings.withdrawalRatePct ?? SIMULATOR_DEFAULTS.withdrawalRatePct;
        setSavedGoalNumbers({ monthly, withdrawal });
        if (data.settings.targetMonthlyIncomeCzk !== null) {
          onGoalInputChange("targetMonthlyIncomeCzk", monthly);
        }
        if (data.settings.withdrawalRatePct !== null) {
          onGoalInputChange("withdrawalRatePct", withdrawal);
        }
        onBirthDateSaved(date || null, age);
      } catch (error) {
        if (active) setMessage("Nastavení není dostupné: " +
          (error instanceof Error ? error.message : String(error)));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // The loading lifecycle is intentionally independent of form edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validity = useMemo(() => {
    if (!today || !birthDate) return { age: null, months: null, error: "" };
    if (!isValidBirthDate(birthDate, today)) {
      return { age: null, months: null, error: "Zadej platné datum narození, které není v budoucnosti." };
    }
    const age = ageOnDate(birthDate, today);
    const goalAge = Number(targetAge);
    if (!Number.isInteger(goalAge) || goalAge < 1 || goalAge > 120) {
      return { age, months: null, error: "Cílový věk musí být celé číslo od 1 do 120." };
    }
    if (goalAge <= age) {
      return { age, months: null, error: "Zvol cílový věk vyšší než současný věk." };
    }
    const months = monthsUntilAge(birthDate, goalAge, today);
    if (months > 1200) {
      return { age, months: null, error: "Horizont finančního modelu je nejvýše 100 let." };
    }
    return { age, months, error: "" };
  }, [birthDate, targetAge, today]);

  const projection = useMemo(() => {
    if (validity.age === null || validity.months === null || !today) return null;
    try {
      const age = validity.age;
      const latestAge = Math.min(120, age + 100, Math.max(Number(targetAge) + 10, age + 30));
      const birthdays: Array<{ age: number; date: string; month: number }> = [
        { age, date: today, month: 0 },
      ];
      for (let year = age + 1; year <= latestAge; year++) {
        const date = birthdayAtAge(birthDate, year);
        const month = monthsUntilAge(birthDate, year, today);
        if (month <= 1200) birthdays.push({ age: year, date, month });
      }
      const maxMonths = Math.max(validity.months, ...birthdays.map((row) => row.month));
      const forecast = simulate(inputs, maxMonths, events, rules);
      const goalPoint = forecast.points[validity.months];
      const targetReal = goalRealCzk(inputs);
      const ratio = inputs.withdrawalRatePct / 100 / 12;
      const milestones = birthdays.map((row) => ({
        ...row,
        nominal: forecast.points[row.month].nominalCzk,
        real: forecast.points[row.month].realCzk,
        monthlyIncomeReal: forecast.points[row.month].realCzk * ratio,
      }));
      return {
        targetReal,
        targetNominal: targetReal * Math.pow(1 + inputs.annualInflationPct / 100,
          validity.months / 12),
        realAtGoal: goalPoint.realCzk,
        nominalAtGoal: goalPoint.nominalCzk,
        monthlyIncomeReal: goalPoint.realCzk * ratio,
        difference: goalPoint.realCzk - targetReal,
        milestones,
        shortfall: goalPoint.shortfallCzk,
        goalDate: birthdayAtAge(birthDate, Number(targetAge)),
      };
    } catch {
      return null;
    }
  }, [birthDate, today, targetAge, validity, inputs, events, rules]);

  const defaultSavedAge = saved.targetAge || (saved.birthDate &&
    isValidBirthDate(saved.birthDate, today) ?
    String(Math.max(40, ageOnDate(saved.birthDate, today) + 15)) : "40");
  const dirty = birthDate !== saved.birthDate || targetAge !== defaultSavedAge ||
    inputs.targetMonthlyIncomeCzk !== savedGoalNumbers.monthly ||
    inputs.withdrawalRatePct !== savedGoalNumbers.withdrawal;

  async function save() {
    if (!today || !birthDate || validity.error || validity.months === null || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/age-goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate, targetAge: Number(targetAge),
          targetMonthlyIncomeCzk: inputs.targetMonthlyIncomeCzk,
          withdrawalRatePct: inputs.withdrawalRatePct }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Uložení se nezdařilo.");
      setSaved({ birthDate, targetAge });
      setSavedGoalNumbers({ monthly: inputs.targetMonthlyIncomeCzk,
        withdrawal: inputs.withdrawalRatePct });
      onBirthDateSaved(birthDate, validity.age);
      setMessage("Datum narození, cílový věk a parametry čerpání jsou uloženy v FinanceOS.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="finance-surface p-4 sm:p-5" aria-labelledby="age-goal-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="age-goal-heading" className="text-base font-semibold">🎯 Finanční svoboda podle věku</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Naplánuj, v kolika letech chceš čerpat z portfolia. Datum narození a cílový věk
            a parametry čerpání se ukládají na tomto počítači; ostatní finanční scénář zvlášť v simulátoru.
          </p>
        </div>
        {validity.age !== null ?
          <span className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/[.055] px-3 py-2 text-xs font-semibold text-[var(--accent)]">
            Dnes {validity.age} let
          </span> : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor="age-goal-birth">
          Datum narození
          <input id="age-goal-birth" type="date" value={birthDate} max={today || undefined}
            disabled={loading} className="finance-field w-full text-sm"
            onChange={(event) => { setBirthDate(event.target.value); setMessage(""); }} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor="age-goal-target">
          Cíl dosáhnout ve věku
          <div className="flex items-center gap-2">
            <input id="age-goal-target" type="number" min="1" max="120" step="1"
              disabled={loading} className="finance-field w-full text-sm" value={targetAge}
              onChange={(event) => { setTargetAge(event.target.value); setMessage(""); }} />
            <span className="shrink-0 text-xs text-[var(--muted)]">let</span>
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor="age-goal-monthly">
          Chci vybírat měsíčně (dnešní Kč)
          <div className="flex items-center gap-2">
            <input id="age-goal-monthly" type="number" min="0" step="1000"
              className="finance-field w-full text-sm" value={inputs.targetMonthlyIncomeCzk}
              onChange={(event) => onGoalInputChange("targetMonthlyIncomeCzk", Number(event.target.value))} />
            <span className="shrink-0 text-xs text-[var(--muted)]">Kč</span>
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium" htmlFor="age-goal-withdrawal">
          Ročně vybírat z kapitálu
          <div className="flex items-center gap-2">
            <input id="age-goal-withdrawal" type="number" min="0.1" max="100" step=".1"
              className="finance-field w-full text-sm" value={inputs.withdrawalRatePct}
              onChange={(event) => onGoalInputChange("withdrawalRatePct", Number(event.target.value))} />
            <span className="shrink-0 text-xs text-[var(--muted)]">%</span>
          </div>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={loading || saving || !dirty || !birthDate ||
          !Number.isFinite(inputs.targetMonthlyIncomeCzk) || inputs.targetMonthlyIncomeCzk < 0 ||
          !Number.isFinite(inputs.withdrawalRatePct) || inputs.withdrawalRatePct <= 0 ||
          inputs.withdrawalRatePct > 100 || Boolean(validity.error) || validity.months === null}
          className="finance-action finance-action-primary disabled:opacity-50" onClick={() => void save()}>
          {saving ? "Ukládám…" : "Uložit můj finanční cíl"}
        </button>
        {projection && validity.months !== null ?
          <button type="button" className="finance-action" onClick={() => onSolveForTargetAge(validity.months!)}>
            Dopočítat potřebný měsíční vklad do {targetAge} let
          </button> : null}
        {projection ? <span className="text-xs text-[var(--muted)]">
          Cílové datum {prettyDate(projection.goalDate)} · přibližně {validity.months} měsíců
        </span> : null}
      </div>
      {validity.error ? <p role="alert" className="mt-3 text-xs text-[var(--warning)]">{validity.error}</p> : null}
      {message ? <p role="status" className="mt-3 text-xs text-[var(--muted)]">{message}</p> : null}
      {!birthDate && !loading ? <p className="mt-3 text-xs text-[var(--muted)]">
        Vyplň své datum narození, aby se místo samotných let zobrazily narozeniny, konkrétní roky a cílový kapitál.
      </p> : null}

      {projection ? <>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
            <p className="text-[11px] text-[var(--muted)]">Potřebný kapitál v dnešních Kč</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(projection.targetReal)}</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Nominálně v cílovém roce: {money(projection.targetNominal)}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
            <p className="text-[11px] text-[var(--muted)]">Odhad portfolia ve {targetAge} letech</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(projection.realAtGoal)}</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">V budoucích Kč: {money(projection.nominalAtGoal)}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
            <p className="text-[11px] text-[var(--muted)]">Možný měsíční výběr ve {targetAge} letech</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(projection.monthlyIncomeReal)}</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">V dnešní kupní síle při zadané míře výběru</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white/[.025] p-3">
            <p className="text-[11px] text-[var(--muted)]">Přebytek / chybějící kapitál</p>
            <p className={["mt-1 text-lg font-semibold tabular-nums",
              projection.difference >= 0 ? "text-[var(--accent)]" : "text-[var(--warning)]"].join(" ")}>
              {projection.difference >= 0 ? "+" : "−"}{money(Math.abs(projection.difference))}
            </p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Při nyní nastavených vkladech a předpokladech</p>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-white/[.025] p-3">
            <h3 className="text-xs font-semibold">Jak se může vyvíjet majetek podle věku</h3>
            <span className="text-[11px] text-[var(--muted)]">Modelový vývoj · jednotlivé narozeniny</span>
          </div>
          <div className="finance-scrollbar max-h-[340px] overflow-auto">
            <table className="finance-data-table w-full min-w-[650px] text-left text-xs">
              <thead className="sticky top-0 bg-[var(--background)]">
                <tr>
                  <th>Věk</th><th>Datum</th><th className="text-right">Nominálně</th>
                  <th className="text-right">Dnešní Kč</th><th className="text-right">Měsíční výběr v dnešních Kč</th>
                </tr>
              </thead>
              <tbody>
                {projection.milestones.map((row) =>
                  <tr key={row.age} className={row.age === Number(targetAge) ? "bg-[var(--accent)]/[.07]" : ""}>
                    <td className="font-semibold">{row.age} let{row.age === Number(targetAge) ? " 🎯" : ""}</td>
                    <td>{prettyDate(row.date)}</td>
                    <td className="text-right tabular-nums">{money(row.nominal)}</td>
                    <td className="text-right tabular-nums">{money(row.real)}</td>
                    <td className="text-right tabular-nums">{money(row.monthlyIncomeReal)}</td>
                  </tr>)}
              </tbody>
            </table>
          </div>
        </div>
        {projection.shortfall > 0 ? <p className="mt-3 text-xs text-[var(--warning)]">
          Model eviduje neuspokojené plánované výběry: {money(projection.shortfall)}.
        </p> : null}
        <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
          Budoucí částky jsou odhady, nikoli skutečně zaznamenané peníze. Počítají se
          z počátečního portfolia, vkladů, událostí, výnosu a inflace z polí simulátoru.
          Pro neúplný poslední měsíc se použije zaokrouhlení nahoru; vklady jsou na konci měsíce.
          Tato projekce používá původní zadaný měsíční vklad, nikoli případnou dopočtenou hodnotu.
          Míra čerpání není zárukou udržitelného důchodu.
        </p>
      </> : null}
    </section>
  );
}
