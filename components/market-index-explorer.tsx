"use client";

import Link from "next/link";
import { useMemo, useState, type PointerEvent } from "react";
import {
  MARKET_INDICES,
  buildMarketIndexComparison,
  indexPeriodStart,
} from "@/lib/shared/market-index-benchmarks.mjs";
import type { MarketIndexRow } from "@/lib/server/market-index-history";

type Range = "1M" | "3M" | "1R" | "3R" | "5R" | "MAX";
const RANGES: Range[] = ["1M", "3M", "1R", "3R", "5R", "MAX"];
const W = 1040;
const H = 405;
const LEFT = 74;
const RIGHT = 28;
const TOP = 28;
const PLOT_HEIGHT = 315;
const PLOT_WIDTH = W - LEFT - RIGHT;
const COLORS = ["#48d8ac", "#92aeff", "#ffc276", "#f08fb8"];

function fmt(value: number, digits = 2) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: digits });
}
function dateLabel(value: string) {
  return new Date(value + "T12:00:00Z").toLocaleDateString("cs-CZ");
}
function fmtPct(value: number) {
  return (value > 0 ? "+" : "") + fmt(value, 2) + " %";
}

function indexUrl(ids: string[]) {
  return "/indices?ids=" + encodeURIComponent(ids.join(","));
}

