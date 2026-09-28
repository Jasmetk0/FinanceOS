"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface Trading212SpendingPotState {
  id: string;
  externalId: string;
  name: string;
  currency: string;
  value: number;
  valueCzk: number;
  updatedAt: string;
}

export function Trading212SpendingPot({
  initialValue,
}: {
  initialValue: Trading212SpendingPotState | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/trading212/spending-pot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: Number(data.get("value")),
          currency: String(data.get("currency") || "CZK"),
        }),
      });

      const payload = (await response.json()) as {
        spendingPot?: Trading212SpendingPotState | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Spending pot update failed.");
      }

      setState(payload.spendingPot ?? null);
      setMessage("Trading 212 Spending pot uložen.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Odebrat ručně vedený Trading 212 Spending pot?")) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/trading212/spending-pot", {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Delete failed.");
      }
      setState(null);
      setMessage("Trading 212 Spending pot odebrán.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Trading 212 Spending pot</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Veřejné Trading 212 API momentálně neposkytuje zůstatek Spending
            potu používaného 212 kartou. Tady ho můžeš držet jako samostatný
            Trading 212 cash účet, aby nechyběl v net worth.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--warning)]">
          manual current balance
        </span>
      </div>

      {state ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
            <p className="text-xs text-[var(--muted)]">Current balance</p>
            <p className="mt-2 font-mono text-lg font-semibold">
              {state.value.toLocaleString("cs-CZ", {
                maximumFractionDigits: 2,
              })}{" "}
              {state.currency}
            </p>
          </div>
          <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
            <p className="text-xs text-[var(--muted)]">CZK value</p>
            <p className="mt-2 font-mono text-lg font-semibold">
              {state.valueCzk.toLocaleString("cs-CZ", {
                maximumFractionDigits: 0,
              })}{" "}
              Kč
            </p>
          </div>
          <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
            <p className="text-xs text-[var(--muted)]">Updated</p>
            <p className="mt-2 text-sm font-medium">
              {new Date(state.updatedAt).toLocaleString("cs-CZ")}
            </p>
          </div>
        </div>
      ) : null}

      <form
        className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <label>
          <span className="text-xs text-[var(--muted)]">Spending pot balance</span>
          <input
            name="value"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={state?.value ?? ""}
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]/50"
          />
        </label>
        <label>
          <span className="text-xs text-[var(--muted)]">Currency</span>
          <input
            name="currency"
            defaultValue={state?.currency || "CZK"}
            required
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-end rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-50"
        >
          {busy ? "Saving…" : state ? "Update" : "Save"}
        </button>
      </form>

      {message ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{message}</p>
      ) : null}

      {state ? (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="mt-4 rounded-xl border border-[var(--danger)]/20 px-3 py-2 text-xs text-[var(--danger)] disabled:opacity-50"
        >
          Remove spending pot
        </button>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        FinanceOS tento ruční zůstatek drží odděleně od Invest cash načítané
        přes API, takže se obě částky nesčítají dvakrát.
      </p>
    </article>
  );
}
