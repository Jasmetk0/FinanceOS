"use client";

import { useMemo, useState } from "react";

export interface AccountDailyHistoryRow {
  date: string;
  valueCzk: number | null;
  cashCzk: number;
  investedCzk: number;
  depositsCzk: number;
  withdrawalsCzk: number;
  rewardsCzk: number;
  investmentIncomeCzk: number;
  feesCzk: number;
  transferInCzk: number;
  transferOutCzk: number;
  contributedCzk: number;
  capitalAttributedCzk: number;
  profitCzk: number | null;
  returnPct: number | null;
  source: string;
  quality: string;
}

function money(value: number | null) {
  if (value === null) return "—";
  return (
    value.toLocaleString("cs-CZ", {
      maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0,
    }) + " Kč"
  );
}

function flow(value: number) {
  return Math.abs(value) < 0.005 ? "—" : money(value);
}

function pct(value: number | null) {
  if (value === null) return "—";
  return (
    (value > 0 ? "+" : "") +
    value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
    " %"
  );
}

function startForPeriod(period: string, latest: string) {
  if (period === "ALL") return null;
  const date = new Date(latest + "T12:00:00");
  if (period === "90D") date.setDate(date.getDate() - 90);
  else if (period === "1Y") date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function AccountDailyHistoryTable({
  rows,
  provider,
}: {
  rows: AccountDailyHistoryRow[];
  provider: string;
}) {
  const [period, setPeriod] = useState("90D");
  const latest = rows.at(-1)?.date ?? null;

  const visible = useMemo(() => {
    if (!latest) return [];
    const start = startForPeriod(period, latest);
    return rows
      .filter((row) => !start || row.date >= start)
      .slice()
      .reverse();
  }, [rows, period, latest]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">
          {visible.length.toLocaleString("cs-CZ")} z{" "}
          {rows.length.toLocaleString("cs-CZ")} denních bodů
        </p>
        <div className="flex gap-2">
          {["90D", "1Y", "ALL"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPeriod(item)}
              className={[
                "rounded-lg border px-2.5 py-1.5 text-xs transition",
                period === item
                  ? "border-[var(--accent)]/30 bg-[var(--accent)]/8 text-[var(--accent)]"
                  : "border-white/8 text-[var(--muted)] hover:text-white",
              ].join(" ")}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1540px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/8 text-xs uppercase tracking-[0.11em] text-[var(--muted)]">
              <th className="pb-3 font-medium">Datum</th>
              <th className="pb-3 text-right font-medium">Hodnota</th>
              <th className="pb-3 text-right font-medium">Cash</th>
              <th className="pb-3 text-right font-medium">Investováno</th>
              <th className="pb-3 text-right font-medium">Vklad</th>
              <th className="pb-3 text-right font-medium">Výběr</th>
              <th className="pb-3 text-right font-medium">Výnosy</th>
              <th className="pb-3 text-right font-medium">Poplatky</th>
              <th className="pb-3 text-right font-medium">Kapitál</th>
              <th className="pb-3 text-right font-medium">P/L</th>
              <th className="pb-3 text-right font-medium">Výnos</th>
              <th className="pb-3 text-right font-medium">Zdroj</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.date}
                className="border-b border-white/6 last:border-0"
              >
                <td className="py-3 font-mono text-sm">
                  {new Date(row.date + "T12:00:00").toLocaleDateString("cs-CZ")}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {money(row.valueCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm text-[var(--muted)]">
                  {money(row.cashCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm text-[var(--muted)]">
                  {money(row.investedCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {flow(row.depositsCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {flow(row.withdrawalsCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {flow(row.investmentIncomeCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {flow(row.feesCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {money(row.capitalAttributedCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {money(row.profitCzk)}
                </td>
                <td className="py-3 text-right font-mono text-sm">
                  {pct(row.returnPct)}
                </td>
                <td className="py-3 text-right text-xs text-[var(--muted)]">
                  {row.source === "provider"
                    ? provider === "investown"
                      ? "Investown"
                      : provider === "trading212"
                        ? "Trading 212"
                        : provider
                    : "rekonstrukce"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
