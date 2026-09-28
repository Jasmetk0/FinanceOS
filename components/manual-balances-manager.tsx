"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ManualBalanceRow {
  id: string;
  externalId: string;
  name: string;
  kind: string;
  currency: string;
  value: number;
  valueCzk: number;
  updatedAt: string;
}

export function ManualBalancesManager({
  initialBalances,
}: {
  initialBalances: ManualBalanceRow[];
}) {
  const router = useRouter();
  const [balances, setBalances] = useState(initialBalances);
  const [editing, setEditing] = useState<ManualBalanceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalId: editing?.externalId,
          name: String(data.get("name") || ""),
          kind: String(data.get("kind") || "cash"),
          value: Number(data.get("value")),
          currency: String(data.get("currency") || "CZK"),
        }),
      });

      const payload = (await response.json()) as {
        balances?: ManualBalanceRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Balance update failed.");
      }

      setBalances(payload.balances ?? []);
      setEditing(null);
      setOpen(false);
      setMessage("Balance saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(balance: ManualBalanceRow) {
    if (
      !window.confirm(
        "Smazat ručně vedenou položku „" + balance.name + "“ z net worth?",
      )
    ) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manual/balance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId: balance.externalId }),
      });
      const payload = (await response.json()) as {
        balances?: ManualBalanceRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Delete failed.");
      }

      setBalances(payload.balances ?? []);
      if (editing?.externalId === balance.externalId) {
        setEditing(null);
        setOpen(false);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(balance: ManualBalanceRow) {
    setEditing(balance);
    setOpen(true);
    setMessage(null);
  }

  function startAdd() {
    setEditing(null);
    setOpen(true);
    setMessage(null);
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Manual net-worth balances</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            Bankovní zůstatek, hotovost, jiný majetek nebo závazek, který
            FinanceOS neumí načíst automaticky.
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
        >
          + Add balance
        </button>
      </div>

      {open ? (
        <form
          key={editing?.externalId || "new"}
          className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="text-xs text-[var(--muted)]">Name</span>
              <input
                name="name"
                defaultValue={editing?.name || ""}
                placeholder="Bank account, Cash, Car loan…"
                required
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Kind</span>
              <select
                name="kind"
                defaultValue={editing?.kind || "cash"}
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              >
                <option value="cash">Cash / bank balance</option>
                <option value="asset">Other asset</option>
                <option value="liability">Liability / debt</option>
              </select>
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Value</span>
              <input
                name="value"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing ? Math.abs(editing.value) : ""}
                required
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Currency</span>
              <input
                name="currency"
                defaultValue={editing?.currency || "CZK"}
                required
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
              />
            </label>
          </div>

          {message ? (
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              {message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-50"
            >
              {busy ? "Saving…" : editing ? "Update balance" : "Save balance"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--muted)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : message ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{message}</p>
      ) : null}

      {balances.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {balances.map((balance) => (
            <article
              key={balance.externalId}
              className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{balance.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                    {balance.kind} · {balance.currency}
                  </p>
                </div>
                <p
                  className={[
                    "font-mono text-sm font-semibold",
                    balance.valueCzk < 0 ? "text-[var(--danger)]" : "",
                  ].join(" ")}
                >
                  {balance.valueCzk.toLocaleString("cs-CZ", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Kč
                </p>
              </div>

              <p className="mt-4 text-xs text-[var(--muted)]">
                Updated {new Date(balance.updatedAt).toLocaleString("cs-CZ")}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(balance)}
                  disabled={busy}
                  className="rounded-lg border border-white/9 px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(balance)}
                  disabled={busy}
                  className="rounded-lg border border-[var(--danger)]/20 px-3 py-1.5 text-xs text-[var(--danger)]"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-[var(--muted)]">
          Zatím žádná ručně vedená položka majetku.
        </div>
      )}
    </div>
  );
}
