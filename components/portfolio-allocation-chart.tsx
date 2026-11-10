"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { providerColor, providerLabel } from "@/lib/provider-visuals";
import {
  allocationCoverage,
  compactAllocationSlices,
  getPortfolioAllocationViews,
} from "@/lib/portfolio-allocation.mjs";

export interface AllocationClass {
  label: string;
  valueCzk: number;
}
export interface AllocationAccount {
  provider: string;
  valueCzk: number;
}
export interface AllocationHolding {
  assetId: string;
  symbol: string;
  name: string;
  assetClass: string;
  valueCzk: number;
}
type View = "classes" | "platforms" | "positions";

const PALETTE = [
  "#74b3ff", "#80e2ba", "#b9a0ff", "#f5ba69", "#ef8395",
  "#4dced5", "#d9d16e", "#a9c8ef", "#cf9ae1", "#95ce9f",
];
const CLASS_LABELS: Record<string, string> = {
  stock: "Akcie", etf: "ETF", crypto: "Kryptoměny",
  cash: "Hotovost", p2p: "P2P investice", bond: "Dluhopisy",
  fund: "Fondy", commodity: "Komodity",
  other: "Ostatní aktiva", unclassified: "Nezařazená hodnota",
};
const fmt = (value: number) =>
  value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
const percent = (ratio: number) =>
  (ratio * 100).toLocaleString("cs-CZ", { maximumFractionDigits: ratio < .001 ? 2 : 1 }) + " %";

/** SVG annular wedge. A full circle is drawn using two half arcs. */
function wedge(start: number, end: number, outer = 116, inner = 76): string {
  const full = end - start >= 1 - 1e-8;
  const gap = full ? 0 : Math.min(.004, Math.max(0, (end - start) / 7));
  const from = (start + gap) * Math.PI * 2 - Math.PI / 2;
  const to = (end - gap) * Math.PI * 2 - Math.PI / 2;
  const point = (r: number, a: number) =>
    [140 + r * Math.cos(a), 140 + r * Math.sin(a)]
      .map((n) => n.toFixed(3)).join(",");
  if (full) {
    return [
      "M", point(outer, -Math.PI / 2),
      "A", outer, outer, 0, 1, 1, point(outer, Math.PI / 2),
      "A", outer, outer, 0, 1, 1, point(outer, -Math.PI / 2),
      "M", point(inner, -Math.PI / 2),
      "A", inner, inner, 0, 1, 0, point(inner, Math.PI / 2),
      "A", inner, inner, 0, 1, 0, point(inner, -Math.PI / 2),
      "Z",
    ].join(" ");
  }
  const large = to - from > Math.PI ? 1 : 0;
  return [
    "M", point(outer, from),
    "A", outer, outer, 0, large, 1, point(outer, to),
    "L", point(inner, to),
    "A", inner, inner, 0, large, 0, point(inner, from),
    "Z",
  ].join(" ");
}

