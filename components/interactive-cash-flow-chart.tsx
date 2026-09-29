"use client";

import { useMemo, useState } from "react";

export interface CashFlowMonthPoint {
  month: string;
  incomeCzk: number;
  giftsCzk: number;
  expensesCzk: number;
  interestCzk: number;
  netCzk: number;
}

function money(value: number) {
  return (
    value.toLocaleString("cs-CZ", {
      maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0,
    }) + " Kč"
  );
}

function compact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return (
      (value / 1_000_000).toLocaleString("cs-CZ", {
        maximumFractionDigits: 1,
      }) + " mil."
    );
  }
  if (abs >= 1_000) {
    return (
      (value / 1_000).toLocaleString("cs-CZ", {
        maximumFractionDigits: 0,
      }) + " tis."
    );
  }
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
}

export function InteractiveCashFlowChart({
  months,
}: {
  months: CashFlowMonthPoint[];
}) {
  const [period, setPeriod] = useState("12M");
  const [hoverMonth, setHoverMonth] = useState<string | null>(null);
  const [showNet, setShowNet] = useState(true);

  const filtered = useMemo(() => {
    const count =
      period === "3M"
        ? 3
        : period === "6M"
          ? 6
          : period === "12M"
            ? 12
            : months.length;
    return months.slice(-count);
  }, [months, period]);

  const max = Math.max(
    1,
    ...filtered.flatMap((item) => [
      item.incomeCzk + item.giftsCzk + item.interestCzk,
      item.expensesCzk,
      showNet ? Math.abs(item.netCzk) : 0,
    ]),
  );

  if (!months.length) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
        <div>
          <p className="text-sm font-medium">Zatím žádný cash-flow záznam</p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Přidej první výplatu, dar nebo výdaj přes Add manual transaction.
          </p>
        </div>
      </div>
    );
  }

  const hover = filtered.find((item) => item.month === hoverMonth) ?? null;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => max * ratio);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {["3M", "6M", "12M", "ALL"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={[
                "rounded-lg border px-2.5 py-1.5 text-[11px]",
                period === value
                  ? "border-white/18 bg-white/8 text-white"
                  : "border-white/7 text-[var(--muted)]",
              ].join(" ")}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showNet}
            onChange={(event) => setShowNet(event.target.checked)}
          />
          Zobrazit čisté cash flow
        </label>
      </div>

      <div className="relative mt-4 overflow-x-auto rounded-2xl border border-white/7 bg-black/10 p-3">
        {hover ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 min-w-[190px] rounded-xl border border-white/10 bg-[#0a1410]/95 p-3 shadow-xl">
            <p className="text-xs font-semibold">
              {new Date(hover.month + "-01T12:00:00").toLocaleDateString(
                "cs-CZ",
                { month: "long", year: "numeric" },
              )}
            </p>
            <dl className="mt-2 space-y-1.5 text-xs">
              <Row
                label="Příjmy"
                value={money(
                  hover.incomeCzk + hover.giftsCzk + hover.interestCzk,
                )}
              />
              <Row label="Výdaje" value={money(hover.expensesCzk)} />
              <Row label="Čisté" value={money(hover.netCzk)} />
            </dl>
          </div>
        ) : null}

        <div className="flex min-w-[720px]">
          <div className="relative h-[290px] w-16 shrink-0">
            {ticks.map((tick, index) => (
              <div
                key={index}
                className="absolute right-2 text-[10px] text-[var(--muted)]"
                style={{
                  top: 10 + (index / Math.max(1, ticks.length - 1)) * 220,
                  transform: "translateY(-50%)",
                }}
              >
                {compact(tick)}
              </div>
            ))}
          </div>

          <div className="relative flex h-[290px] min-w-[640px] flex-1 items-end gap-2 pb-9 pt-2">
            {ticks.map((_, index) => (
              <div
                key={index}
                className="pointer-events-none absolute left-0 right-0 border-t border-white/[0.055]"
                style={{
                  top: 10 + (index / Math.max(1, ticks.length - 1)) * 220,
                }}
              />
            ))}

            {filtered.map((item) => {
              const income =
                item.incomeCzk + item.giftsCzk + item.interestCzk;
              const incomeHeight = Math.max(2, (income / max) * 220);
              const expenseHeight = Math.max(
                2,
                (item.expensesCzk / max) * 220,
              );
              const netHeight = Math.max(2, (Math.abs(item.netCzk) / max) * 220);

              return (
                <button
                  type="button"
                  key={item.month}
                  onMouseEnter={() => setHoverMonth(item.month)}
                  onMouseLeave={() => setHoverMonth(null)}
                  onFocus={() => setHoverMonth(item.month)}
                  onBlur={() => setHoverMonth(null)}
                  className="relative z-[1] flex min-w-[54px] flex-1 flex-col items-center self-end outline-none"
                >
                  <div className="flex h-[220px] items-end gap-1">
                    <span
                      className="w-3.5 rounded-t bg-[var(--accent)]"
                      style={{ height: incomeHeight }}
                    />
                    <span
                      className="w-3.5 rounded-t bg-white/28"
                      style={{ height: expenseHeight }}
                    />
                    {showNet ? (
                      <span
                        className={[
                          "w-2.5 rounded-t",
                          item.netCzk >= 0
                            ? "bg-[var(--accent-strong)]/55"
                            : "bg-[var(--danger)]/70",
                        ].join(" ")}
                        style={{ height: netHeight }}
                      />
                    ) : null}
                  </div>
                  <span className="mt-2 text-[10px] text-[var(--muted)]">
                    {new Date(item.month + "-01T12:00:00").toLocaleDateString(
                      "cs-CZ",
                      { month: "short", year: "2-digit" },
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-5 text-xs text-[var(--muted)]">
        <Legend colorClass="bg-[var(--accent)]" label="Příjmy" />
        <Legend colorClass="bg-white/28" label="Výdaje" />
        {showNet ? (
          <Legend colorClass="bg-[var(--accent-strong)]/55" label="Čisté cash flow" />
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function Legend({
  colorClass,
  label,
}: {
  colorClass: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className={"h-2.5 w-2.5 rounded-sm " + colorClass} />
      {label}
    </span>
  );
}
