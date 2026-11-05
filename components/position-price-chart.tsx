"use client";

import { useMemo, useState, type PointerEvent } from "react";
import Link from "next/link";
import { previousClose, overlayTradePrice } from "@/lib/shared/position-price-chart.mjs";
import type {
  PositionPriceChartData,
  PositionPricePoint,
  PositionTradeMarker,
} from "@/lib/server/position-price-history";

type Range = "1M" | "3M" | "1R" | "5L" | "MAX";
const RANGES: Range[] = ["1M", "3M", "1R", "5L", "MAX"];
const W = 1000;
const H = 390;
const LEFT = 85;
const RIGHT = 25;
const TOP = 25;
const BOTTOM = 55;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;

function timestamp(date: string) {
  return new Date(date.slice(0, 10) + "T12:00:00.000Z").getTime();
}

function displayDate(date: string) {
  return new Date(date.slice(0, 10) + "T12:00:00.000Z").toLocaleDateString("cs-CZ");
}

function formatValue(value: number, currency: string) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: value < 1 ? 6 : 2 }) + " " + currency;
}

function domainStart(range: Range, end: number) {
  if (range === "MAX") return -Infinity;
  const date = new Date(end);
  if (range === "1M") date.setUTCMonth(date.getUTCMonth() - 1);
  if (range === "3M") date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === "1R") date.setUTCFullYear(date.getUTCFullYear() - 1);
  if (range === "5L") date.setUTCFullYear(date.getUTCFullYear() - 5);
  return date.getTime();
}

function closestPriceIndex(prices: PositionPricePoint[], target: number) {
  if (!prices.length) return -1;
  let low = 0;
  let high = prices.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamp(prices[middle].date) < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low === prices.length) return prices.length - 1;
  return Math.abs(timestamp(prices[low].date) - target) <
    Math.abs(timestamp(prices[low - 1].date) - target) ? low : low - 1;
}

type PlotTrade = PositionTradeMarker & { x: number; y: number; chartPrice: number; usedTradePrice: boolean };