export function PortfolioAllocationChart({
  allocation, accounts, holdings, netWorthCzk, compact = false,
}: {
  allocation: AllocationClass[];
  accounts: AllocationAccount[];
  holdings: AllocationHolding[];
  netWorthCzk: number;
  compact?: boolean;
}) {
  const [view, setView] = useState<View>("classes");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const views = useMemo(
    () => getPortfolioAllocationViews({ allocation, accounts, holdings }),
    [allocation, accounts, holdings],
  );
  const allGroups = views[view];
  const slices = useMemo(() => compactAllocationSlices(allGroups, compact ? 7 : 10),
    [allGroups, compact]);
  const coverage = allocationCoverage(allGroups, netWorthCzk);
  const total = coverage.chartedCzk;
  const highlighted =
    slices.find((item) => item.id === hoverId) ??
    slices.find((item) => item.id === selectedId) ?? null;
  const chartGroups = useMemo(() => {
    let position = 0;
    return slices.map((slice, index) => {
      const start = total > 0 ? position / total : 0;
      position += slice.amountCzk;
      return {
        ...slice, start, end: total > 0 ? position / total : 0,
        color: view === "platforms"
          ? providerColor(slice.id)
          : view === "classes"
            ? ({
              stock: "#74b3ff", etf: "#aa8af7", crypto: "#48d9b0",
              cash: "#f1b75f", p2p: "#ee9d87", unclassified: "#e2a75c",
            } as Record<string, string>)[slice.id] ?? PALETTE[index % PALETTE.length]
            : PALETTE[index % PALETTE.length],
      };
    });
  }, [slices, total, view]);
  const heading = {
    classes: "Třídy aktiv",
    platforms: "Platformy",
    positions: "Jednotlivé pozice",
  }[view];

  return (
    <div id="allocation-chart" className="min-w-0 scroll-mt-32">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Typ rozložení portfolia">
        {([
          ["classes", "Třídy aktiv"],
          ["platforms", "Platformy"],
          ["positions", "Pozice"],
        ] as Array<[View, string]>).map(([key, label]) => (
          <button
            type="button" key={key} aria-pressed={view === key}
            onClick={() => { setView(key); setHoverId(null); setSelectedId(null); }}
            className={[
              "rounded-xl border px-3.5 py-2 text-xs font-semibold transition",
              view === key
                ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] bg-white/[.025] text-[var(--muted)] hover:text-[var(--foreground)]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {total <= 0 ? (
        <p className="mt-5 rounded-xl border border-[var(--border)] p-5 text-sm text-[var(--muted)]">
          Pro tento pohled zatím nejsou evidovány kladné hodnoty. Připoj účet
          nebo zkontroluj aktuální pozice. Žádné rozložení neodhadujeme.
        </p>
      ) : (
        <div className={["mt-4 grid items-center gap-5",
          compact ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" :
            "md:grid-cols-[minmax(250px,1fr)_minmax(0,1.3fr)]",
        ].join(" ")}>
          <div className="relative mx-auto w-full max-w-[300px]">
            <svg
              viewBox="0 0 280 280" className="h-auto w-full"
              role="img"
              aria-label={"Rozložení portfolia: " + heading + ", základ " + fmt(total)}
            >
              <circle cx="140" cy="140" r="96" stroke="rgba(174,195,216,.08)"
                strokeWidth="40" fill="none"/>
              {chartGroups.map((item) => {
                const active = highlighted?.id === item.id;
                const dim = highlighted !== null && !active;
                return (
                  <g key={item.id}>
                    <path
                      d={wedge(item.start, item.end)}
                      fill={item.color}
                      opacity={dim ? .3 : active ? 1 : .87}
                      stroke={active ? "#f2f7fd" : "none"}
                      strokeWidth={active ? 1.5 : 0}
                      onPointerEnter={() => setHoverId(item.id)}
                      onPointerLeave={() => setHoverId(null)}
                      onClick={() => setSelectedId((old) => old === item.id ? null : item.id)}
                      className="cursor-pointer transition-opacity duration-150"
                    />
                    <title>{item.label + ": " + fmt(item.amountCzk) + " (" + percent(item.amountCzk / total) + ")"}</title>
                  </g>
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[24%] text-center">
              <p className="max-w-full truncate text-[11px] font-medium text-[var(--muted)]">
                {highlighted ? (view === "platforms" ? providerLabel(highlighted.label) :
                  view === "classes" ? CLASS_LABELS[highlighted.label] ?? highlighted.label :
                    highlighted.label) : "Zobrazená hodnota"}
              </p>
              <p className="mt-1 text-[clamp(13px,2vw,20px)] font-semibold tracking-tight tabular-nums">
                {fmt(highlighted?.amountCzk ?? total)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[var(--accent)]">
                {highlighted ? percent(highlighted.amountCzk / total) : slices.length + " skupin"}
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold">{heading}</p>
              <span className="text-[11px] text-[var(--muted)]">{allGroups.length} položek</span>
            </div>
            <div className="finance-scrollbar max-h-[310px] space-y-1 overflow-y-auto pr-1">
              {chartGroups.map((item) => {
                const label = view === "platforms" ? providerLabel(item.label) :
                  view === "classes" ? CLASS_LABELS[item.label] ?? item.label : item.label;
                const active = highlighted?.id === item.id;
                return (
                  <button
                    key={item.id} type="button"
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId((old) => old === item.id ? null : item.id)}
                    onPointerEnter={() => setHoverId(item.id)}
                    onPointerLeave={() => setHoverId(null)}
                    className={[
                      "w-full rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-white/20 bg-white/[.065]"
                        : "border-transparent hover:border-[var(--border)] hover:bg-white/[.035]",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} />
                        <span className="truncate text-xs font-medium" title={label}>
                          {label}
                          {"groupedCount" in item ? " (" + item.groupedCount + ")" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs font-semibold tabular-nums">
                        {percent(item.amountCzk / total)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-3 pl-5">
                      <span className="text-[11px] tabular-nums text-[var(--muted)]">{fmt(item.amountCzk)}</span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[.06] sm:w-24">
                        <span className="block h-full rounded-full"
                          style={{ width: (100 * item.amountCzk / total) + "%", backgroundColor: item.color }} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {highlighted?.href ? (
              <Link href={highlighted.href} prefetch={false}
                className="mt-3 inline-flex text-xs font-semibold text-[var(--accent)] hover:underline">
                Otevřít detail pozice {highlighted.label} ↗
              </Link>
            ) : null}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
        {view === "classes"
          ? "Třídy aktiv vycházejí z aktuálně evidovaných hodnot pozic, hotovosti a P2P. ETF se zde počítají jako ETF, nikoli jako podkladové akcie."
          : view === "platforms"
            ? "Podíly jsou součtem kladných hodnot jednotlivých účtů, seskupených podle poskytovatele. Nejde o rozdělení investic uvnitř jednotlivých platforem."
            : "Stejný instrument napříč účty se sloučí podle interní identity. Hotovost a neidentifikované zůstatky nejsou v základu pozic zahrnuty."}
      </p>
      {view === "classes" && coverage.mismatch ? (
        <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--warning)]">
          Součet kladných tříd ({fmt(coverage.chartedCzk)}) se liší od
          vykázaného čistého majetku ({fmt(netWorthCzk)}).
          Procenta počítáme pouze ze zobrazených kladných hodnot; chybějící část
          ani záporné zůstatky neodhadujeme.
        </p>
      ) : null}
      {view === "positions" ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Detailní rozložení ETF na podkladové akcie a jejich překryvy najdeš v{" "}
          <Link href="/xray" prefetch={false} className="font-semibold text-[var(--accent)] hover:underline">
            Portfolio X-Ray ↗
          </Link>.
        </p>
      ) : null}
    </div>
  );
}
