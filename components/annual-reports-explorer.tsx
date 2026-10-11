"use client";

import { useMemo, useState } from "react";
import type { getAnnualReports, AnnualProviderReport } from "@/lib/server/reports";
import { providerColor, providerLabel } from "@/lib/provider-visuals";

type Reports = ReturnType<typeof getAnnualReports>;
type View = "table" | "cards";
type Sort = "year" | "amount" | "provider" | "rows";

function money(value: number) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}

const columns: Array<{ key: keyof AnnualProviderReport; label: string }> = [
  { key: "dividendsCzk", label: "Dividendy" },
  { key: "interestCzk", label: "Úroky" },
  { key: "incomeCzk", label: "Ostatní příjmy" },
  { key: "salesCzk", label: "Prodeje" },
  { key: "purchasesCzk", label: "Nákupy" },
  { key: "feesCzk", label: "Poplatky" },
  { key: "withholdingTaxCzk", label: "Srážková daň" },
  { key: "depositsCzk", label: "Vklady" },
  { key: "withdrawalsCzk", label: "Výběry" },
  { key: "principalInvestedCzk", label: "Vložená jistina" },
  { key: "principalReturnedCzk", label: "Vrácená jistina" },
];

function summarize(rows: AnnualProviderReport[]) {
  return {
    interestCzk: rows.reduce((sum, row) => sum + row.interestCzk, 0),
    dividendsCzk: rows.reduce((sum, row) => sum + row.dividendsCzk, 0),
    salesCzk: rows.reduce((sum, row) => sum + row.salesCzk, 0),
    purchasesCzk: rows.reduce((sum, row) => sum + row.purchasesCzk, 0),
    feesCzk: rows.reduce((sum, row) => sum + row.feesCzk, 0),
    transactionCount: rows.reduce((sum, row) => sum + row.transactionCount, 0),
    missingCzkCount: rows.reduce((sum, row) => sum + row.missingCzkCount, 0),
  };
}

