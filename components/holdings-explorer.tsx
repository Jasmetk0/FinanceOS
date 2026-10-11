"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { getDashboardData } from "@/lib/server/analytics";
import { providerColor, providerLabel } from "@/lib/provider-visuals";

type Holding = ReturnType<typeof getDashboardData>["holdings"][number];
type Sort = "value-desc" | "value-asc" | "pnl-desc" | "pnl-asc" | "name";
type Performance = "all" | "positive" | "negative" | "unknown";
type Display = "table" | "cards";

const PAGE_SIZE = 30;

function money(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}

function pnlLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return (value > 0 ? "+" : "") + money(value);
}

function pnlColor(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "text-[var(--muted)]";
  return value > 0 ? "text-[var(--accent)]" : value < 0 ? "text-[var(--danger)]" : "text-[var(--foreground)]";
}

function equityShare(value: number, total: number) {
  return total > 0 ? (Math.max(0, value) / total) * 100 : 0;
}

export function HoldingsExplorer({ holdings }: { holdings: Holding[] }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [assetClass, setAssetClass] = useState("all");
  const [performance, setPerformance] = useState<Performance>("all");
  const [sort, setSort] = useState<Sort>("value-desc");
  const [display, setDisplay] = useState<Display>("table");
  const [hidden, setHidden] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const allProviders = useMemo(() =>
    [...new Set(holdings.map((item) => item.provider))].sort((a, b) => providerLabel(a).localeCompare(providerLabel(b), "cs")),
    [holdings],
  );
  const allClasses = useMemo(() =>
    [...new Set(holdings.map((item) => item.assetClass))].sort((a, b) => a.localeCompare(b, "cs")),
    [holdings],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("cs-CZ");
    return holdings.filter((item) => {
      if (provider !== "all" && item.provider !== provider) return false;
      if (assetClass !== "all" && item.assetClass !== assetClass) return false;
      if (performance === "unknown" && item.pnlCzk !== null) return false;
      if (performance === "positive" && !(item.pnlCzk !== null && item.pnlCzk > 0)) return false;
      if (performance === "negative" && !(item.pnlCzk !== null && item.pnlCzk < 0)) return false;
      if (!needle) return true;
      return [item.symbol, item.name, item.accountName, providerLabel(item.provider), item.assetClass]
        .some((value) => value.toLocaleLowerCase("cs-CZ").includes(needle));
    }).sort((a, b) => {
      let result = 0;
      if (sort === "value-desc") result = b.valueCzk - a.valueCzk;
      else if (sort === "value-asc") result = a.valueCzk - b.valueCzk;
      else if (sort === "name") result = a.symbol.localeCompare(b.symbol, "cs");
      else {
        // Unknown P/L is never interpreted as zero for ordering or display.
        if (a.pnlCzk === null && b.pnlCzk !== null) return 1;
        if (b.pnlCzk === null && a.pnlCzk !== null) return -1;
        result = sort === "pnl-desc"
          ? (b.pnlCzk ?? 0) - (a.pnlCzk ?? 0)
          : (a.pnlCzk ?? 0) - (b.pnlCzk ?? 0);
      }
      return result || a.symbol.localeCompare(b.symbol, "cs") || a.id.localeCompare(b.id);
    });
  }, [holdings, query, provider, assetClass, performance, sort]);

  const totalKnownValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + Math.max(0, holding.valueCzk), 0),
    [holdings],
  );
  const filteredValue = filtered.reduce((sum, holding) => sum + Math.max(0, holding.valueCzk), 0);
  const shown = filtered.slice(0, visibleCount);
  const hasMore = shown.length < filtered.length;
  const active = Boolean(query.trim()) || provider !== "all" || assetClass !== "all" || performance !== "all" || sort !== "value-desc";

  function reset() {
    setQuery("");
    setProvider("all");
    setAssetClass("all");
    setPerformance("all");
    setSort("value-desc");
    setVisibleCount(PAGE_SIZE);
  }

  function displayMoney(value: number | null, withSign = false) {
    return hidden ? "••••••" : withSign ? pnlLabel(value) : money(value);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-black/[.09] p-3 sm:p-4">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1.3fr)_repeat(3,minmax(125px,1fr))_minmax(140px,1fr)]">
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Hledat pozici</span>
            <input
              value={query}
              type="search"
              onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="Ticker, název, účet…"
              className="finance-field h-10 w-full min-w-0 text-[12px]"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Platforma</span>
            <select value={provider} onChange={(event) => { setProvider(event.target.value); setVisibleCount(PAGE_SIZE); }} className="finance-field h-10 w-full text-[12px]">
              <option value="all">Všechny platformy</option>
              {allProviders.map((item) => <option key={item} value={item}>{providerLabel(item)}</option>)}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Třída aktiv</span>
            <select value={assetClass} onChange={(event) => { setAssetClass(event.target.value); setVisibleCount(PAGE_SIZE); }} className="finance-field h-10 w-full text-[12px]">
              <option value="all">Všechna aktiva</option>
              {allClasses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Nerealizovaný P/L</span>
            <select value={performance} onChange={(event) => { setPerformance(event.target.value as Performance); setVisibleCount(PAGE_SIZE); }} className="finance-field h-10 w-full text-[12px]">
              <option value="all">Všechny výsledky</option>
              <option value="positive">Kladný</option>
              <option value="negative">Záporný</option>
              <option value="unknown">Neznámý</option>
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Řadit</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setVisibleCount(PAGE_SIZE); }} className="finance-field h-10 w-full text-[12px]">
              <option value="value-desc">Hodnota ↓</option>
              <option value="value-asc">Hodnota ↑</option>
              <option value="pnl-desc">P/L ↓</option>
              <option value="pnl-asc">P/L ↑</option>
              <option value="name">Ticker A–Z</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p role="status" aria-live="polite" className="text-[12px] text-[var(--muted)]">
            Zobrazeno <span className="font-semibold text-[var(--foreground)]">{shown.length}</span> z {filtered.length} odpovídajících pozic
            {filtered.length !== holdings.length ? " · celkem " + holdings.length : ""}
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Hodnota vyfiltrovaných pozic: <span className="font-semibold text-[var(--foreground)]">{displayMoney(filteredValue)}</span>
            {totalKnownValue > 0 ? " · " + equityShare(filteredValue, totalKnownValue).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " % hodnoty evidovaných pozic" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active ? <button type="button" onClick={reset} className="rounded-lg px-2 py-2 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]">Vymazat filtry</button> : null}
          <button type="button" onClick={() => setHidden((previous) => !previous)} aria-pressed={hidden} className="finance-action !min-h-9 !px-3">{hidden ? "Zobrazit částky" : "Skrýt částky"}</button>
          <div role="group" aria-label="Režim zobrazení pozic" className="flex rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1">
            <button type="button" onClick={() => setDisplay("table")} aria-pressed={display === "table"} className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold transition", display === "table" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Tabulka</button>
            <button type="button" onClick={() => setDisplay("cards")} aria-pressed={display === "cards"} className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold transition", display === "cards" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Karty</button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-black/[.08] px-5 py-10 text-center">
          <p className="text-sm font-semibold">Žádné odpovídající pozice</p>
          <p className="mt-2 text-xs text-[var(--muted)]">Změň vyhledávání, platformu, třídu aktiv nebo filtr P/L.</p>
          <button type="button" onClick={reset} className="finance-action mt-4">Zobrazit všechny pozice</button>
        </div>
      ) : (
        <>
          <div className={display === "cards" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid grid-cols-1 gap-2.5 md:hidden"}>
            {shown.map((holding) => {
              const color = providerColor(holding.provider);
              const share = equityShare(holding.valueCzk, totalKnownValue);
              return (
                <Link key={holding.id} href={"/investments/" + encodeURIComponent(holding.symbol)} prefetch={false} className="finance-account-card group relative min-w-0 overflow-hidden px-3.5 py-3.5 sm:px-4" title={"Detail " + holding.symbol}>
                  <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg, " + color + ", transparent 75%)" }} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]">{holding.symbol}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{holding.name}</p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-[var(--border)] bg-white/[.03] px-2 py-1 text-[10px] text-[var(--muted)]">{holding.assetClass}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] text-[var(--muted)]">Hodnota</p>
                      <p className="mt-1 break-words text-[17px] font-semibold tracking-[-.04em] tabular-nums">{displayMoney(holding.valueCzk)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-[var(--muted)]">P/L</p>
                      <p className={["mt-1 text-[12px] font-semibold tabular-nums", pnlColor(holding.pnlCzk)].join(" ")}>{displayMoney(holding.pnlCzk, true)}</p>
                    </div>
                  </div>
                  <div className="finance-meter mt-3 !h-[5px]" aria-label={"Podíl na známých pozicích: " + share.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " %"}>
                    <span style={{ width: share + "%", backgroundColor: color }} />
                  </div>
                  <p className="mt-2 truncate text-[11px] text-[var(--muted)]">{holding.accountName} · {holding.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 })} jednotek</p>
                </Link>
              );
            })}
          </div>

          {display === "table" ? (
            <div className="finance-scrollbar hidden overflow-x-auto rounded-[15px] border border-[var(--border)] md:block">
              <table className="finance-data-table min-w-[890px] text-left">
                <thead><tr>
                  <th>Aktivum</th>
                  <th>Platforma / účet</th>
                  <th>Třída</th>
                  <th className="text-right">Množství</th>
                  <th className="text-right">Hodnota</th>
                  <th className="text-right">Podíl</th>
                  <th className="text-right">P/L</th>
                </tr></thead>
                <tbody>
                  {shown.map((holding) => (
                    <tr key={holding.id}>
                      <td>
                        <Link href={"/investments/" + encodeURIComponent(holding.symbol)} prefetch={false} className="text-[13px] font-semibold text-[var(--foreground)] transition hover:text-[var(--accent)]">{holding.symbol} ↗</Link>
                        <p className="mt-1 max-w-[210px] truncate text-[11px] text-[var(--muted)]" title={holding.name}>{holding.name}</p>
                      </td>
                      <td>
                        <p className="flex items-center gap-2 text-[12px] font-medium"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: providerColor(holding.provider) }} />{providerLabel(holding.provider)}</p>
                        <p className="mt-1 max-w-[180px] truncate text-[11px] text-[var(--muted)]">{holding.accountName}</p>
                      </td>
                      <td className="text-[12px] text-[var(--muted)]">{holding.assetClass}</td>
                      <td className="text-right text-[12px] tabular-nums">{holding.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 })}</td>
                      <td className="text-right text-[13px] font-semibold tabular-nums">{displayMoney(holding.valueCzk)}</td>
                      <td className="text-right text-[12px] tabular-nums">{equityShare(holding.valueCzk, totalKnownValue).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %</td>
                      <td className={["text-right text-[12px] font-semibold tabular-nums", pnlColor(holding.pnlCzk)].join(" ")}>{displayMoney(holding.pnlCzk, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasMore ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-[11px] text-[var(--muted)]">Další pozice jsou načtené, ale zatím skryté pro přehlednost.</p>
              <button type="button" className="finance-action" onClick={() => setVisibleCount((previous) => previous + PAGE_SIZE)}>
                Zobrazit dalších {Math.min(PAGE_SIZE, filtered.length - shown.length)} pozic
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
