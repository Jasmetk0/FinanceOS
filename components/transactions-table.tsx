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
        throw new Error(payload.error || "Delete failed.");
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
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_170px_160px_190px_auto]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search asset, account, category, note…"
          className="rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]/50"
        />
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
        >
          <option value="all">All providers</option>
          {providers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
        >
          <option value="all">All types</option>
          {kinds.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={flow}
          onChange={(event) => setFlow(event.target.value)}
          className="rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
        >
          <option value="all">All flow scopes</option>
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
          className="rounded-xl border border-white/9 px-3 py-2.5 text-sm text-[var(--muted)] hover:text-white"
        >
          Reset
        </button>
      </div>

      <p className="mb-3 text-xs text-[var(--muted)]">
        Showing {filtered.length.toLocaleString("cs-CZ")} of{" "}
        {transactions.length.toLocaleString("cs-CZ")} transactions
      </p>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium">Account</th>
                <th className="pb-3 font-medium">Type</th>
                <th className="pb-3 font-medium">Category / Source</th>
                <th className="pb-3 font-medium">Flow</th>
                <th className="pb-3 text-right font-medium">Quantity</th>
                <th className="pb-3 text-right font-medium">Amount</th>
                <th className="pb-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-b border-white/6 last:border-0"
                >
                  <td className="py-4 text-sm text-[var(--muted)]">
                    {new Date(tx.occurredAt).toLocaleString("cs-CZ")}
                  </td>
                  <td className="py-4">
                    <p className="text-sm font-medium">
                      {tx.symbol || tx.note || tx.kind}
                    </p>
                    {tx.assetName && tx.assetName !== tx.symbol ? (
                      <p className="mt-1 max-w-[260px] truncate text-xs text-[var(--muted)]">
                        {tx.assetName}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 text-sm text-[var(--muted)]">
                    {tx.accountName}
                  </td>
                  <td className="py-4">
                    <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[11px] font-medium uppercase text-[var(--muted)]">
                      {tx.kind}
                    </span>
                  </td>
                  <td className="py-4 text-sm">
                    <p>{tx.category || "—"}</p>
                    {tx.sourceLabel ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {tx.sourceLabel}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 text-sm">
                    <span className="rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[10px] uppercase text-[var(--muted)]">
                      {tx.flowScope}
                    </span>
                  </td>
                  <td className="py-4 text-right font-mono text-sm">
                    {tx.quantity === null
                      ? "—"
                      : tx.quantity.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 8,
                        })}
                  </td>
                  <td className="py-4 text-right font-mono text-sm">
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
                  <td className="py-4 text-right">
                    {tx.provider === "manual" ? (
                      <button
                        type="button"
                        onClick={() => void deleteManual(tx.id)}
                        disabled={deleting === tx.id}
                        className="rounded-lg border border-[var(--danger)]/20 px-2.5 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[var(--danger)]/8 disabled:opacity-50"
                      >
                        {deleting === tx.id ? "Deleting…" : "Delete"}
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
