"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const labels: Record<string, string> = {
  etf: "ETF",
  stock: "Stocks",
  crypto: "Crypto",
  p2p: "P2P",
  cash: "Cash",
  other: "Other",
};

export function PlanEditor({
  initialTargets,
  initialMonthlyContributionCzk,
}: {
  initialTargets: Record<string, number>;
  initialMonthlyContributionCzk: number;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState(initialTargets);
  const [monthlyContribution, setMonthlyContribution] = useState(
    String(initialMonthlyContributionCzk || ""),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sum = useMemo(
    () => Object.values(targets).reduce((total, value) => total + Number(value || 0), 0),
    [targets],
  );

  async function save() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets,
          monthlyContributionCzk: Number(monthlyContribution || 0),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Plan save failed.");
      }

      setMessage(
        Math.abs(sum - 100) <= 0.05
          ? "Plan saved and active."
          : "Plan saved. Target allocation becomes active when it sums to 100%.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(labels).map(([key, label]) => (
          <label
            key={key}
            className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-[var(--muted)]">%</span>
            </div>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={targets[key] ?? 0}
              onChange={(event) =>
                setTargets((current) => ({
                  ...current,
                  [key]: Number(event.target.value || 0),
                }))
              }
              className="mt-3 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
          <span className="text-sm font-medium">Monthly contribution</span>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Kolik nových peněz chceš matematicky rozdělit směrem ke svým vlastním cílům.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="100"
              value={monthlyContribution}
              onChange={(event) => setMonthlyContribution(event.target.value)}
              className="w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            />
            <span className="text-sm text-[var(--muted)]">Kč</span>
          </div>
        </label>

        <div
          className={[
            "rounded-2xl border p-4",
            Math.abs(sum - 100) <= 0.05
              ? "border-[var(--accent)]/20 bg-[var(--accent)]/[0.035]"
              : "border-[var(--warning)]/20 bg-[var(--warning)]/[0.035]",
          ].join(" ")}
        >
          <p className="text-xs text-[var(--muted)]">Target total</p>
          <p className="mt-2 text-3xl font-semibold">
            {sum.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {Math.abs(sum - 100) <= 0.05
              ? "Allocation is complete."
              : "Set your targets to 100% to activate drift calculations."}
          </p>
        </div>
      </div>

      {message ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{message}</p>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="mt-4 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save my plan"}
      </button>
    </div>
  );
}
