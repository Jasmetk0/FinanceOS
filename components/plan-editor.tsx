"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const labels: Record<string, string> = {
  etf: "ETF",
  stock: "Akcie",
  crypto: "Krypto",
  p2p: "P2P",
  cash: "Hotovost",
  other: "Ostatní",
};

const colors: Record<string, string> = {
  etf: "#73c5ff",
  stock: "#7be6bc",
  crypto: "#f4c47c",
  p2p: "#b7a6ff",
  cash: "#7e9eb6",
  other: "#e99ab3",
};

const order = ["etf", "stock", "crypto", "p2p", "cash", "other"] as const;

function copyTargets(targets: Record<string, number>): Record<string, number> {
  return Object.fromEntries(order.map((key) => [key, Number(targets[key] ?? 0)]));
}

export function PlanEditor({
  initialTargets,
  initialMonthlyContributionCzk,
}: {
  initialTargets: Record<string, number>;
  initialMonthlyContributionCzk: number;
}) {
  const router = useRouter();
  const [savedTargets, setSavedTargets] = useState(() => copyTargets(initialTargets));
  const [savedMonthly, setSavedMonthly] = useState(initialMonthlyContributionCzk);
  const [targets, setTargets] = useState(() => copyTargets(initialTargets));
  const [monthlyContribution, setMonthlyContribution] = useState(
    String(initialMonthlyContributionCzk || ""),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sum = useMemo(
    () => order.reduce((total, key) => total + (Number(targets[key]) || 0), 0),
    [targets],
  );

  const validSum = Math.abs(sum - 100) <= 0.05;
  const monthlyValue = Number(monthlyContribution || 0);
  const validMonthly = Number.isFinite(monthlyValue) && monthlyValue >= 0;
  const dirty = order.some((key) => targets[key] !== savedTargets[key]) ||
    monthlyValue !== savedMonthly;

  function setTarget(key: string, next: number) {
    const value = Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 0;
    setTargets((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function reset() {
    setTargets({ ...savedTargets });
    setMonthlyContribution(String(savedMonthly || ""));
    setMessage(null);
  }

  async function save() {
    if (busy || !dirty || !validMonthly) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets,
          monthlyContributionCzk: monthlyValue,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Uložení plánu se nezdařilo.");
      }

      setSavedTargets({ ...targets });
      setSavedMonthly(monthlyValue);
      setMessage(
        validSum
          ? "Plán uložen. Cílová alokace je aktivní."
          : "Rozpracovaný plán uložen. Výpočty odchylek se aktivují po dosažení 100 %.",
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold">Tvoje cílové rozdělení</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
            Uprav procenta posuvníkem nebo přímo číslem. Nejde o doporučenou investiční strategii.
          </p>
        </div>
        <span role="status" aria-live="polite" className={["rounded-full border px-3 py-1.5 text-[11px] font-semibold", dirty ? "border-[var(--warning)]/25 bg-[var(--warning)]/[.07] text-[var(--warning)]" : "border-[var(--accent)]/20 bg-[var(--accent)]/[.065] text-[var(--accent)]"].join(" ")}>
          {dirty ? "Neuložené změny" : "Uloženo"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {order.map((key) => (
          <div key={key} className="rounded-[15px] border border-[var(--border)] bg-white/[.022] px-3.5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={"target-" + key} className="flex items-center gap-2 text-[12px] font-semibold">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[key] }} />
                {labels[key]}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={"target-" + key}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={targets[key] ?? 0}
                  onChange={(event) => setTarget(key, Number(event.target.value || 0))}
                  aria-label={"Cílová váha " + labels[key] + " v procentech"}
                  className="finance-field !min-h-8 !w-[76px] !py-1 !px-2 text-right text-[12px] font-semibold tabular-nums"
                />
                <span className="text-[11px] text-[var(--muted)]">%</span>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={targets[key] ?? 0}
              onChange={(event) => setTarget(key, Number(event.target.value))}
              aria-label={"Posuvník cílové váhy " + labels[key]}
              className="mt-4 w-full cursor-pointer accent-[var(--accent)]"
              style={{ accentColor: colors[key] }}
            />
            <div className="finance-meter mt-2 !h-1">
              <span style={{ width: Math.min(100, Math.max(0, targets[key] ?? 0)) + "%", backgroundColor: colors[key] }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[16px] border border-[var(--border)] bg-black/[.12] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-[var(--muted)]">Součet cílových vah</p>
            <p className={["mt-1 text-[26px] font-semibold tracking-[-.04em] tabular-nums", validSum ? "text-[var(--accent)]" : "text-[var(--warning)]"].join(" ")}>
              {sum.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %
            </p>
          </div>
          <p className="max-w-sm text-[11px] leading-5 text-[var(--muted)]">
            {validSum
              ? "Cílová alokace má přesně 100 %. Po uložení se vypočítá odchylka od cíle."
              : sum < 100
                ? "Do 100 % zbývá " + (100 - sum).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " procentního bodu."
                : "Součet překračuje 100 % o " + (sum - 100).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " procentního bodu."}
          </p>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[.09]" aria-label={"Součet váhy " + sum.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " procent"}>
          {order.map((key) => (
            <div key={key} style={{
              width: (sum > 100 ? (targets[key] ?? 0) / sum * 100 : targets[key] ?? 0) + "%",
              backgroundColor: colors[key],
            }} />
          ))}
        </div>
        {sum > 100.05 ? <p className="mt-2 text-[11px] text-[var(--warning)]">Segmenty jsou pro přehled normalizované na šířku pruhu; skutečný součet zůstává přes 100 %.</p> : null}
      </div>

      <div className="mt-4 rounded-[16px] border border-[var(--border)] bg-white/[.022] p-4">
        <label htmlFor="monthly-plan-contribution" className="text-[12px] font-semibold">Měsíční investovaný příspěvek</label>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
          Kolik nových peněz chceš matematicky rozdělit podle své vlastní cílové alokace.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <input
            id="monthly-plan-contribution"
            type="number"
            min="0"
            step="100"
            value={monthlyContribution}
            onChange={(event) => { setMonthlyContribution(event.target.value); setMessage(null); }}
            aria-invalid={!validMonthly}
            className="finance-field w-full max-w-[240px] text-[13px] tabular-nums"
          />
          <span className="text-[12px] text-[var(--muted)]">Kč za měsíc</span>
        </div>
        {!validMonthly ? <p className="mt-2 text-[11px] text-[var(--danger)]">Zadej nezápornou platnou částku.</p> : null}
      </div>

      {message ? <p role="status" aria-live="polite" className="mt-3 text-[12px] leading-5 text-[var(--muted)]">{message}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty || !validMonthly} className="finance-action finance-action-primary !min-h-10 disabled:opacity-50">
          {busy ? "Ukládám…" : "Uložit můj plán"}
        </button>
        <button type="button" onClick={reset} disabled={!dirty || busy} className="finance-action !min-h-10 disabled:opacity-50">
          Vrátit neuložené změny
        </button>
      </div>
    </div>
  );
}
