"use client";

import { useState } from "react";
import {
  periodFromAges, validateTimelineRules,
  type TimelineRule, type TimelineRuleKind,
} from "@/lib/simulator/timeline";

const kinds: Array<{ value: TimelineRuleKind; label: string; hint: string }> = [
  { value: "contribution", label: "Změnit základní měsíční vklad", hint: "Nahradí standardní vklad pouze během zvoleného období. Dvě taková období se nesmějí překrývat." },
  { value: "deposit", label: "Další pravidelný vklad", hint: "Přičte se k základnímu vkladu i ostatním příjmům do portfolia." },
  { value: "withdrawal", label: "Pravidelný výběr", hint: "Každý měsíc odečte z portfolia až do výše dostupných prostředků." },
];

const formatCzk = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";

function newId() {
  return "timeline-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function LifeTimelineEditor({
  startAge, onStartAgeChange, rules, onRulesChange,
}: {
  startAge: number;
  onStartAgeChange: (age: number) => void;
  rules: TimelineRule[];
  onRulesChange: (rules: TimelineRule[]) => void;
}) {
  const [kind, setKind] = useState<TimelineRuleKind>("contribution");
  const [label, setLabel] = useState("Nová životní fáze");
  const [fromAge, setFromAge] = useState(String(startAge));
  const [untilAge, setUntilAge] = useState(String(startAge + 3));
  const [amount, setAmount] = useState("5000");
  const [increase, setIncrease] = useState("0");
  const [error, setError] = useState("");

  function addRule() {
    try {
      const start = Number(fromAge), end = Number(untilAge), contribution = Number(amount), annual = Number(increase);
      if (amount.trim() === "" || increase.trim() === "" || !Number.isFinite(contribution) || !Number.isFinite(annual)) {
        throw new RangeError("Vyplň částku a roční změnu vkladu.");
      }
      const period = periodFromAges(startAge, start, end);
      const rule: TimelineRule = {
        id: newId(), label: label.trim() || kinds.find((item) => item.value === kind)?.label || "Pravidelná událost",
        kind, ...period, amountCzk: contribution, annualIncreasePct: annual,
      };
      const next = [...rules, rule].sort((a, b) => a.startMonth - b.startMonth);
      validateTimelineRules(next);
      onRulesChange(next);
      setError("");
      setFromAge(untilAge);
      setUntilAge(String(Math.min(startAge + 100, end + 3)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pravidlo nelze přidat.");
    }
  }

  function addExample() {
    try {
      const years = [0, 3, 8, 18, 100];
      const amounts = [5000, 15000, 30000, 0];
      const plan = amounts.map((contribution, i) => ({
        id: newId(), label: ["Začátek kariéry", "Růst příjmů", "Akumulace kapitálu", "Ukončení pravidelných vkladů"][i],
        kind: "contribution" as const,
        ...periodFromAges(startAge, startAge + years[i], startAge + years[i + 1]),
        amountCzk: contribution, annualIncreasePct: 0,
      }));
      validateTimelineRules(plan);
      onRulesChange(plan);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ukázkový plán nelze vytvořit.");
    }
  }

  return (
    <section className="finance-surface p-4 sm:p-5" aria-labelledby="life-timeline-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="life-timeline-heading" className="text-base font-semibold">Životní fáze · pravidelné peněžní toky</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Nastav, od kterého věku kolik investuješ nebo vybíráš každý měsíc. Příjmy ze zaměstnání se samy nepřevádějí do investic.
            Věk slouží k pojmenování období; měsíce se počítají od začátku scénáře.
          </p>
        </div>
        <button type="button" className="finance-action" onClick={addExample} disabled={rules.length > 0}>
          + Ukázkový životní plán
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[.025] px-3 py-2">
        <label htmlFor="simulator-start-age" className="text-xs font-semibold">Věk při začátku simulace</label>
        <input id="simulator-start-age" className="finance-field !min-h-9 !w-24 !py-1.5 text-right text-sm" type="number"
          min="0" max="100" step="1" value={startAge}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return;
            onStartAgeChange(parsed);
            setFromAge(String(parsed));
            setUntilAge(String(parsed + 3));
            setError("");
          }}
        />
        <span className="text-[11px] leading-5 text-[var(--muted)]">Při změně věku se stávající období neposouvají v čase, pouze se mění jejich věkové popisky.</span>
      </div>

      <div className="mt-4 grid gap-2.5 rounded-2xl border border-[var(--border)] bg-black/[.11] p-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-rule-kind">Typ pravidla
          <select id="timeline-rule-kind" className="finance-field min-w-0 !text-xs" value={kind} onChange={(event) => setKind(event.target.value as TimelineRuleKind)}>
            {kinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-rule-label">Název
          <input id="timeline-rule-label" className="finance-field min-w-0 !text-xs" value={label} maxLength={70} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-from-age">Od věku včetně
            <input id="timeline-from-age" className="finance-field min-w-0 !text-xs" type="number" min={startAge} max={startAge + 99} step="1" value={fromAge} onChange={(event) => setFromAge(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-until-age">Do věku (bez)
            <input id="timeline-until-age" className="finance-field min-w-0 !text-xs" type="number" min={startAge + 1} max={startAge + 100} step="1" value={untilAge} onChange={(event) => setUntilAge(event.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-rule-amount">Částka měsíčně · Kč
          <input id="timeline-rule-amount" className="finance-field min-w-0 !text-xs" type="number" min="0" step="1000" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="timeline-rule-increase">Roční změna částky · %
          <input id="timeline-rule-increase" className="finance-field min-w-0 !text-xs" type="number" min="-99.9" max="100" step=".1" value={increase} onChange={(event) => setIncrease(event.target.value)} />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={addRule} className="finance-action finance-action-primary w-full">+ Přidat pravidelnou událost</button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">{kinds.find((item) => item.value === kind)?.hint} Roční změna se připíše po každých 12 měsících od začátku tohoto pravidla.</p>
      {error ? <p role="alert" className="mt-3 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.06] p-3 text-xs text-[var(--warning)]">{error}</p> : null}

      <div className="mt-4 space-y-2">
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">
            Zatím žádná pravidelná životní fáze. Použije se základní měsíční vklad z kalkulačky.
          </p>
        ) : rules.map((rule) => {
          const ageFrom = startAge + Math.floor((rule.startMonth - 1) / 12);
          const ageUntil = startAge + Math.ceil(rule.endMonth / 12);
          return (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/[.025] px-3 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span aria-hidden="true" className={["mt-1 h-2.5 w-2.5 shrink-0 rounded-full", rule.kind === "withdrawal" ? "bg-[var(--warning)]" : rule.kind === "contribution" ? "bg-[var(--blue)]" : "bg-[var(--accent)]"].join(" ")}/>
                <div className="min-w-0">
                  <p className="break-words text-xs font-semibold">{rule.label}</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                    Věk {ageFrom}–{ageUntil} · {kinds.find((item) => item.value === rule.kind)?.label}
                  </p>
                  <p className="text-[11px] leading-5 text-[var(--muted)]">První měsíc {formatCzk(rule.amountCzk)} · ročně {rule.annualIncreasePct > 0 ? "+" : ""}{rule.annualIncreasePct.toLocaleString("cs-CZ")} %</p>
                </div>
              </div>
              <button type="button" className="finance-action !min-h-8 !px-3" onClick={() => {
                onRulesChange(rules.filter((item) => item.id !== rule.id));
                setError("");
              }} aria-label={"Odebrat pravidlo " + rule.label}>Odebrat</button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
        Mimo nastavená období platí základní měsíční vklad. Více dodatečných vkladů a výběrů se může ve stejném měsíci sčítat.
        Změna základního vkladu platí místo původního vkladu, nikoli navíc.
      </p>
    </section>
  );
}
