"use client";

import { useMemo, useState } from "react";

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
  accountName: string;
  symbol: string;
  assetName: string;
}

export function TransactionsTable({
  transactions,
}: {
  transactions: TransactionTableRow[];
}) {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [kind, setKind] = useState("all");

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
  }, [transactions, search, provider, kind]);

  return (
    <div>
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
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
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setProvider("all");
            setKind("all");
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
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium">Account</th>
                <th className="pb-3 font-medium">Type</th>
                <th className="pb-3 font-medium">Category / Source</th>
                <th className="pb-3 text-right font-medium">Quantity</th>
                <th className="pb-3 text-right font-medium">Amount</th>
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
