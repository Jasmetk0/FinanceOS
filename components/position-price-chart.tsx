"use client";

import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { placeTradeTooltip } from "@/lib/shared/trade-tooltip-position.mjs";
import { chartExecutionTimestamp, describeTradeCzk, isExactClockTime, previousClose, overlayTradePrice } from "@/lib/shared/position-price-chart.mjs";
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

type PlotTrade = PositionTradeMarker & { x: number; y: number; chartPrice: number | null; usedTradePrice: boolean };


function preciseNumber(value: number, maxDigits = 10) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: maxDigits });
}

function TradeInfoCard({
  trade, unit, timeZone,
}: { trade: PositionTradeMarker & { usedTradePrice?: boolean }; unit: string; timeZone: string }) {
  const czk = describeTradeCzk(trade);
  const buy = trade.kind === "buy";
  const clock = isExactClockTime(trade.occurredAt);
  const tradeTime = clock
    ? new Date(trade.occurredAt).toLocaleString("cs-CZ", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
    : trade.occurredAt.replace("T", " ");
  return (
    <div className="rounded-xl border border-[#41516a] bg-[#111e30] px-3.5 py-3 text-left text-xs text-white shadow-[0_12px_36px_rgba(0,0,0,0.50)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <strong className={buy ? "text-[#3fe0b1]" : "text-[#ff90a1]"}>
          {buy ? "＋ Skutečný nákup" : "− Skutečný prodej"}
        </strong>
        <span className="text-[10px] text-slate-400">{trade.provider}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="col-span-2">
          <p className="text-[10px] text-slate-400">Datum a čas provedení · {timeZone}</p>
          <strong className="mt-0.5 block tabular-nums">{tradeTime}</strong>
          {!clock ? <p className="text-[10px] text-amber-300">Původní záznam nedokládá časové pásmo; čas může být orientační.</p> : null}
        </div>
        <div>
          <p className="text-[10px] text-slate-400">Množství</p>
          <strong className="mt-0.5 block tabular-nums">{trade.quantity === null ? "Nedostupné" : preciseNumber(trade.quantity, 12) + " " + unit}</strong>
        </div>
        <div>
          <p className="text-[10px] text-slate-400">Cena za jednotku</p>
          <strong className="mt-0.5 block tabular-nums">{trade.price === null ? "Nedostupná" : preciseNumber(trade.price, 10) + " " + trade.priceCurrency}</strong>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] text-slate-400">Evidovaná hodnota obchodu</p>
          <strong className="mt-0.5 block tabular-nums">{trade.amount === null ? "Nedostupný" : (trade.amount > 0 ? "+" : "") + preciseNumber(trade.amount, 10) + " " + trade.amountCurrency}</strong>
        </div>
        {trade.fee !== null && trade.fee > 0 ? (
          <div className="col-span-2">
            <p className="text-[10px] text-slate-400">Evidovaný poplatek (účtován samostatně nebo již v částce)</p>
            <strong className="mt-0.5 block tabular-nums">{preciseNumber(trade.fee, 10)} {trade.feeCurrency}</strong>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.06] p-2.5">
        <p className="text-[10px] text-slate-300">
          {czk.quality === "recorded" ? "Částka v Kč · transakce vedena v CZK"
            : czk.quality === "cnb-converted" ? "Přepočet na Kč · historický kurz ČNB"
              : "Částka v Kč · nedoložena"}
        </p>
        <strong className="mt-1 block text-base tabular-nums">
          {czk.value === null ? "Nedostupná" : czk.value.toLocaleString("cs-CZ", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " Kč"}
        </strong>
        {czk.quality === "cnb-converted" ? (
          <p className="mt-1 text-[10px] leading-4 text-amber-200">Přepočet podle ČNB ≠ přesná korunová úhrada. Případné poplatky nemusejí být v částce zahrnuty.</p>
        ) : null}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-slate-300">
        {trade.usedTradePrice === false
          ? "Značka je pouze na časové ose: srovnatelnost realizační ceny s tržním grafem nebyla ověřena."
          : "Značka je na zaznamenané realizační ceně; podkladový kurzový graf obsahuje pouze denní závěry."}
      </p>
      <p className="mt-1 truncate text-[10px] text-slate-500" title={trade.externalId}>Účet: {trade.account} · ID: {trade.externalId}</p>
    </div>
  );
}

export function PositionPriceChart({
  data,
}: {
  data: PositionPriceChartData;
}) {
  const [range, setRange] = useState<Range>("MAX");
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [hoveredTradeId, setHoveredTradeId] = useState<string | null>(null);
  const [tipAnchor, setTipAnchor] = useState({ x: 16, y: 16 });
  const [tipPosition, setTipPosition] = useState({ x: 16, y: 16 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  const [showList, setShowList] = useState(false);

  const model = useMemo(() => {
    const end = timestamp(data.asOfDate) + 12 * 3600000; // include the entire current exchange day
    const start = domainStart(range, end);
    const prices = data.prices.filter((p) => timestamp(p.date) >= start && timestamp(p.date) <= end);
    const trades = data.trades.filter((t) => timestamp(t.date) >= start && timestamp(t.date) <= end);
    if (prices.length === 0) {
      // No market quote must not hide real trades. Offer a compact timeline
      // at the source execution timestamps without inventing any prices.
      const minX = range === "MAX" && trades.length
        ? Math.min(...trades.map(t => timestamp(t.date) - 12 * 3600000))
        : range === "MAX" ? end - 86400000 : start;
      const maxX = Math.max(end, minX + 86400000);
      const x = (value: number) => LEFT + PLOT_W * (value - minX) / (maxX - minX);
      const laneY = 78;
      const plotted: PlotTrade[] = trades.map(trade => ({
        ...trade, chartPrice: null, usedTradePrice: false,
        x: Math.max(LEFT, Math.min(W - RIGHT, x(
          chartExecutionTimestamp(trade.occurredAt, data.exchangeTimezone) ?? timestamp(trade.date),
        ))),
        y: laneY,
      }));
      return { prices, trades, plotted, ticks: [] as number[], path: "", area: "",
        gapCount: 0, laneY, x, y: () => laneY, minX, maxX, minY: 0, maxY: 1,
        unplaced: trades.length };
    }
    const minX = range === "MAX"
      ? Math.min(timestamp(prices[0].date) - 12 * 3600000,
        ...trades.map(t => timestamp(t.date) - 12 * 3600000))
      : start;
    const maxX = Math.max(end, timestamp(prices[prices.length - 1].date), minX + 86400000);
    const x = (value: number) => LEFT + PLOT_W * (value - minX) / (maxX - minX);
    const executions = trades.map((trade) => {
      const close = previousClose(data.prices, trade.date);
      // Only a documented, currency-matched execution price is plotted
      // vertically on the market-price axis. All other REAL executions are
      // shown on a separate date/time event lane, never at a fabricated price.
      const overlay = close === null ? null : overlayTradePrice(trade, close, data.currency);
      const valid = overlay?.usedTradePrice === true;
      return {
        ...trade,
        chartPrice: valid ? Number(trade.price) : null,
        usedTradePrice: valid,
      };
    });
    const values = [...prices.map((p) => p.close),
      ...executions.filter(t => t.chartPrice !== null).map(t => t.chartPrice as number)];
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
    const laneY = TOP + PLOT_H + 15;
    const plotted = executions.map((trade) => {
      const executedAt = chartExecutionTimestamp(trade.occurredAt, data.exchangeTimezone) ??
        timestamp(trade.date);
      return {
        ...trade,
        // No +/-5 px collision jitter: horizontal position is sourced from
        // the actual exchange-local clock timestamp, not a decoration.
        x: Math.max(LEFT, Math.min(W - RIGHT, x(executedAt))),
        y: trade.chartPrice === null ? laneY : y(trade.chartPrice),
      };
    });
    const ticks = Array.from({ length: 5 }, (_, index) => minY + (maxY - minY) * index / 4);
    return { prices, trades, plotted, ticks, path, area, gapCount: gaps, laneY, x, y, minX, maxX, minY, maxY, unplaced: plotted.filter(t => !t.usedTradePrice).length };
  }, [data.prices, data.trades, data.currency, data.asOfDate, data.exchangeTimezone, range]);

  const selectedTrade = model.trades.find((t) => t.id === selectedTradeId) ?? null;
  const activeTrade = model.plotted.find(t => t.id === hoveredTradeId) ??
    model.plotted.find(t => t.id === selectedTradeId) ?? null;
  const tooltipId = "trade-info-" + data.assetId.replace(/[^a-zA-Z0-9]/g, "");
  const hoveredPrice = model.prices.find((p) => p.date === hoverDate) ?? null;
  const latest = model.prices.at(-1) ?? null;
  const outdatedByDays = latest ? Math.floor(
    (Date.parse(data.asOfDate + "T00:00:00Z") -
      Date.parse(latest.date + "T00:00:00Z")) / 86400000,
  ) : null;
  const first = model.prices[0] ?? null;
  const pct = latest && first && first.close > 0
    ? (latest.close / first.close - 1) * 100 : null;
  const unit = data.assetClass === "crypto" ? data.symbol : "ks";
  const chartId = "position-price-" + data.assetId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);

  // The card is portaled to document.body, outside SectionCard's
  // overflow:hidden and the graph's horizontal scrolling container.
  // Measure the REAL rendered card, not a guessed 348px height.
  useLayoutEffect(() => {
    if (!activeTrade || !showTrades) return;
    const visual = window.visualViewport;
    const reposition = () => {
      const rect = tooltipRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? document.documentElement.clientWidth,
        height: visual?.height ?? window.innerHeight,
      };
      const next = placeTradeTooltip(
        tipAnchor, { width: rect.width, height: rect.height }, viewport,
      );
      setTipPosition(previous =>
        previous.x === next.x && previous.y === next.y ? previous : next,
      );
    };
    reposition();
    window.addEventListener("resize", reposition);
    visual?.addEventListener("resize", reposition);
    visual?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      visual?.removeEventListener("resize", reposition);
      visual?.removeEventListener("scroll", reposition);
    };
  }, [activeTrade?.id, selectedTradeId, showTrades, tipAnchor]);

  function moveTooltip(clientX: number, clientY: number) {
    setTipAnchor({ x: clientX, y: clientY });
  }

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
              href={"/investments/" + encodeURIComponent(asset.symbol) + "?asset=" + encodeURIComponent(asset.id) + "#price-chart"}
              prefetch={false}
              aria-current={asset.id === data.assetId ? "page" : undefined}
              className={["rounded-lg border px-2.5 py-1.5 text-xs transition",
                asset.id === data.assetId ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)] hover:text-white",
              ].join(" ")}
              title={asset.label}
            >{asset.symbol} · {asset.currency} · {asset.provider}</Link>
          ))}
          <span className="text-[11px] text-[var(--muted)]">Stejné ETF může mít více kotací. Každá burza a měna má vlastní graf i značky obchodů.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-[var(--muted)]">Poslední dostupný denní závěr</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {latest ? formatValue(latest.close, data.currency) : "Historické ceny zatím nejsou"}
          </p>
          {outdatedByDays !== null && outdatedByDays > 8 ? (
            <p role="status" className="mt-1 text-xs font-semibold text-[var(--warning)]">
              Pozor: poslední dostupná cena je {outdatedByDays} kalendářních dní stará; není to aktuální kurz.
            </p>
          ) : null}
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

      {data.quoteUnitNote ? (
        <p role="status" className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/[.04] px-3 py-2 text-xs text-[var(--muted)]">
          Přepočet burzovní jednotky: {data.quoteUnitNote}. Jde o jednotky téže britské kotace, nikoli o kurz GBP/CZK.
        </p>
      ) : null}
      {data.warning ? (
        <p role="status" className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/[.04] px-3 py-2 text-xs text-[var(--warning)]">
          Automatické načtení cen: {data.warning}. {data.prices.length ? "Zobrazují se již uložené ceny." : "Graf čeká na dostupná data."}
        </p>
      ) : null}

      {model.prices.length || model.plotted.length ? (
        <div className="finance-scrollbar overflow-x-auto rounded-2xl border border-[var(--border)] bg-[#0a1421]/40">
          {!model.prices.length ? (
            <p className="border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--warning)]">
              Cenová historie chybí. Zobrazujeme proto pouze časovou osu skutečných nákupů a prodejů, bez vymyšlené ceny.
            </p>
          ) : null}
          <svg
            viewBox={"0 0 " + W + " " + (model.prices.length ? H : 160)}
            className="block h-auto min-w-[680px] w-full touch-pan-y"
            role="group"
            aria-label={(model.prices.length ? "Cenový vývoj " : "Časová osa skutečných obchodů ") + data.symbol + " v " + data.currency + " s označenými skutečnými nákupy a prodeji"}
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
              return <text key={f} x={LEFT + PLOT_W * f} y={model.prices.length ? H - 19 : 140} fill="currentColor" opacity="0.65"
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
            {model.unplaced > 0 ? (
              <line x1={LEFT} x2={W - RIGHT} y1={model.laneY} y2={model.laneY}
                stroke="currentColor" strokeWidth="1" opacity="0.35" strokeDasharray="2 6" />
            ) : null}
            {showTrades ? model.plotted.map((trade) => {
              const active = trade.id === (hoveredTradeId || selectedTradeId);
              const color = trade.kind === "buy" ? "#16a982" : "#ea647c";
              return (
                <g
                  key={trade.id}
                  role="button" tabIndex={0}
                  aria-label={(trade.kind === "buy" ? "Nákup " : "Prodej ") + displayDate(trade.date) + ", " + trade.account + ". Zobrazit informace o obchodu"}
                  aria-describedby={active ? tooltipId : undefined}
                  onPointerEnter={(event) => {
                    setHoveredTradeId(trade.id);
                    moveTooltip(event.clientX, event.clientY);
                  }}
                  onPointerLeave={() => setHoveredTradeId(null)}
                  onFocus={(event) => {
                    setHoveredTradeId(trade.id);
                    const bounds = event.currentTarget.getBoundingClientRect();
                    moveTooltip(bounds.left + bounds.width / 2, bounds.top);
                  }}
                  onBlur={() => setHoveredTradeId(null)}
                  onClick={() => setSelectedTradeId(current => current === trade.id ? null : trade.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedTradeId(current => current === trade.id ? null : trade.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setSelectedTradeId(null);
                      setHoveredTradeId(null);
                    }
                  }}
                  className="cursor-pointer outline-none focus-visible:opacity-80"
                >
                  <circle cx={trade.x} cy={trade.y} r="19" fill="transparent" />
                  <circle cx={trade.x} cy={trade.y} r={active ? 13 : 10}
                    fill={trade.usedTradePrice ? color : "#111e30"}
                    stroke={active ? "#fff" : color} strokeWidth={trade.usedTradePrice ? 2.5 : 3}
                    strokeDasharray={trade.usedTradePrice ? undefined : "4 3"} />
                  <path d={trade.kind === "buy"
                    ? "M " + (trade.x - 4) + " " + trade.y + " h 8 M " + trade.x + " " + (trade.y - 4) + " v 8"
                    : "M " + (trade.x - 4) + " " + trade.y + " h 8"}
                    stroke="white" strokeWidth="2" strokeLinecap="round" pointerEvents="none" />
                </g>
              );
            }) : null}
          </svg>
          {activeTrade && showTrades && typeof document !== "undefined" ? createPortal(
            <div role="tooltip" id={tooltipId} ref={tooltipRef}
              className={(selectedTradeId === activeTrade.id ? "pointer-events-auto" : "pointer-events-none") +
                " fixed z-[200] max-h-[calc(100dvh-16px)] w-[300px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain"}
              style={{left: tipPosition.x, top: tipPosition.y}}>
              <TradeInfoCard trade={activeTrade} unit={unit} timeZone={data.exchangeTimezone} />
              {selectedTradeId === activeTrade.id ? (
                <button type="button" aria-label="Zavřít kartu obchodu"
                  className="absolute right-3 top-9 rounded-md border border-white/15 bg-[#253951] px-2 py-1 text-xs text-white hover:bg-[#344963]"
                  onClick={() => setSelectedTradeId(null)}>×</button>
              ) : null}
            </div>, document.body,
          ) : null}
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs">
            <div role="status" aria-live="polite" className="text-[var(--muted)]">
              {selectedTrade ? (
                <span>
                  <strong className={selectedTrade.kind === "buy" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {selectedTrade.kind === "buy" ? "＋ Nákup" : "− Prodej"}
                  </strong>{" "}
                  {new Date(selectedTrade.occurredAt).toLocaleString("cs-CZ")} · {selectedTrade.account}
                  {selectedTrade.quantity !== null ? " · " + preciseNumber(selectedTrade.quantity, 12) + " " + unit : ""}
                  {selectedTrade.price !== null ? " · provedená cena " + preciseNumber(selectedTrade.price, 10) + " " + selectedTrade.priceCurrency : ""}
                </span>
              ) : hoveredPrice ? (
                <span>{displayDate(hoveredPrice.date)} · <strong className="text-[var(--foreground)]">{formatValue(hoveredPrice.close, data.currency)}</strong></span>
              ) : <span>Pohybem nad grafem zobrazíš kurz; najetím na +/− otevřeš kartu obchodu včetně částky v Kč. Kliknutím ji připneš, opětovným kliknutím nebo × zavřeš.</span>}
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
          {" · "}Plné kolečko = zaznamenaná realizační cena ve srovnatelné měně; duté kolečko pod grafem = skutečný obchod, jehož cenu nelze bezpečně zasadit do cenové osy. Kolečko je vždy na datu a času záznamu, bez umělého vodorovného posunu.
        </p>
        <p>{data.source || "Zatím bez cenového zdroje"} · {data.ticker || data.symbol} · {data.currency}</p>
      </div>
      {data.tradesTruncated ? <p className="text-xs text-[var(--warning)]">Historie instrumentu má více než 5 000 obchodů; kvůli výkonu jsou zde načteny poslední 5 000. Kompletní historii najdeš v exportu transakcí.</p> : null}
      {model.gapCount > 0 ? <p className="text-xs text-[var(--warning)]">V historii je {model.gapCount} delších mezer v denních kurzech. Mezi nimi nespojujeme cenu vymyšlenou úsečkou.</p> : null}
      {model.unplaced > 0 && model.prices.length > 0 ? <p className="text-xs text-[var(--warning)]">
        {model.unplaced} obchodů nemá bezpečně srovnatelnou realizační cenu (měna, split nebo chybějící denní kurz). Dutá kolečka jsou na samostatné časové ose; úplná data jsou v kartě obchodu.
      </p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">Obchody ve zvoleném období: {model.trades.length.toLocaleString("cs-CZ")}</p>
        <button type="button" className="finance-action !min-h-9 !px-3" aria-expanded={showList}
          onClick={() => setShowList((current) => !current)}>
          {showList ? "Skrýt seznam obchodů" : "Zobrazit seznam obchodů"}
        </button>
      </div>
      {!model.prices.length && selectedTrade ? (
        <div role="status" className="max-w-sm">
          <TradeInfoCard trade={{...selectedTrade, usedTradePrice: false}} unit={unit} timeZone={data.exchangeTimezone} />
        </div>
      ) : null}
      {showList ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-[var(--border)]">
          {model.trades.length ? model.trades.slice().reverse().map((trade) => (
            <button key={trade.id} type="button" onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              moveTooltip(event.clientX || bounds.right, event.clientY || bounds.top);
              setHoveredTradeId(null);
              setSelectedTradeId(trade.id);
            }}
              className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 text-left text-xs last:border-0 hover:bg-white/[.04]">
              <span><strong className={trade.kind === "buy" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                {trade.kind === "buy" ? "＋ Nákup" : "− Prodej"}
              </strong> · {new Date(trade.occurredAt).toLocaleString("cs-CZ")} · {trade.account}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block">{trade.quantity === null ? "Množství neznámé" : preciseNumber(trade.quantity, 12) + " " + unit}</span>
                <span className="mt-0.5 block text-[var(--muted)]">{trade.price === null ? "Cena nedostupná" : preciseNumber(trade.price, 10) + " " + trade.priceCurrency}</span>
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