export function PositionPriceChart({
  data,
}: {
  data: PositionPriceChartData;
}) {
  const [range, setRange] = useState<Range>("MAX");
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  const [showList, setShowList] = useState(false);

  const model = useMemo(() => {
    const end = timestamp(data.asOfDate);
    const start = domainStart(range, end);
    const prices = data.prices.filter((p) => timestamp(p.date) >= start && timestamp(p.date) <= end);
    const trades = data.trades.filter((t) => timestamp(t.date) >= start && timestamp(t.date) <= end);
    if (prices.length === 0) return { prices, trades, plotted: [] as PlotTrade[], ticks: [] as number[], path: "", area: "", gapCount: 0, x: () => LEFT, y: () => TOP, minX: start, maxX: end, minY: 0, maxY: 1, unplaced: trades.length };
    const minX = range === "MAX" ? timestamp(prices[0].date) : start;
    const maxX = Math.max(end, timestamp(prices[prices.length - 1].date), minX + 86400000);
    const x = (value: number) => LEFT + PLOT_W * (value - minX) / (maxX - minX);
    const executions = trades.map((trade) => {
      const close = previousClose(data.prices, trade.date);
      if (close === null) return null;
      // Do not borrow a future market close to mark a historic execution.
      const overlay = overlayTradePrice(trade, close, data.currency);
      return { ...trade, close, ...overlay };
    }).filter((trade) => trade !== null);
    const values = [...prices.map((p) => p.close), ...executions.map((t) => t.chartPrice)];
    const floor = Math.min(...values);
    const ceiling = Math.max(...values);
    const margin = Math.max((ceiling - floor) * 0.12, ceiling * 0.008, 0.00000001);
    const minY = Math.max(0, floor - margin);
    const maxY = ceiling + margin;
    const y = (value: number) => TOP + PLOT_H * (maxY - value) / (maxY - minY);
    const gaps = prices.filter((p, index) =>
      index > 0 && timestamp(p.date) - timestamp(prices[index - 1].date) > 7 * 86400000,
    ).length;
    const path = prices.map((p, index) =>
      (index && timestamp(p.date) - timestamp(prices[index - 1].date) <= 7 * 86400000 ? "L" : "M") +
      x(timestamp(p.date)).toFixed(2) + " " + y(p.close).toFixed(2)
    ).join(" ");
    const area = gaps === 0 ? path + " L" + x(timestamp(prices[prices.length - 1].date)).toFixed(2) +
      " " + (TOP + PLOT_H) + " L" + x(timestamp(prices[0].date)).toFixed(2) +
      " " + (TOP + PLOT_H) + " Z" : "";
    const collisions = new Map<string, number>();
    const plotted = executions.map((trade) => {
      const key = trade.date + "/" + trade.kind;
      const collision = collisions.get(key) ?? 0;
      collisions.set(key, collision + 1);
      return {
        ...trade,
        x: Math.max(LEFT, Math.min(W - RIGHT, x(timestamp(trade.date)) + (collision % 5 - 2) * 5)),
        y: y(trade.chartPrice),
      };
    });
    const ticks = Array.from({ length: 5 }, (_, index) => minY + (maxY - minY) * index / 4);
    return { prices, trades, plotted, ticks, path, area, gapCount: gaps, x, y, minX, maxX, minY, maxY, unplaced: trades.length - plotted.length };
  }, [data.prices, data.trades, data.currency, data.asOfDate, range]);

  const selectedTrade = model.trades.find((t) => t.id === selectedTradeId) ?? null;
  const hoveredPrice = model.prices.find((p) => p.date === hoverDate) ?? null;
  const latest = model.prices.at(-1) ?? null;
  const first = model.prices[0] ?? null;
  const pct = latest && first && first.close > 0
    ? (latest.close / first.close - 1) * 100 : null;
  const unit = data.assetClass === "crypto" ? data.symbol : "ks";
  const chartId = "position-price-" + data.assetId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!model.prices.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const mouse = (event.clientX - bounds.left) * W / bounds.width;
    const target = model.minX + (Math.min(W - RIGHT, Math.max(LEFT, mouse)) - LEFT) / PLOT_W * (model.maxX - model.minX);
    const index = closestPriceIndex(model.prices, target);
    if (index >= 0) setHoverDate(model.prices[index].date);
  }

  return (
    <div className="space-y-4">
      {data.alternatives.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">Graf podle instrumentu:</span>
          {data.alternatives.map((asset) => (
            <Link
              key={asset.id}
              href={"/investments/" + encodeURIComponent(data.symbol) + "?asset=" + encodeURIComponent(asset.id) + "#price-chart"}
              prefetch={false}
              aria-current={asset.id === data.assetId ? "page" : undefined}
              className={["rounded-lg border px-2.5 py-1.5 text-xs transition",
                asset.id === data.assetId ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)] hover:text-white",
              ].join(" ")}
              title={asset.label}
            >{asset.provider} · {asset.currency}</Link>
          ))}
          <span className="text-[11px] text-[var(--muted)]">Nákupy různých instrumentů se neslučují.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-[var(--muted)]">Poslední dostupný denní závěr</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {latest ? formatValue(latest.close, data.currency) : "Historické ceny zatím nejsou"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {latest ? displayDate(latest.date) + " · změna ve zvoleném období " : "Doplní se při dostupnosti ověřitelného cenového zdroje."}
            {pct === null ? null : <span className={pct >= 0 ? "font-semibold text-[var(--accent)]" : "font-semibold text-[var(--danger)]"}>
              {pct > 0 ? "+" : ""}{pct.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} %
            </span>}
          </p>
        </div>
        <div role="group" aria-label="Období cenového grafu" className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1">
          {RANGES.map((item) => (
            <button
              key={item} type="button" aria-pressed={range === item}
              onClick={() => { setRange(item); setSelectedTradeId(null); setHoverDate(null); }}
              className={["rounded-lg px-2.5 py-2 text-[11px] font-semibold transition",
                range === item ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}
            >{item}</button>
          ))}
        </div>
      </div>

      {data.warning ? (
        <p role="status" className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/[.04] px-3 py-2 text-xs text-[var(--warning)]">
          Automatické načtení cen: {data.warning}. {data.prices.length ? "Zobrazují se již uložené ceny." : "Graf čeká na dostupná data."}
        </p>
      ) : null}

      {model.prices.length ? (
        <div className="finance-scrollbar overflow-x-auto rounded-2xl border border-[var(--border)] bg-[#0a1421]/40">
          <svg
            viewBox={"0 0 " + W + " " + H}
            className="block h-auto min-w-[680px] w-full touch-pan-y"
            role="group"
            aria-label={"Cenový vývoj " + data.symbol + " v " + data.currency + " s označenými skutečnými nákupy a prodeji"}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverDate(null)}
          >
            <defs>
              <linearGradient id={chartId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {model.ticks.map((tick, index) => (
              <g key={index}>
                <line x1={LEFT} x2={W - RIGHT} y1={model.y(tick)} y2={model.y(tick)} stroke="currentColor" opacity="0.11" strokeDasharray="3 7" />
                <text x={LEFT - 12} y={model.y(tick) + 4} fill="currentColor" opacity="0.65" textAnchor="end" fontSize="12">
                  {tick.toLocaleString("cs-CZ", { maximumFractionDigits: tick < 1 ? 4 : 2 })}
                </text>
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const value = model.minX + (model.maxX - model.minX) * f;
              return <text key={f} x={LEFT + PLOT_W * f} y={H - 19} fill="currentColor" opacity="0.65"
                fontSize="12" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>
                {new Date(value).toLocaleDateString("cs-CZ", { month: "short", year: "numeric" })}
              </text>;
            })}
            {model.prices.length > 1 && model.gapCount === 0 ? <path d={model.area} fill={"url(#" + chartId + ")"} /> : null}
            <path d={model.path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {model.prices.length === 1 ? <circle cx={model.x(timestamp(model.prices[0].date))}
              cy={model.y(model.prices[0].close)} r="5" fill="var(--accent)" /> : null}
            {hoveredPrice ? (
              <g pointerEvents="none">
                <line x1={model.x(timestamp(hoveredPrice.date))} x2={model.x(timestamp(hoveredPrice.date))}
                  y1={TOP} y2={TOP + PLOT_H} stroke="currentColor" opacity="0.45" strokeDasharray="4 4" />
                <circle cx={model.x(timestamp(hoveredPrice.date))} cy={model.y(hoveredPrice.close)} r="5" fill="var(--accent)" stroke="#071420" strokeWidth="2" />
              </g>
            ) : null}
            {showTrades ? model.plotted.map((trade) => (
              <g
                key={trade.id}
                role="button" tabIndex={0}
                aria-label={(trade.kind === "buy" ? "Nákup " : "Prodej ") + displayDate(trade.date) + ", " + trade.account}
                onPointerEnter={() => setSelectedTradeId(trade.id)}
                onClick={() => setSelectedTradeId(trade.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedTradeId(trade.id); }
                }}
                className="cursor-pointer outline-none"
              >
                <circle cx={trade.x} cy={trade.y} r={selectedTradeId === trade.id ? 12 : 10}
                  fill={trade.kind === "buy" ? "#16a982" : "#ea647c"}
                  stroke={selectedTradeId === trade.id ? "#fff" : "#0b1724"} strokeWidth="2.5" strokeDasharray={trade.usedTradePrice ? undefined : "3 2"} />
                <path d={trade.kind === "buy"
                  ? "M " + (trade.x - 4) + " " + trade.y + " h 8 M " + trade.x + " " + (trade.y - 4) + " v 8"
                  : "M " + (trade.x - 4) + " " + trade.y + " h 8"}
                  stroke="white" strokeWidth="2" strokeLinecap="round" pointerEvents="none" />
              </g>
            )) : null}
          </svg>
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs">
            <div role="status" aria-live="polite" className="text-[var(--muted)]">
              {selectedTrade ? (
                <span>
                  <strong className={selectedTrade.kind === "buy" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {selectedTrade.kind === "buy" ? "＋ Nákup" : "− Prodej"}
                  </strong>{" "}
                  {new Date(selectedTrade.occurredAt).toLocaleString("cs-CZ")} · {selectedTrade.account}
                  {selectedTrade.quantity !== null ? " · " + selectedTrade.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 }) + " " + unit : ""}
                  {selectedTrade.price !== null ? " · provedená cena " + formatValue(selectedTrade.price, selectedTrade.priceCurrency) : ""}
                </span>
              ) : hoveredPrice ? (
                <span>{displayDate(hoveredPrice.date)} · <strong className="text-[var(--foreground)]">{formatValue(hoveredPrice.close, data.currency)}</strong></span>
              ) : <span>Pohybem nad grafem zobrazíš závěrečnou cenu; kliknutím na +/− detail obchodu.</span>}
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[var(--muted)]">
              <input type="checkbox" checked={showTrades} onChange={(event) => setShowTrades(event.target.checked)}
                className="accent-[var(--accent)]" /> Obchody ({model.trades.length})
            </label>
          </div>
        </div>
      ) : (
        <div role="status" className="rounded-xl border border-dashed border-[var(--border-strong)] px-5 py-10 text-center">
          <p className="font-semibold">Pro zvolené období nejsou uložené historické ceny.</p>
          <p className="mt-2 text-xs leading-6 text-[var(--muted)]">
            {data.ticker ? "Automatický zdroj se doplňuje při otevření pozice, pokud je dostupný." :
              "Pro tento instrument nelze bezpečně určit burzu nebo cenový ticker. Lze nahrát ověřené denní ceny."}
            {" "}Nákupy a prodeje z účtu zůstávají níže viditelné.
          </p>
          <Link href="/history#history-import" className="finance-action mt-4 inline-flex">Import historických cen</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--muted)]">
        <p><span className="font-semibold text-[#29c99e]">● + Nákup</span> · <span className="font-semibold text-[#ee8292]">● − Prodej</span>
          {" · "}Plné kolečko = cena obchodu odpovídá měně a přibližně dennímu kurzu. Přerušovaný okraj = orientační poloha podle známého závěru dne.
        </p>
        <p>{data.source || "Zatím bez cenového zdroje"} · {data.ticker || data.symbol} · {data.currency}</p>
      </div>
      {data.tradesTruncated ? <p className="text-xs text-[var(--warning)]">Historie instrumentu má více než 5 000 obchodů; kvůli výkonu jsou zde načteny poslední 5 000. Kompletní historii najdeš v exportu transakcí.</p> : null}
      {model.gapCount > 0 ? <p className="text-xs text-[var(--warning)]">V historii je {model.gapCount} delších mezer v denních kurzech. Mezi nimi nespojujeme cenu vymyšlenou úsečkou.</p> : null}
      {model.unplaced > 0 ? <p className="text-xs text-[var(--warning)]">
        {model.unplaced} obchodů nelze umístit do grafu (chybí blízká tržní cena). Jsou v seznamu níže.
      </p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">Obchody ve zvoleném období: {model.trades.length.toLocaleString("cs-CZ")}</p>
        <button type="button" className="finance-action !min-h-9 !px-3" aria-expanded={showList}
          onClick={() => setShowList((current) => !current)}>
          {showList ? "Skrýt seznam obchodů" : "Zobrazit seznam obchodů"}
        </button>
      </div>
      {!model.prices.length && selectedTrade ? <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-xs">
        Vybraný {selectedTrade.kind === "buy" ? "nákup" : "prodej"} · {new Date(selectedTrade.occurredAt).toLocaleString("cs-CZ")}
        {" · "}{selectedTrade.account}
        {selectedTrade.price !== null ? " · " + formatValue(selectedTrade.price, selectedTrade.priceCurrency) : ""}
      </p> : null}
      {showList ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-[var(--border)]">
          {model.trades.length ? model.trades.slice().reverse().map((trade) => (
            <button key={trade.id} type="button" onClick={() => setSelectedTradeId(trade.id)}
              className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 text-left text-xs last:border-0 hover:bg-white/[.04]">
              <span><strong className={trade.kind === "buy" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                {trade.kind === "buy" ? "＋ Nákup" : "− Prodej"}
              </strong> · {new Date(trade.occurredAt).toLocaleString("cs-CZ")} · {trade.account}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block">{trade.quantity === null ? "Množství neznámé" : trade.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 }) + " " + unit}</span>
                <span className="mt-0.5 block text-[var(--muted)]">{trade.price === null ? "Cena nedostupná" : formatValue(trade.price, trade.priceCurrency)}</span>
              </span>
            </button>
          )) : <p className="p-4 text-xs text-[var(--muted)]">V období nejsou doložené obchody.</p>}
        </div>
      ) : null}
      <p className="text-[11px] leading-5 text-[var(--muted)]">
        Graf zobrazuje denní závěrečné tržní ceny, nikoli hodnotu portfolia. Obchody pocházejí z uložené historie platformy.
        Nejde o intradenní graf ani o záruku aktuální kotace. Při neúplné historii importovaných obchodů mohou značky chybět.
      </p>
    </div>
  );
}