export function MarketIndexExplorer({
  rows,
  selectedIds,
  asOfDate,
}: {
  rows: MarketIndexRow[];
  selectedIds: string[];
  asOfDate: string;
}) {
  const [range, setRange] = useState<Range>("1R");
  const [mode, setMode] = useState<"normalized" | "levels">("levels");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const comparison = useMemo(() => buildMarketIndexComparison(
    rows, indexPeriodStart(range, asOfDate),
  ), [rows, range, asOfDate]);
  const dates = comparison.dates as string[];
  const lines = comparison.lines as Array<{
    id: string; name: string; ticker: string; currency: string;
    basis: string; baseline: number; values: number[]; returnPct: number;
  }>;
  const single = lines.length === 1;
  const rawMode = single && mode === "levels";
  const lastIndex = Math.max(0, dates.length - 1);
  const currentIndex = hoverIndex === null ? lastIndex : Math.min(lastIndex, Math.max(0, hoverIndex));
  const shownValues = lines.map(line => rawMode
    ? line.values.map(point => point * line.baseline / 100)
    : line.values);
  const values = shownValues.flat();
  const valueMin = values.length ? Math.min(...values) : 0;
  const valueMax = values.length ? Math.max(...values) : 200;
  const margin = Math.max((valueMax - valueMin) * 0.13, Math.abs(valueMax) * 0.005, 0.001);
  const bottom = Math.max(0, valueMin - margin);
  const top = valueMax + margin;
  const x = (i: number) => LEFT + PLOT_WIDTH * i / Math.max(1, dates.length - 1);
  const y = (value: number) => TOP + PLOT_HEIGHT * (top - value) / Math.max(0.000001, top - bottom);
  const tickValues = Array.from({length: 5}, (_, n) => bottom + (top - bottom) * n / 4);
  const dateTicks = [0, .25, .5, .75, 1].map(part => Math.round(lastIndex * part));
  const hasPerformanceBasis = lines.some(line => line.basis === "performance");

  function linePath(points: number[]) {
    return points.map((value, i) => {
      const gap = i && Date.parse(dates[i]) - Date.parse(dates[i-1]) > 7 * 86400000;
      return (i && !gap ? "L" : "M") + x(i).toFixed(2) + " " + y(value).toFixed(2);
    }).join(" ");
  }

  function onChartPointer(event: PointerEvent<SVGSVGElement>) {
    if (!dates.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - bounds.left) * W / bounds.width;
    const position = Math.min(1, Math.max(0, (px - LEFT) / PLOT_WIDTH));
    setHoverIndex(Math.round(position * lastIndex));
  }

  function toggleLink(id: string) {
    if (selectedIds.includes(id)) {
      return selectedIds.length === 1 ? indexUrl([id]) : indexUrl(selectedIds.filter(key => key !== id));
    }
    return indexUrl([...selectedIds, id].slice(0, 4));
  }

  return (
    <div className="space-y-5">
      <section className="finance-surface p-4 sm:p-5" aria-label="Srovnání světových indexů">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">Vývoj hlavních indexů</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Skutečné indexové body • srovnání se společným základem 100 • nejde o ceny ETF ani o tvoje pozice
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1" role="group" aria-label="Časové období grafu">
            {RANGES.map(option => (
              <button key={option} type="button" aria-pressed={range === option}
                onClick={() => {setRange(option); setHoverIndex(null);}}
                className={["rounded-lg px-2.5 py-2 text-xs font-semibold transition",
                  range === option ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                <span className="font-medium">{row.name}</span>
                {row.points.length === 0 ? <span className="text-[var(--warning)]">bez dat</span> : null}
              </div>
            ))}
          </div>
          {single ? (
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1" role="group" aria-label="Jednotka grafu">
              <button type="button" onClick={() => setMode("normalized")} aria-pressed={!rawMode}
                className={["rounded-md px-2 py-1.5 text-xs", !rawMode ? "bg-white/10 text-white" : "text-[var(--muted)]"].join(" ")}>
                Od 100
              </button>
              <button type="button" onClick={() => setMode("levels")} aria-pressed={rawMode}
                className={["rounded-md px-2 py-1.5 text-xs", rawMode ? "bg-white/10 text-white" : "text-[var(--muted)]"].join(" ")}>
                Body indexu
              </button>
            </div>
          ) : <span className="text-[11px] text-[var(--muted)]">Procenta nejsou přepočtená do CZK</span>}
        </div>

        {dates.length ? (
          <>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[#0b1724]/55">
              <svg viewBox={"0 0 " + W + " " + H} className="block h-auto min-w-[650px] w-full touch-pan-y"
                role="img" aria-label={"Srovnání indexů " + lines.map(line => line.name).join(", ") + ", od " + dateLabel(dates[0]) + " do " + dateLabel(dates.at(-1)!) }
                onPointerMove={onChartPointer} onPointerLeave={() => setHoverIndex(null)}>
                {tickValues.map((tick, i) => (
                  <g key={i}>
                    <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)}
                      stroke="currentColor" opacity=".13" strokeDasharray="3 6" />
                    <text x={LEFT - 10} y={y(tick)+4} fill="currentColor" opacity=".62"
                      textAnchor="end" fontSize="12">{fmt(tick, rawMode ? 0 : 1)}</text>
                  </g>
                ))}
                {dateTicks.map((i, pos) => (
                  <text key={pos} x={x(i)} y={H - 19} fill="currentColor" opacity=".6"
                    textAnchor={pos === 0 ? "start" : pos === 4 ? "end" : "middle"} fontSize="12">
                    {new Date(dates[i] + "T12:00:00Z").toLocaleDateString("cs-CZ", {month:"short", year:"numeric"})}
                  </text>
                ))}
                {shownValues.map((points, i) => (
                  <g key={lines[i].id}>
                    <path d={linePath(points)} fill="none" stroke={COLORS[rows.findIndex(row=>row.id===lines[i].id)] || COLORS[i]}
                      strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"/>
                    {points.length === 1 ? <circle cx={x(0)} cy={y(points[0])} r="4" fill={COLORS[i]} /> : null}
                  </g>
                ))}
                <g pointerEvents="none">
                  <line x1={x(currentIndex)} x2={x(currentIndex)} y1={TOP} y2={TOP + PLOT_HEIGHT}
                    stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 5" opacity=".7"/>
                  {shownValues.map((points, i) => (
                    <circle key={lines[i].id} cx={x(currentIndex)} cy={y(points[currentIndex])} r="6"
                      fill={COLORS[rows.findIndex(row=>row.id===lines[i].id)] || COLORS[i]}
                      stroke="#0b1724" strokeWidth="2"/>
                  ))}
                </g>
              </svg>
              <div className="border-t border-[var(--border)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-xs">{dateLabel(dates[currentIndex])}</strong>
                  <span className="text-[10px] text-[var(--muted)]">
                    {rawMode ? "Indexové body" : "Srovnání od 100 při společném počátečním dni"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs tabular-nums">
                  {lines.map((line, i) => {
                    const level = shownValues[i][currentIndex];
                    const movePct = (line.values[currentIndex] / 100 - 1) * 100;
                    const color = COLORS[rows.findIndex(row=>row.id===line.id)] || COLORS[i];
                    return (
                      <span key={line.id} className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold" style={{color}}>{line.name}</span>
                        <strong>{fmt(level)} {rawMode ? "b." : ""}</strong>
                        <span className={movePct >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                          {fmtPct(movePct)}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <input type="range" min={0} max={lastIndex} step={1} value={currentIndex}
                  onChange={event => setHoverIndex(Number(event.target.value))}
                  aria-label="Vyber obchodní den v grafu" className="mt-3 w-full accent-[var(--accent)]" />
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {lines.map((line, i) => (
                <div key={line.id} className="rounded-xl border border-[var(--border)] p-3">
                  <p className="text-[11px] text-[var(--muted)]">{line.name}</p>
                  <strong style={{color: COLORS[rows.findIndex(row=>row.id===line.id)] || COLORS[i]}}
                    className="mt-1 block text-xl tabular-nums">{fmtPct(line.returnPct)}</strong>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    {dateLabel(dates[0])}–{dateLabel(dates.at(-1)!)} · bez převodu měny
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div role="status" className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] p-6 text-center">
            <strong className="text-sm">Srovnání teď nelze bezpečně vykreslit</strong>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{comparison.reason}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">Zkus větší období nebo vyber jeden konkrétní index.</p>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
          Indexy jsou obvykle uváděny v bodech, ne jako cena akcie v USD/EUR. Při porovnání jsou normalizované na 100
          v prvním společném obchodním dni a končí posledním společným dnem. Jde o nominální vývoj indexů bez
          zohlednění změny kurzu CZK; cenové indexy nezahrnují dividendy.
          {hasPerformanceBasis ? " DAX je výjimka: uvedený performance index zahrnuje reinvestované dividendy, takže jeho srovnání s cenovými indexy není metodicky stejné." : ""}
        </p>
      </section>

      <section aria-label="Katalog indexů" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Katalog světových indexů</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Klikni na index pro jeho vlastní graf nebo přidej až čtyři indexy ke srovnání.</p>
          </div>
          <button type="button" onClick={() => setShowAll(v=>!v)} className="finance-action !min-h-9 !px-3">
            {showAll ? "Skrýt další indexy" : "Zobrazit všechny indexy ("+MARKET_INDICES.length+")"}
          </button>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {MARKET_INDICES.slice(0, showAll ? MARKET_INDICES.length : 6).map(index => {
            const selected = selectedIds.includes(index.id);
            const loaded = byId.get(index.id);
            const last = loaded?.points.at(-1);
            const maxed = selectedIds.length >= 4 && !selected;
            return (
              <article key={index.id} className={[
                "rounded-2xl border p-3.5 transition",
                selected ? "border-[var(--accent)]/45 bg-[var(--accent)]/[.035]" :
                  "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]",
              ].join(" ")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{index.region} · {index.currency}</p>
                    <h3 className="mt-1.5 font-semibold">{index.name}</h3>
                  </div>
                  <span className="rounded-md bg-white/[.055] px-2 py-1 font-mono text-[10px]">{index.ticker}</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-[var(--muted)]">{last ? "Poslední dostupný bod" : selected ? "Zatím bez doložených dat" : "Denní historický graf"}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{last ? fmt(last.close) + " b." : "—"}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">{last ? dateLabel(last.date) : index.basis === "performance" ? "Performance index" : "Cenový index"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Link prefetch={false} href={indexUrl([index.id])}
                      aria-label={"Otevřít graf indexu "+index.name}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                      Graf
                    </Link>
                    {maxed || (selected && selectedIds.length === 1) ? (
                      <span title={maxed ? "Nejprve odeber jiný index (maximum 4)." : "Alespoň jeden index musí zůstat vybraný."}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-xs text-[var(--muted)] opacity-50">
                        {selected ? "✓" : "＋"}
                      </span>
                    ) : (
                      <Link prefetch={false} href={toggleLink(index.id)}
                        aria-label={(selected ? "Odebrat " : "Porovnat ") + index.name}
                        className={["rounded-lg border px-2.5 py-2 text-xs font-bold transition",
                          selected ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]" :
                            "border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
                        ].join(" ")}>
                        {selected ? "✓" : "＋"}
                      </Link>
                    )}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-9 text-[11px] leading-4 text-[var(--muted)]">{index.note}</p>
                {loaded?.warning ? <p className="mt-2 text-[10px] text-[var(--warning)]">{loaded.warning}</p> : null}
                {loaded && !loaded.warning && loaded.lastUpdated ?
                  <p className="mt-2 text-[10px] text-[var(--muted)]">Historie aktualizována {new Date(loaded.lastUpdated).toLocaleString("cs-CZ")}</p> : null}
              </article>
            );
          })}
        </div>
      </section>
      <p className="text-[11px] leading-5 text-[var(--muted)]">
        Zdroj cen: Yahoo Finance, veřejný neoficiální historický denní feed; dostupnost a úplnost nejsou garantovány.
        Data se načítají pouze pro vybrané indexy a ukládají do samostatné cache, která nijak nemění transakce ani hodnotu portfolia.
        Pokud zdroj vrátí jiné měnové nebo tickerové označení, FinanceOS jeho data odmítne.
      </p>
    </div>
  );
}
