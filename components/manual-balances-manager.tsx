"use client";

import { useRef, useState } from "react";
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
  const inFlight = useRef(false);
  const [balances, setBalances] = useState(initialBalances);
  const [editing, setEditing] = useState<ManualBalanceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(null);

  async function submit(form: HTMLFormElement) {
    if (inFlight.current) return;
    const data = new FormData(form);
    const rawValue = String(data.get("value") ?? "").trim();
    const value = Number(rawValue);
    const currency = String(data.get("currency") || "").trim().toUpperCase();
    const name = String(data.get("name") || "").trim();

    if (!name || !rawValue || !Number.isFinite(value) || value < 0) {
      setMessage("Zadej název a platnou nezápornou hodnotu.");
      setMessageKind("error");
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setMessage("Měna musí mít třípísmenný kód, například CZK, EUR nebo USD.");
      setMessageKind("error");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageKind(null);

    try {
      const response = await fetch("/api/manual/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalId: editing?.externalId,
          name,
          kind: String(data.get("kind") || "cash"),
          value,
          currency,
        }),
      });

      const payload = (await response.json()) as {
        balances?: ManualBalanceRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Uložení zůstatku se nezdařilo.");
      }

      setBalances(payload.balances ?? []);
      setEditing(null);
      setOpen(false);
      setMessage("Ruční zůstatek byl uložen.");
      setMessageKind("success");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageKind("error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function remove(balance: ManualBalanceRow) {
    if (inFlight.current) return;
    if (
      !window.confirm(
        "Smazat ručně vedenou položku „" + balance.name + "“ z net worth?",
      )
    ) {
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageKind(null);
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
        throw new Error(payload.error || "Smazání zůstatku se nezdařilo.");
      }

      setBalances(payload.balances ?? []);
      setMessage("Ruční zůstatek „" + balance.name + "“ byl odstraněn.");
      setMessageKind("success");
      if (editing?.externalId === balance.externalId) {
        setEditing(null);
        setOpen(false);
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageKind("error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function startEdit(balance: ManualBalanceRow) {
    if (inFlight.current) return;
    setEditing(balance);
    setOpen(true);
    setMessage(null);
    setMessageKind(null);
  }

  function startAdd() {
    if (inFlight.current) return;
    setEditing(null);
    setOpen(true);
    setMessage(null);
    setMessageKind(null);
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Ručně vedené zůstatky a majetek</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            Bankovní zůstatek, hotovost, jiný majetek nebo závazek, který
            FinanceOS neumí načíst automaticky.
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={busy}
          className="finance-action finance-action-primary !min-h-10 disabled:opacity-50"
        >
          + Přidat zůstatek
        </button>
      </div>

      {open ? (
        <form
          key={editing?.externalId || "new"}
          aria-busy={busy}
          className="mt-4 rounded-2xl border border-[var(--border)] bg-white/[.025] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="text-xs text-[var(--muted)]">Název *</span>
              <input
                name="name"
                defaultValue={editing?.name || ""}
                placeholder="Bankovní účet, hotovost, úvěr…"
                required
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--panel-soft)] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Typ položky</span>
              <select
                name="kind"
                defaultValue={editing?.kind || "cash"}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--panel-soft)] px-3 py-2.5 text-sm"
              >
                <option value="cash">Hotovost / bankovní zůstatek</option>
                <option value="asset">Ostatní majetek</option>
                <option value="liability">Závazek / dluh</option>
              </select>
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Hodnota *</span>
              <input
                name="value"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing ? Math.abs(editing.value) : ""}
                required
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--panel-soft)] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Měna *</span>
              <input
                name="currency"
                defaultValue={editing?.currency || "CZK"}
                pattern="[A-Za-z]{3}"
                maxLength={3}
                required
                className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--panel-soft)] px-3 py-2.5 text-sm uppercase"
              />
            </label>
          </div>

          <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
            Zadej hodnotu vždy kladně. Závazek FinanceOS automaticky odečte od čistého majetku.
            Ruční zůstatek se nepřičítá k výplatám v peněžním deníku — obě evidence jsou oddělené.
          </p>
          {message ? (
            <p role={messageKind === "error" ? "alert" : "status"} aria-live="polite" className={["mt-3 rounded-xl border p-3 text-xs leading-5", messageKind === "error"
              ? "border-[var(--danger)]/25 bg-[var(--danger)]/[.045] text-[var(--danger)]"
              : "border-[var(--accent)]/20 bg-[var(--accent)]/[.045] text-[var(--accent)]"].join(" ")}>
              {message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-50"
            >
              {busy ? "Ukládám…" : editing ? "Uložit změny" : "Uložit zůstatek"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
              disabled={busy}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--muted)]"
            >
              Zrušit
            </button>
          </div>
        </form>
      ) : message ? (
        <p role={messageKind === "error" ? "alert" : "status"} aria-live="polite"
          className={["mt-3 text-xs leading-5", messageKind === "error" ? "text-[var(--danger)]" : "text-[var(--accent)]"].join(" ")}>{message}</p>
      ) : null}

      {balances.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {balances.map((balance) => (
            <article
              key={balance.externalId}
              className="finance-account-card min-w-0 p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{balance.name}</p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    {balance.kind === "cash" ? "Zůstatek" : balance.kind === "asset" ? "Majetek" : "Závazek"} · {balance.currency}
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
                Aktualizováno {new Date(balance.updatedAt).toLocaleString("cs-CZ")}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(balance)}
                  disabled={busy}
                  className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white"
                >
                  Upravit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(balance)}
                  disabled={busy}
                  className="rounded-lg border border-[var(--danger)]/20 px-3 py-1.5 text-xs text-[var(--danger)]"
                >
                  Smazat
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