export function AnnualReportsExplorer({ data }: { data: Reports }) {
  const [year, setYear] = useState<string>(String(data.years[0] ?? "all"));
  const [provider, setProvider] = useState("all");
  const [sort, setSort] = useState<Sort>("year");
  const [view, setView] = useState<View>("table");
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const providers = useMemo(
    () => [...new Set(data.reports.map((row) => row.provider))].sort((a, b) => providerLabel(a).localeCompare(providerLabel(b), "cs")),
    [data.reports],
  );

  const filtered = useMemo(
    () => data.reports
      .filter((row) => (year === "all" || row.year === Number(year)) && (provider === "all" || row.provider === provider))
      .sort((a, b) => {
        const result = sort === "amount"
          ? (b.salesCzk + b.dividendsCzk + b.interestCzk) - (a.salesCzk + a.dividendsCzk + a.interestCzk)
          : sort === "provider" ? a.provider.localeCompare(b.provider, "cs")
          : sort === "rows" ? b.transactionCount - a.transactionCount
          : b.year - a.year;
        return result || b.year - a.year || a.provider.localeCompare(b.provider, "cs");
      }),
    [data.reports, year, provider, sort],
  );

  const selectedTotals = summarize(filtered);
  const displayMoney = (value: number) => hidden ? "••••••" : money(value);
  const selectedLabel = (year === "all" ? "Všechny roky" : "Rok " + year)
    + " · " + (provider === "all" ? "všechny platformy" : providerLabel(provider));

  function reset() {
    setYear(String(data.years[0] ?? "all"));
    setProvider("all");
    setSort("year");
    setExpanded(false);
  }

  if (!data.reports.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center">
        <p className="text-sm font-semibold">Zatím nejsou evidované roční reporty</p>
        <p className="mt-2 text-xs text-[var(--muted)]">Importuj výpisy nebo synchronizuj investiční účty.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 rounded-2xl border border-[var(--border)] bg-black/[.11] p-3 sm:grid-cols-2 lg:grid-cols-3 lg:p-4">
        <label>
          <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Rok</span>
          <select value={year} onChange={(event) => { setYear(event.target.value); setExpanded(false); }} className="finance-field h-10 w-full text-[12px]">
            <option value="all">Všechny roky</option>
            {data.years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Platforma</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className="finance-field h-10 w-full text-[12px]">
            <option value="all">Všechny platformy</option>
            {providers.map((item) => <option key={item} value={item}>{providerLabel(item)}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Řazení</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="finance-field h-10 w-full text-[12px]">
            <option value="year">Nejnovější rok</option>
            <option value="provider">Platforma A–Z</option>
            <option value="amount">Příjmy z prodejů a výnosů</option>
            <option value="rows">Počet transakcí</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--foreground)]">{selectedLabel}</p>
          <p aria-live="polite" role="status" className="mt-1 text-[11px] text-[var(--muted)]">
            {filtered.length} z {data.reports.length} kombinací rok × platforma · {selectedTotals.transactionCount.toLocaleString("cs-CZ")} transakcí
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="finance-action !min-h-9 !px-3" onClick={() => setHidden((v) => !v)} aria-pressed={hidden}>
            {hidden ? "Zobrazit částky" : "Skrýt částky"}
          </button>
          <div role="group" aria-label="Zobrazení reportů" className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1">
            {(["table", "cards"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}
                className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold", view === item ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>
                {item === "table" ? "Tabulka" : "Karty"}
              </button>
            ))}
          </div>
          <button type="button" className="finance-action !min-h-9 !px-3" onClick={reset}>Reset</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {[
          { label: "Úroky", value: selectedTotals.interestCzk },
          { label: "Dividendy", value: selectedTotals.dividendsCzk },
          { label: "Příjmy z prodejů", value: selectedTotals.salesCzk },
          { label: "Chybějící CZK převody", value: selectedTotals.missingCzkCount },
        ].map((item) => (
          <div key={item.label} className="rounded-[14px] border border-[var(--border)] bg-white/[.025] px-3.5 py-3">
            <p className="text-[11px] text-[var(--muted)]">{item.label}</p>
            <p className={["mt-1.5 break-words text-[clamp(1.05rem,2vw,1.4rem)] font-semibold tracking-[-.04em] tabular-nums", item.label === "Chybějící CZK převody" && item.value ? "text-[var(--warning)]" : ""].join(" ")}>
              {item.label === "Chybějící CZK převody" ? item.value.toLocaleString("cs-CZ") : displayMoney(item.value)}
            </p>
          </div>
        ))}
      </div>

      {selectedTotals.missingCzkCount > 0 ? (
        <div role="status" className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.04] p-3 text-xs leading-5 text-[var(--muted)]">
          <span className="font-semibold text-[var(--warning)]">Pozor na úplnost přepočtů:</span>{" "}
          {selectedTotals.missingCzkCount.toLocaleString("cs-CZ")} transakcí ve vybraném výběru nemá hodnotu v Kč.
          Zobrazené částky proto nejsou úplným součtem všech peněžních pohybů.
        </div>
      ) : null}

      {filtered.length ? (
        <>
          <div className={view === "cards" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-3 md:hidden"}>
            {filtered.map((row) => (
              <div key={row.year + ":" + row.provider} className="finance-account-card relative min-w-0 overflow-hidden p-4">
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg," + providerColor(row.provider) + ",transparent 80%)" }} aria-hidden="true" />
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{providerLabel(row.provider)}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">Rok {row.year}</p>
                  </div>
                  <p className="text-[11px] tabular-nums text-[var(--muted)]">{row.transactionCount.toLocaleString("cs-CZ")} transakcí</p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[.07] pt-3">
                  {[
                    ["Úroky", row.interestCzk], ["Dividendy", row.dividendsCzk],
                    ["Prodeje", row.salesCzk], ["Nákupy", row.purchasesCzk],
                    ["Poplatky", row.feesCzk], ["Srážková daň", row.withholdingTaxCzk],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-[10px] text-[var(--muted)]">{label}</dt>
                      <dd className="mt-0.5 break-words text-[12px] font-semibold tabular-nums">{displayMoney(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
                {row.missingCzkCount > 0 ? <p className="mt-3 text-[11px] text-[var(--warning)]">Bez CZK přepočtu: {row.missingCzkCount.toLocaleString("cs-CZ")}</p> : null}
              </div>
            ))}
          </div>
          {view === "table" ? (
            <div className="finance-scrollbar hidden overflow-x-auto rounded-[15px] border border-[var(--border)] md:block">
              <table className="finance-data-table min-w-[1110px] text-left">
                <thead><tr>
                  <th>Rok</th><th>Platforma</th>
                  {columns.slice(0, 7).map((column) => <th key={column.key} className="text-right">{column.label}</th>)}
                  <th className="text-right">Transakce</th><th className="text-right">Chybí CZK</th>
                </tr></thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.year + ":" + row.provider}>
                      <td className="text-[12px] font-semibold">{row.year}</td>
                      <td className="text-[12px]"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: providerColor(row.provider) }} />{providerLabel(row.provider)}</span></td>
                      {columns.slice(0, 7).map((column) => <td key={column.key} className="text-right text-[12px] tabular-nums">{displayMoney(Number(row[column.key]))}</td>)}
                      <td className="text-right text-[12px] tabular-nums">{row.transactionCount.toLocaleString("cs-CZ")}</td>
                      <td className={["text-right text-[12px] font-semibold tabular-nums", row.missingCzkCount ? "text-[var(--warning)]" : "text-[var(--muted)]"].join(" ")}>{row.missingCzkCount.toLocaleString("cs-CZ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center text-xs text-[var(--muted)]">Pro daný rok a platformu nejsou žádná data.</p>}

      {filtered.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-white/[.018] px-3.5 py-3.5">
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left text-[12px] font-semibold">
            Další typy pohybů · vybraný výběr
            <span className="text-[var(--accent)]">{expanded ? "Skrýt −" : "Zobrazit +"}</span>
          </button>
          {expanded ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-3">
              {[
                ["Nákupy", selectedTotals.purchasesCzk], ["Poplatky", selectedTotals.feesCzk],
                ["Počet transakcí", selectedTotals.transactionCount],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
                  <dd className="mt-1 text-[13px] font-semibold tabular-nums">{label === "Počet transakcí" ? Number(value).toLocaleString("cs-CZ") : displayMoney(Number(value))}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] leading-5 text-[var(--muted)]">
        Filtry ovlivňují pouze tento přehled. Export CSV nahoře vždy obsahuje kompletní roční report všech let a platforem.
        Prodeje nejsou zisk a report automaticky neurčuje daňovou povinnost.
      </p>
    </div>
  );
}
