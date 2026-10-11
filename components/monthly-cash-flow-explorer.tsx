"use client";

import { useMemo, useState } from "react";
import type { getCashFlowData } from "@/lib/server/analytics";

type Month = ReturnType<typeof getCashFlowData>["months"][number];
type Period = "3" | "6" | "12" | "all";
type Order = "newest" | "oldest" | "net-desc" | "net-asc";

function money(value: number) {
  return (value > 0 ? "+" : "") + value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}

function monthLabel(month: string) {
  const date = new Date(month + "-01T12:00:00");
  return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

export function MonthlyCashFlowExplorer({ months }: { months: Month[] }) {
  const [period, setPeriod] = useState<Period>("12");
  const [order, setOrder] = useState<Order>("newest");
  const [display, setDisplay] = useState<"table" | "cards">("table");
  const [hideValues, setHideValues] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const rows = useMemo(() => {
    const count = period === "all" ? months.length : Number(period);
    return months.slice(-count).sort((a, b) => {
      const value = order === "oldest" ? a.month.localeCompare(b.month)
        : order === "net-desc" ? b.netCzk - a.netCzk
        : order === "net-asc" ? a.netCzk - b.netCzk
        : b.month.localeCompare(a.month);
      return value || b.month.localeCompare(a.month);
    });
  }, [months, period, order]);

  const sums = useMemo(() => rows.reduce(
    (acc, item) => {
      acc.gross += item.incomeCzk + item.giftsCzk + item.interestCzk + item.cashbackCzk;
      acc.expenses += item.expensesCzk;
      acc.net += item.netCzk;
      acc.cashback += item.cashbackCzk;
      return acc;
    },
    { gross: 0, expenses: 0, net: 0, cashback: 0 },
  ), [rows]);

  const formatValue = (value: number) => hideValues ? "••••••" : money(value);
  const orderControls = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[11px] text-[var(--muted)]">
        Období
        <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="finance-field mt-1.5 block h-9 text-[12px]">
          <option value="3">3 měsíce</option>
          <option value="6">6 měsíců</option>
          <option value="12">12 měsíců</option>
          <option value="all">Celá dostupná historie</option>
        </select>
      </label>
      <label className="text-[11px] text-[var(--muted)]">
        Řadit
        <select value={order} onChange={(event) => setOrder(event.target.value as Order)} className="finance-field mt-1.5 block h-9 text-[12px]">
          <option value="newest">Nejnovější</option>
          <option value="oldest">Nejstarší</option>
          <option value="net-desc">Čistý výsledek ↓</option>
          <option value="net-asc">Čistý výsledek ↑</option>
        </select>
      </label>
    </div>
  );

  if (!months.length) {
    return <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-6 text-center text-[12px] text-[var(--muted)]">Pro měsíční srovnání zatím chybí data.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {orderControls}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="finance-action !min-h-9 !px-3" aria-pressed={hideValues} onClick={() => setHideValues((value) => !value)}>
            {hideValues ? "Zobrazit částky" : "Skrýt částky"}
          </button>
          <div role="group" aria-label="Zobrazení měsíčních peněžních toků" className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1">
            <button type="button" onClick={() => setDisplay("table")} aria-pressed={display === "table"}
              className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold", display === "table" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Tabulka</button>
            <button type="button" onClick={() => setDisplay("cards")} aria-pressed={display === "cards"}
              className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold", display === "cards" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Karty</button>
          </div>
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-[11px] text-[var(--muted)]">
        {rows.length.toLocaleString("cs-CZ")} z {months.length.toLocaleString("cs-CZ")} evidovaných měsíců
      </p>

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {[
          ["Evidované příjmy", sums.gross],
          ["Evidované výdaje", -sums.expenses],
          ["Čistá úspora", sums.net],
          ["Cashback v příjmech", sums.cashback],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-[14px] border border-[var(--border)] bg-white/[.025] p-3">
            <p className="text-[10px] text-[var(--muted)]">{label}</p>
            <p className="mt-1.5 break-words text-[14px] font-semibold tracking-tight tabular-nums">{formatValue(Number(value))}</p>
          </div>
        ))}
      </div>

      <div className={display === "cards" ? "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-2.5 md:hidden"}>
        {rows.map((item) => {
          const income = item.incomeCzk + item.giftsCzk + item.interestCzk + item.cashbackCzk;
          return (
            <div key={item.month} className="finance-account-card min-w-0 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold capitalize">{monthLabel(item.month)}</h3>
                <span className={["text-[13px] font-semibold tabular-nums", item.netCzk >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"].join(" ")}>{formatValue(item.netCzk)}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2.5 border-t border-[var(--border)] pt-3">
                <div><dt className="text-[10px] text-[var(--muted)]">Příjmy</dt><dd className="mt-1 text-[12px] font-medium">{formatValue(income)}</dd></div>
                <div><dt className="text-[10px] text-[var(--muted)]">Výdaje</dt><dd className="mt-1 text-[12px] font-medium">{formatValue(-item.expensesCzk)}</dd></div>
              </dl>
              <p className="mt-3 text-[10px] text-[var(--muted)]">Cashback v příjmech: {formatValue(item.cashbackCzk)}</p>
            </div>
          );
        })}
      </div>

      {display === "table" ? (
        <div className="finance-scrollbar hidden overflow-x-auto rounded-[14px] border border-[var(--border)] md:block">
          <table className="finance-data-table min-w-[810px] text-left">
            <thead><tr>
              <th>Měsíc</th><th className="text-right">Příjmy vč. cashbacku</th>
              <th className="text-right">Výdaje</th><th className="text-right">Čistá úspora</th>
              <th className="text-right">Cashback</th><th className="text-right">Míra úspor</th>
            </tr></thead>
            <tbody>
              {rows.map((item) => {
                const income = item.incomeCzk + item.giftsCzk + item.interestCzk + item.cashbackCzk;
                return <tr key={item.month}>
                  <td className="text-[12px] font-semibold capitalize">{monthLabel(item.month)}</td>
                  <td className="text-right text-[12px] tabular-nums">{formatValue(income)}</td>
                  <td className="text-right text-[12px] tabular-nums">{formatValue(-item.expensesCzk)}</td>
                  <td className={["text-right text-[12px] font-semibold tabular-nums", item.netCzk >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"].join(" ")}>{formatValue(item.netCzk)}</td>
                  <td className="text-right text-[12px] tabular-nums">{formatValue(item.cashbackCzk)}</td>
                  <td className="text-right text-[12px] tabular-nums">{item.savingsRate === null ? "—" : item.savingsRate.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " %"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-black/[.08] px-3.5 py-3">
        <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}
          className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-semibold">
          Co je v příjmech a proč se výsledek liší od čistých investičních vkladů?
          <span aria-hidden="true" className="text-[var(--accent)]">{showDetails ? "−" : "+"}</span>
        </button>
        {showDetails ? <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
          Příjmy v tomto přehledu jsou výplaty, dary, úroky a rozpoznaný Trading 212 cashback. Čistá úspora znamená příjmy mínus výdaje za daný měsíc.
          Není to totéž co čisté investiční vklady (externí vklady minus výběry). Interní převody mezi vlastními platformami se do tohoto souhrnu nepočítají.
        </p> : null}
      </div>
    </div>
  );
}
