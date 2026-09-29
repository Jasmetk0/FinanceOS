"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PortfolioChartMetric = "value" | "profit" | "return" | "contributions";

export interface PortfolioChartMetricData {
  valueCzk: number | null;
  contributedCzk: number;
  profitCzk: number | null;
  returnPct: number | null;
}

export interface PortfolioChartPoint {
  date: string;
  total: PortfolioChartMetricData;
  providers: Record<string, PortfolioChartMetricData>;
}

export interface PortfolioChartData {
  providers: string[];
  points: PortfolioChartPoint[];
}

const VIEW_W = 1000;
const VIEW_H = 380;
const LEFT = 82;
const RIGHT = 24;
const TOP = 22;
const BOTTOM = 54;
const PLOT_W = VIEW_W - LEFT - RIGHT;
const PLOT_H = VIEW_H - TOP - BOTTOM;

const DEFAULT_COLORS: Record<string, string> = {
  trading212: "#4f8cff",
  kraken: "#a970ff",
  investown: "#f4ad45",
  mintos: "#2fcf91",
  manual: "#94a3b8",
};

const FALLBACK_COLORS = [
  "#42c7c7",
  "#ff7f8e",
  "#d7b95f",
  "#7f9cf5",
  "#d38df0",
  "#6fce7e",
];

const PROVIDER_LABELS: Record<string, string> = {
  trading212: "Trading 212",
  kraken: "Kraken",
  investown: "Investown",
  mintos: "Mintos",
  manual: "Manual",
};

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] || provider;
}

function fallbackColor(provider: string, index: number) {
  return DEFAULT_COLORS[provider] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function metricValue(
  metric: PortfolioChartMetric,
  data: PortfolioChartMetricData,
) {
  if (metric === "value") return data.valueCzk;
  if (metric === "profit") return data.profitCzk;
  if (metric === "return") return data.returnPct;
  return data.contributedCzk;
}

function metricLabel(metric: PortfolioChartMetric) {
  if (metric === "value") return "Hodnota portfolia";
  if (metric === "profit") return "Zisk / ztráta vůči vkladům";
  if (metric === "return") return "Výnos vůči čistým vkladům";
  return "Čisté vklady";
}

function formatCurrency(value: number) {
  return (
    value.toLocaleString("cs-CZ", {
      maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0,
    }) + " Kč"
  );
}

function formatCompact(value: number, metric: PortfolioChartMetric) {
  if (metric === "return") {
    return (
      value.toLocaleString("cs-CZ", {
        maximumFractionDigits: 1,
      }) + " %"
    );
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return (
      (value / 1_000_000).toLocaleString("cs-CZ", {
        maximumFractionDigits: 1,
      }) + " mil."
    );
  }
  if (absolute >= 1_000) {
    return (
      (value / 1_000).toLocaleString("cs-CZ", {
        maximumFractionDigits: 0,
      }) + " tis."
    );
  }
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
}

function formatValue(value: number | null, metric: PortfolioChartMetric) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (metric === "return") {
    return (
      (value > 0 ? "+" : "") +
      value.toLocaleString("cs-CZ", {
        maximumFractionDigits: 2,
      }) +
      " %"
    );
  }
  return (value > 0 && metric === "profit" ? "+" : "") + formatCurrency(value);
}

function parseDate(date: string) {
  return new Date(date + "T12:00:00").getTime();
}

function dateLabel(date: string, withYear = true) {
  return new Date(date + "T12:00:00").toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
  });
}

function getPeriodStart(
  period: string,
  latestDate: string,
): string | null {
  if (period === "ALL") return null;

  const latest = new Date(latestDate + "T12:00:00");
  const start = new Date(latest);

  if (period === "1M") start.setMonth(start.getMonth() - 1);
  else if (period === "3M") start.setMonth(start.getMonth() - 3);
  else if (period === "6M") start.setMonth(start.getMonth() - 6);
  else if (period === "1Y") start.setFullYear(start.getFullYear() - 1);
  else if (period === "YTD") {
    start.setMonth(0, 1);
  }

  return start.toISOString().slice(0, 10);
}

function buildPath(
  points: PortfolioChartPoint[],
  getter: (point: PortfolioChartPoint) => number | null,
  xScale: (date: string) => number,
  yScale: (value: number) => number,
) {
  let path = "";
  let drawing = false;

  for (const point of points) {
    const value = getter(point);
    if (value === null || !Number.isFinite(value)) {
      drawing = false;
      continue;
    }

    const command = drawing ? "L" : "M";
    path += command + xScale(point.date).toFixed(2) + "," + yScale(value).toFixed(2) + " ";
    drawing = true;
  }

  return path.trim();
}

