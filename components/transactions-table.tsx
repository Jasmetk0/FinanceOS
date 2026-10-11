"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface TransactionTableRow {
  id: string;
  provider: string;
  externalId: string;
  kind: string;
  occurredAt: string;
  currency: string;
  amount: number;
  amountCzk: number | null;
  quantity: number | null;
  price: number | null;
  fee: number | null;
  note: string | null;
  category: string | null;
  sourceLabel: string | null;
  flowScope: string;
  transferValueCzk: number | null;
  accountName: string;
  symbol: string;
  assetName: string;
}

export function TransactionsTable({
  transactions,
}: {
  transactions: TransactionTableRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [kind, setKind] = useState("all");
  const [flow, setFlow] = useState("all");
  const [deleting, setDeleting] = useState<string | null>(null);
  const filtersActive = search.trim() !== "" || provider !== "all" || kind !== "all" || flow !== "all";

  const providers = useMemo(
    () =>
      Array.from(new Set(transactions.map((tx) => tx.provider))).sort(),
    [transactions],
  );
  const kinds = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.kind))).sort(),
    [transactions],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return transactions.filter((tx) => {
      if (provider !== "all" && tx.provider !== provider) return false;
      if (kind !== "all" && tx.kind !== kind) return false;
      if (
        flow === "own_capital" &&
        !(
          tx.flowScope === "external" &&
          (tx.kind === "deposit" || tx.kind === "withdrawal")
        )
      ) {
        return false;
      }
      if (flow === "rewards" && tx.category !== "card_cashback") return false;
      if (flow === "internal" && tx.flowScope !== "internal") return false;
      if (flow === "unresolved" && tx.flowScope !== "unclassified") return false;
      if (!needle) return true;

      return [
        tx.symbol,
        tx.assetName,
        tx.accountName,
        tx.provider,
        tx.kind,
        tx.note,
        tx.category,
        tx.sourceLabel,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [transactions, search, provider, kind, flow]);

  async function deleteManual(id: string) {
    if (!window.confirm("Smazat tento ručně zadaný záznam?")) return;

    setDeleting(id);
    try {
      const response = await fetch("/api/manual/transaction", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Smazání záznamu se nezdařilo.");
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 grid gap-2.5 rounded-[18px] border border-[var(--border)] bg-black/[.10] p-3 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_150px_150px_175px_auto] lg:p-4">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Hledat mezi transakcemi"
          placeholder="Hledat aktivum, účet, poznámku…"
          className="finance-field min-w-0 w-full text-sm sm:col-span-2 lg:col-span-1"
        />
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          aria-label="Platforma"
          className="finance-field min-w-0 w-full text-sm"
        >
          <option value="all">Všechny platformy</option>
          {providers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-label="Typ transakce"
          className="finance-field min-w-0 w-full text-sm"
        >
          <option value="all">Všechny typy</option>
          {kinds.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={flow}
          onChange={(event) => setFlow(event.target.value)}
          aria-label="Peněžní tok"
          className="finance-field min-w-0 w-full text-sm"
        >
          <option value="all">Všechny peněžní toky</option>
          <option value="own_capital">Vklady / výběry</option>
          <option value="rewards">Externí odměny</option>
          <option value="internal">Interní přesuny</option>
          <option value="unresolved">Nevyřešené toky</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setProvider("all");
            setKind("all");
            setFlow("all");
          }}
          disabled={!filtersActive}
          className="finance-action w-full sm:col-span-2 lg:col-span-1"
        >
          Vymazat filtry
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-xs text-[var(--muted)]">
          Zobrazeno <span className="font-semibold text-[var(--foreground)]">{filtered.length.toLocaleString("cs-CZ")}</span> z {transactions.length.toLocaleString("cs-CZ")} transakcí
        </p>
        {filtersActive ? <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/[.07] px-3 py-1 text-[11px] font-semibold text-[var(--accent)]">Aktivní filtr</span> : null}
      </div>

      {filtered.length ? (
        <div className="finance-scrollbar overflow-x-auto rounded-[17px] border border-[var(--border)]">
          <table className="finance-data-table finance-transaction-table min-w-[1160px] text-left">
            <thead>
              <tr>
                <th className="pb-3 font-medium">Datum</th>
                <th className="pb-3 font-medium">Položka</th>
                <th className="pb-3 font-medium">Účet</th>
                <th className="pb-3 font-medium">Typ</th>
                <th className="pb-3 font-medium">Kategorie / zdroj</th>
                <th className="pb-3 font-medium">Tok</th>
                <th className="pb-3 text-right font-medium">Množství</th>
                <th className="pb-3 text-right font-medium">Částka</th>
                <th className="pb-3 text-right font-medium">Akce</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr
                  key={tx.id}
                >
                  <td data-label="Datum" className="py-4 text-sm text-[var(--muted)]">
                    {new Date(tx.occurredAt).toLocaleString("cs-CZ")}
                  </td>
                  <td data-label="Položka" className="py-4">
                    <p className="text-sm font-medium">
                      {tx.symbol || tx.note || tx.kind}
                    </p>
                    {tx.assetName && tx.assetName !== tx.symbol ? (
                      <p className="mt-1 max-w-[260px] truncate text-xs text-[var(--muted)]">
                        {tx.assetName}
                      </p>
                    ) : null}
                  </td>
                  <td data-label="Účet" className="py-4 text-sm text-[var(--muted)]">
                    {tx.accountName}
                  </td>
                  <td data-label="Typ" className="py-4">
                    <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[11px] font-medium uppercase text-[var(--muted)]">
                      {tx.kind}
                    </span>
                  </td>
                  <td data-label="Kategorie" className="py-4 text-sm">
                    <p>{tx.category || "—"}</p>
                    {tx.sourceLabel ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {tx.sourceLabel}
                      </p>
                    ) : null}
                  </td>
                  <td data-label="Tok" className="py-4 text-sm">
                    <span className={[
                      "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase",
                      tx.flowScope === "unclassified"
                        ? "border-[var(--warning)]/30 bg-[var(--warning)]/[.08] text-[var(--warning)]"
                        : tx.flowScope === "internal"
                          ? "border-[var(--blue)]/25 bg-[var(--blue)]/[.07] text-[var(--blue)]"
                          : "border-white/10 bg-white/[.035] text-[var(--muted)]",
                    ].join(" ")}>
                      {tx.flowScope}
                    </span>
                  </td>
                  <td data-label="Množství" className="py-4 text-right font-mono text-sm">
                    {tx.quantity === null
                      ? "—"
                      : tx.quantity.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 8,
                        })}
                  </td>
                  <td data-label="Částka" className="py-4 text-right font-mono text-sm">
                    {tx.amountCzk === null
                      ? tx.amount.toLocaleString("cs-CZ") + " " + tx.currency
                      : tx.amountCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        }) + " Kč"}
                    {tx.transferValueCzk !== null ? (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        carried{" "}
                        {tx.transferValueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </p>
                    ) : null}
                  </td>
                  <td data-label="Akce" className="py-4 text-right">
                    {tx.provider === "manual" ? (
                      <button
                        type="button"
                        onClick={() => void deleteManual(tx.id)}
                        disabled={deleting === tx.id}
                        className="rounded-lg border border-[var(--danger)]/20 px-2.5 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[var(--danger)]/8 disabled:opacity-50"
                      >
                        {deleting === tx.id ? "Mažu…" : "Smazat"}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-[var(--muted)]">
          Filtru neodpovídá žádná transakce.
        </div>
      )}
    </div>
  );
}