export function PortfolioHistoryChart({
  data,
  defaultMetric = "value",
  compact = false,
}: {
  data: PortfolioChartData;
  defaultMetric?: PortfolioChartMetric;
  compact?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [metric, setMetric] = useState<PortfolioChartMetric>(defaultMetric);
  const [period, setPeriod] = useState("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showTotal, setShowTotal] = useState(true);
  const [showContributions, setShowContributions] = useState(true);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(
    data.providers,
  );
  const [colors, setColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.providers.map((provider, index) => [
        provider,
        fallbackColor(provider, index),
      ]),
    ),
  );
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("financeos-provider-colors");
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, string>;
      setColors((current) => ({ ...current, ...parsed }));
    } catch {
      // Keep defaults if local settings are malformed.
    }
  }, []);

  useEffect(() => {
    setSelectedProviders((current) => {
      const valid = current.filter((provider) => data.providers.includes(provider));
      const additions = data.providers.filter((provider) => !valid.includes(provider));
      return [...valid, ...additions];
    });
    setColors((current) => {
      const next = { ...current };
      data.providers.forEach((provider, index) => {
        if (!next[provider]) next[provider] = fallbackColor(provider, index);
      });
      return next;
    });
  }, [data.providers]);

  const earliest = data.points[0]?.date ?? "";
  const latest = data.points.at(-1)?.date ?? "";

  const filtered = useMemo(() => {
    if (!data.points.length) return [];

    let start: string | null = null;
    let end: string | null = latest || null;

    if (period === "CUSTOM") {
      start = customStart || null;
      end = customEnd || latest || null;
    } else {
      start = latest ? getPeriodStart(period, latest) : null;
    }

    return data.points.filter(
      (point) =>
        (!start || point.date >= start) &&
        (!end || point.date <= end),
    );
  }, [data.points, period, customStart, customEnd, latest]);

  const displayProviders = selectedProviders.filter((provider) =>
    data.providers.includes(provider),
  );

  const chart = useMemo(() => {
    if (filtered.length < 1) return null;

    const timestamps = filtered.map((point) => parseDate(point.date));
    const minX = Math.min(...timestamps);
    const maxX = Math.max(...timestamps);

    const values: number[] = [];

    if (showTotal) {
      for (const point of filtered) {
        const value = metricValue(metric, point.total);
        if (value !== null && Number.isFinite(value)) values.push(value);
      }
    }

    for (const provider of displayProviders) {
      for (const point of filtered) {
        const providerData = point.providers[provider];
        if (!providerData) continue;
        const value = metricValue(metric, providerData);
        if (value !== null && Number.isFinite(value)) values.push(value);
      }
    }

    if (metric === "value" && showContributions) {
      for (const point of filtered) {
        values.push(point.total.contributedCzk);
      }
    }

    if (!values.length) return null;
    if (metric === "profit" || metric === "return") values.push(0);

    let minY = Math.min(...values);
    let maxY = Math.max(...values);
    const span = Math.max(1, maxY - minY);
    const padding = span * 0.1;

    minY -= padding;
    maxY += padding;

    if (metric === "value" || metric === "contributions") {
      minY = Math.min(0, minY);
    }

    if (maxY === minY) maxY = minY + 1;

    const xScale = (date: string) =>
      LEFT +
      (maxX === minX
        ? PLOT_W / 2
        : ((parseDate(date) - minX) / (maxX - minX)) * PLOT_W);

    const yScale = (value: number) =>
      TOP + ((maxY - value) / (maxY - minY)) * PLOT_H;

    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const value = maxY - ratio * (maxY - minY);
      return {
        value,
        y: TOP + ratio * PLOT_H,
      };
    });

    const xTicks = Array.from({ length: Math.min(5, filtered.length) }, (_, index) => {
      const ratio =
        Math.min(5, filtered.length) === 1
          ? 0
          : index / (Math.min(5, filtered.length) - 1);
      const timestamp = minX + ratio * (maxX - minX);
      return {
        timestamp,
        x: LEFT + ratio * PLOT_W,
        date: new Date(timestamp).toISOString().slice(0, 10),
      };
    });

    return { minX, maxX, minY, maxY, xScale, yScale, yTicks, xTicks };
  }, [
    filtered,
    metric,
    showTotal,
    showContributions,
    displayProviders,
  ]);

  const hoverPoint = useMemo(
    () => filtered.find((point) => point.date === hoverDate) ?? null,
    [filtered, hoverDate],
  );

  const firstPoint = filtered[0] ?? null;
  const lastPoint = filtered.at(-1) ?? null;
  const periodNetContribution =
    firstPoint && lastPoint
      ? lastPoint.total.contributedCzk - firstPoint.total.contributedCzk
      : 0;
  const periodProfitChange =
    firstPoint?.total.profitCzk !== null &&
    firstPoint?.total.profitCzk !== undefined &&
    lastPoint?.total.profitCzk !== null &&
    lastPoint?.total.profitCzk !== undefined
      ? lastPoint.total.profitCzk - firstPoint.total.profitCzk
      : null;

  function updateProviderColor(provider: string, color: string) {
    const next = { ...colors, [provider]: color };
    setColors(next);
    try {
      window.localStorage.setItem(
        "financeos-provider-colors",
        JSON.stringify(next),
      );
    } catch {
      // Local persistence is best-effort only.
    }
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!chart || !filtered.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relative = (event.clientX - rect.left) / Math.max(1, rect.width);
    const viewX = relative * VIEW_W;
    const clamped = Math.max(LEFT, Math.min(LEFT + PLOT_W, viewX));
    const ratio = (clamped - LEFT) / PLOT_W;
    const targetTime = chart.minX + ratio * (chart.maxX - chart.minX);

    let nearest = filtered[0];
    let distance = Math.abs(parseDate(nearest.date) - targetTime);
    for (const point of filtered.slice(1)) {
      const nextDistance = Math.abs(parseDate(point.date) - targetTime);
      if (nextDistance < distance) {
        nearest = point;
        distance = nextDistance;
      }
    }

    setHoverDate(nearest.date);
  }

  if (data.points.length < 1) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
        <p className="max-w-lg text-sm leading-6 text-[var(--muted)]">
          Pro graf zatím nejsou k dispozici portfolio snapshoty.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["value", "Hodnota"],
              ["profit", "Zisk / ztráta"],
              ["return", "Výnos %"],
              ["contributions", "Čisté vklady"],
            ] as Array<[PortfolioChartMetric, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMetric(value)}
              className={[
                "rounded-lg border px-2.5 py-1.5 text-xs transition",
                metric === value
                  ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-white/8 bg-white/[0.02] text-[var(--muted)] hover:text-white",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {["1M", "3M", "6M", "YTD", "1Y", "ALL"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={[
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                period === value
                  ? "border-white/18 bg-white/8 text-white"
                  : "border-white/7 text-[var(--muted)] hover:text-white",
              ].join(" ")}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPeriod("CUSTOM");
              setCustomStart(customStart || earliest);
              setCustomEnd(customEnd || latest);
            }}
            className={[
              "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
              period === "CUSTOM"
                ? "border-white/18 bg-white/8 text-white"
                : "border-white/7 text-[var(--muted)] hover:text-white",
            ].join(" ")}
          >
            Vlastní
          </button>
        </div>
      </div>

      {period === "CUSTOM" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label>
            <span className="block text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Od
            </span>
            <input
              type="date"
              min={earliest}
              max={latest}
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
              className="mt-1 rounded-lg border border-white/8 bg-[#0b1511] px-2.5 py-1.5 text-xs"
            />
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Do
            </span>
            <input
              type="date"
              min={earliest}
              max={latest}
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
              className="mt-1 rounded-lg border border-white/8 bg-[#0b1511] px-2.5 py-1.5 text-xs"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-xs">
          <input
            type="checkbox"
            checked={showTotal}
            onChange={(event) => setShowTotal(event.target.checked)}
          />
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "#f6fbf8" }}
          />
          Celkem
        </label>

        {data.providers.map((provider, index) => {
          const checked = selectedProviders.includes(provider);
          return (
            <div
              key={provider}
              className="flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.02] pr-1"
            >
              <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    setSelectedProviders((current) =>
                      event.target.checked
                        ? [...new Set([...current, provider])]
                        : current.filter((item) => item !== provider),
                    )
                  }
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      colors[provider] || fallbackColor(provider, index),
                  }}
                />
                {providerLabel(provider)}
              </label>
              <input
                aria-label={"Barva " + providerLabel(provider)}
                type="color"
                value={colors[provider] || fallbackColor(provider, index)}
                onChange={(event) =>
                  updateProviderColor(provider, event.target.value)
                }
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
          );
        })}

        {metric === "value" ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={showContributions}
              onChange={(event) => setShowContributions(event.target.checked)}
            />
            Vklady jako baseline
          </label>
        ) : null}
      </div>

      {!compact && lastPoint ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <MiniStat
            label="Hodnota na konci"
            value={formatValue(lastPoint.total.valueCzk, "value")}
          />
          <MiniStat
            label="Čisté vklady celkem"
            value={formatValue(lastPoint.total.contributedCzk, "contributions")}
          />
          <MiniStat
            label="Zisk / ztráta celkem"
            value={formatValue(lastPoint.total.profitCzk, "profit")}
            positive={(lastPoint.total.profitCzk ?? 0) >= 0}
          />
          <MiniStat
            label="Změna P/L v období"
            value={formatValue(periodProfitChange, "profit")}
            positive={(periodProfitChange ?? 0) >= 0}
            hint={
              periodNetContribution
                ? "Čisté vklady v období: " +
                  formatCurrency(periodNetContribution)
                : undefined
            }
          />
        </div>
      ) : null}

      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/7 bg-black/10">
        {hoverPoint ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 min-w-[190px] rounded-xl border border-white/10 bg-[#0a1410]/95 p-3 shadow-xl backdrop-blur">
            <p className="text-xs font-semibold">{dateLabel(hoverPoint.date)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {metricLabel(metric)}
            </p>
            {showTotal ? (
              <TooltipRow
                label="Celkem"
                color="#f6fbf8"
                value={formatValue(metricValue(metric, hoverPoint.total), metric)}
              />
            ) : null}
            {displayProviders.map((provider, index) => (
              <TooltipRow
                key={provider}
                label={providerLabel(provider)}
                color={colors[provider] || fallbackColor(provider, index)}
                value={formatValue(
                  hoverPoint.providers[provider]
                    ? metricValue(metric, hoverPoint.providers[provider])
                    : null,
                  metric,
                )}
              />
            ))}
            <div className="mt-2 border-t border-white/8 pt-2 text-[11px] text-[var(--muted)]">
              Vklady: {formatCurrency(hoverPoint.total.contributedCzk)}
              <br />
              P/L: {formatValue(hoverPoint.total.profitCzk, "profit")}
            </div>
          </div>
        ) : null}

        {chart ? (
          <svg
            ref={svgRef}
            viewBox={"0 0 " + VIEW_W + " " + VIEW_H}
            preserveAspectRatio="none"
            className={compact ? "h-64 w-full" : "h-[360px] w-full"}
            role="img"
            aria-label={metricLabel(metric)}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverDate(null)}
          >
            <rect
              x={LEFT}
              y={TOP}
              width={PLOT_W}
              height={PLOT_H}
              fill="rgba(255,255,255,0.008)"
            />

            {chart.yTicks.map((tick) => (
              <g key={tick.y}>
                <line
                  x1={LEFT}
                  x2={LEFT + PLOT_W}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="rgba(255,255,255,0.065)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={LEFT - 12}
                  y={tick.y + 4}
                  textAnchor="end"
                  fill="rgba(237,247,242,0.52)"
                  fontSize="12"
                >
                  {formatCompact(tick.value, metric)}
                </text>
              </g>
            ))}

            {chart.xTicks.map((tick, index) => (
              <g key={tick.timestamp}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={TOP}
                  y2={TOP + PLOT_H}
                  stroke="rgba(255,255,255,0.025)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={tick.x}
                  y={TOP + PLOT_H + 28}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === chart.xTicks.length - 1
                        ? "end"
                        : "middle"
                  }
                  fill="rgba(237,247,242,0.52)"
                  fontSize="12"
                >
                  {dateLabel(tick.date)}
                </text>
              </g>
            ))}

            {metric === "profit" || metric === "return" ? (
              chart.minY <= 0 && chart.maxY >= 0 ? (
                <line
                  x1={LEFT}
                  x2={LEFT + PLOT_W}
                  y1={chart.yScale(0)}
                  y2={chart.yScale(0)}
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null
            ) : null}

            {metric === "value" && showContributions ? (
              <path
                d={buildPath(
                  filtered,
                  (point) => point.total.contributedCzk,
                  chart.xScale,
                  chart.yScale,
                )}
                fill="none"
                stroke="rgba(237,247,242,0.34)"
                strokeWidth="1.4"
                strokeDasharray="6 5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}

            {showTotal ? (
              <path
                d={buildPath(
                  filtered,
                  (point) => metricValue(metric, point.total),
                  chart.xScale,
                  chart.yScale,
                )}
                fill="none"
                stroke="#f6fbf8"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}

            {displayProviders.map((provider, index) => (
              <path
                key={provider}
                d={buildPath(
                  filtered,
                  (point) =>
                    point.providers[provider]
                      ? metricValue(metric, point.providers[provider])
                      : null,
                  chart.xScale,
                  chart.yScale,
                )}
                fill="none"
                stroke={colors[provider] || fallbackColor(provider, index)}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {hoverPoint ? (
              <>
                <line
                  x1={chart.xScale(hoverPoint.date)}
                  x2={chart.xScale(hoverPoint.date)}
                  y1={TOP}
                  y2={TOP + PLOT_H}
                  stroke="rgba(255,255,255,0.42)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                {showTotal &&
                metricValue(metric, hoverPoint.total) !== null ? (
                  <circle
                    cx={chart.xScale(hoverPoint.date)}
                    cy={chart.yScale(
                      metricValue(metric, hoverPoint.total) as number,
                    )}
                    r="4"
                    fill="#f6fbf8"
                  />
                ) : null}
              </>
            ) : null}
          </svg>
        ) : (
          <div className="grid h-64 place-items-center px-6 text-center text-sm text-[var(--muted)]">
            Pro zvolený filtr nejsou data.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
        <span>
          {filtered.length.toLocaleString("cs-CZ")} bodů ·{" "}
          {filtered[0] ? dateLabel(filtered[0].date) : "—"} →{" "}
          {filtered.at(-1) ? dateLabel(filtered.at(-1)!.date) : "—"}
        </span>
        <span>
          Najetím na graf zobrazíš přesné datum, hodnotu, vklady a P/L.
        </span>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  positive,
  hint,
}: {
  label: string;
  value: string;
  positive?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-mono text-sm font-semibold",
          positive === true ? "text-[var(--accent)]" : "",
          positive === false ? "text-[var(--danger)]" : "",
        ].join(" ")}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function TooltipRow({
  label,
  color,
  value,
}: {
  label: string;
  color: string;
  value: string;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-4 text-xs">
      <span className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}


export function InteractiveTimeSeriesChart({
  data,
  label,
  valueFormat = "currency",
  color = "#69e3aa",
  emptyText = "Pro graf zatím nejsou data.",
}: {
  data: Array<{ date: string; value: number }>;
  label: string;
  valueFormat?: "currency" | "percent" | "number";
  color?: string;
  emptyText?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [period, setPeriod] = useState("ALL");
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  const points = useMemo(
    () =>
      data
        .filter(
          (item) =>
            item.date &&
            Number.isFinite(item.value) &&
            !Number.isNaN(parseDate(item.date)),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [data],
  );

  const latest = points.at(-1)?.date ?? "";
  const filtered = useMemo(() => {
    if (!latest) return [];
    const start = getPeriodStart(period, latest);
    return points.filter((point) => !start || point.date >= start);
  }, [points, latest, period]);

  const chart = useMemo(() => {
    if (!filtered.length) return null;
    const times = filtered.map((point) => parseDate(point.date));
    const minX = Math.min(...times);
    const maxX = Math.max(...times);
    const values = filtered.map((point) => point.value);

    let minY = Math.min(...values);
    let maxY = Math.max(...values);
    if (valueFormat === "currency" || valueFormat === "number") {
      minY = Math.min(0, minY);
    }
    const span = Math.max(1, maxY - minY);
    minY -= span * 0.08;
    maxY += span * 0.08;
    if (maxY === minY) maxY = minY + 1;

    const xScale = (date: string) =>
      LEFT +
      (maxX === minX
        ? PLOT_W / 2
        : ((parseDate(date) - minX) / (maxX - minX)) * PLOT_W);
    const yScale = (value: number) =>
      TOP + ((maxY - value) / (maxY - minY)) * PLOT_H;

    return {
      minX,
      maxX,
      minY,
      maxY,
      xScale,
      yScale,
      yTicks: Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        return {
          value: maxY - ratio * (maxY - minY),
          y: TOP + ratio * PLOT_H,
        };
      }),
      xTicks: Array.from(
        { length: Math.min(5, filtered.length) },
        (_, index) => {
          const count = Math.min(5, filtered.length);
          const ratio = count === 1 ? 0 : index / (count - 1);
          const timestamp = minX + ratio * (maxX - minX);
          return {
            timestamp,
            x: LEFT + ratio * PLOT_W,
            date: new Date(timestamp).toISOString().slice(0, 10),
          };
        },
      ),
    };
  }, [filtered, valueFormat]);

  const hoverPoint =
    filtered.find((point) => point.date === hoverDate) ?? null;

  function labelValue(value: number) {
    if (valueFormat === "currency") return formatCurrency(value);
    if (valueFormat === "percent") {
      return value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " %";
    }
    return value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
  }

  function compactValue(value: number) {
    if (valueFormat === "percent") {
      return value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " %";
    }
    if (valueFormat === "currency") return formatCompact(value, "value");
    return value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
  }

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!chart || !svgRef.current || !filtered.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const viewX =
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * VIEW_W;
    const ratio =
      (Math.max(LEFT, Math.min(LEFT + PLOT_W, viewX)) - LEFT) / PLOT_W;
    const target = chart.minX + ratio * (chart.maxX - chart.minX);

    let nearest = filtered[0];
    let distance = Math.abs(parseDate(nearest.date) - target);
    for (const point of filtered.slice(1)) {
      const next = Math.abs(parseDate(point.date) - target);
      if (next < distance) {
        nearest = point;
        distance = next;
      }
    }
    setHoverDate(nearest.date);
  }

  if (!points.length) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm text-[var(--muted)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {["1M", "3M", "6M", "YTD", "1Y", "ALL"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setPeriod(value)}
            className={[
              "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
              period === value
                ? "border-white/18 bg-white/8 text-white"
                : "border-white/7 text-[var(--muted)] hover:text-white",
            ].join(" ")}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/7 bg-black/10">
        {hoverPoint ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-xl border border-white/10 bg-[#0a1410]/95 p-3 shadow-xl">
            <p className="text-xs font-semibold">{dateLabel(hoverPoint.date)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {label}
            </p>
            <p className="mt-2 font-mono text-sm">
              {labelValue(hoverPoint.value)}
            </p>
          </div>
        ) : null}

        {chart ? (
          <svg
            ref={svgRef}
            viewBox={"0 0 " + VIEW_W + " " + VIEW_H}
            preserveAspectRatio="none"
            className="h-[320px] w-full"
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverDate(null)}
            role="img"
            aria-label={label}
          >
            {chart.yTicks.map((tick) => (
              <g key={tick.y}>
                <line
                  x1={LEFT}
                  x2={LEFT + PLOT_W}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="rgba(255,255,255,0.065)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={LEFT - 12}
                  y={tick.y + 4}
                  textAnchor="end"
                  fill="rgba(237,247,242,0.52)"
                  fontSize="12"
                >
                  {compactValue(tick.value)}
                </text>
              </g>
            ))}

            {chart.xTicks.map((tick, index) => (
              <text
                key={tick.timestamp}
                x={tick.x}
                y={TOP + PLOT_H + 28}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === chart.xTicks.length - 1
                      ? "end"
                      : "middle"
                }
                fill="rgba(237,247,242,0.52)"
                fontSize="12"
              >
                {dateLabel(tick.date)}
              </text>
            ))}

            <path
              d={(() => {
                let path = "";
                filtered.forEach((point, index) => {
                  path +=
                    (index ? "L" : "M") +
                    chart.xScale(point.date).toFixed(2) +
                    "," +
                    chart.yScale(point.value).toFixed(2) +
                    " ";
                });
                return path.trim();
              })()}
              fill="none"
              stroke={color}
              strokeWidth="2.4"
              vectorEffect="non-scaling-stroke"
            />

            {hoverPoint ? (
              <>
                <line
                  x1={chart.xScale(hoverPoint.date)}
                  x2={chart.xScale(hoverPoint.date)}
                  y1={TOP}
                  y2={TOP + PLOT_H}
                  stroke="rgba(255,255,255,0.42)"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={chart.xScale(hoverPoint.date)}
                  cy={chart.yScale(hoverPoint.value)}
                  r="4"
                  fill={color}
                />
              </>
            ) : null}
          </svg>
        ) : null}
      </div>
    </div>
  );
}
