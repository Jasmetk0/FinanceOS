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

const PAGE_SIZE = 60;

type SortMode = "newest" | "oldest" | "czk-desc" | "czk-asc";

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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [hideValues, setHideValues] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const filtersActive = search.trim() !== "" || provider !== "all" || kind !== "all" || flow !== "all" ||
    Boolean(dateFrom) || Boolean(dateTo) || sort !== "newest";

  function resetVisible() {
    setVisibleCount(PAGE_SIZE);
  }

  function resetFilters() {
    setSearch("");
    setProvider("all");
    setKind("all");
    setFlow("all");
    setDateFrom("");
    setDateTo("");
    setSort("newest");
    resetVisible();
  }

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
    const needle = search.trim().toLocaleLowerCase("cs-CZ");

    return transactions.filter((tx) => {
      if (provider !== "all" && tx.provider !== provider) return false;
      if (kind !== "all" && tx.kind !== kind) return false;
      // Compare the provider-supplied source calendar date, not a browser-timezone conversion.
      const sourceDate = tx.occurredAt.slice(0, 10);
      if (dateFrom && sourceDate < dateFrom) return false;
      if (dateTo && sourceDate > dateTo) return false;
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
        .some((value) => String(value).toLocaleLowerCase("cs-CZ").includes(needle));
    }).sort((a, b) => {
      if (sort === "newest") return b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);
      if (sort === "oldest") return a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);
      // Never treat missing CZK conversion as zero or compare mixed currencies.
      if (a.amountCzk === null && b.amountCzk !== null) return 1;
      if (b.amountCzk === null && a.amountCzk !== null) return -1;
      const amountComparison = sort === "czk-desc"
        ? Math.abs(b.amountCzk ?? 0) - Math.abs(a.amountCzk ?? 0)
        : Math.abs(a.amountCzk ?? 0) - Math.abs(b.amountCzk ?? 0);
      return amountComparison || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);
    });
  }, [transactions, search, provider, kind, flow, dateFrom, dateTo, sort]);

  const visible = filtered.slice(0, visibleCount);
  const missingFxCount = filtered.filter((tx) => tx.amountCzk === null).length;
  const unresolvedCount = filtered.filter((tx) => tx.flowScope === "unclassified").length;
  const hasMore = visible.length < filtered.length;

  async function deleteManual(id: string) {
    if (!window.confirm("Smazat tento ručně zadaný záznam?")) return;

    setDeleting(id);
    setDeleteError(null);
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
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-3 grid gap-2.5 rounded-[18px] border border-[var(--border)] bg-black/[.10] p-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(120px,155px))_auto] lg:p-4">
        <input
          value={search}
          onChange={(event) => { setSearch(event.target.value); resetVisible(); }}
          aria-label="Hledat mezi transakcemi"
          placeholder="Hledat aktivum, účet, poznámku…"
          className="finance-field min-w-0 w-full text-sm sm:col-span-2 lg:col-span-1"
        />
        <select
          value={provider}
          onChange={(event) => { setProvider(event.target.value); resetVisible(); }}
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
          onChange={(event) => { setKind(event.target.value); resetVisible(); }}
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
          onChange={(event) => { setFlow(event.target.value); resetVisible(); }}
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
          onClick={resetFilters}
          disabled={!filtersActive}
          className="finance-action w-full sm:col-span-2 lg:col-span-1"
        >
          Vymazat filtry
        </button>
      </div>

      <div className="mb-3 grid gap-2.5 rounded-xl border border-[var(--border)] bg-white/[.016] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(160px,1fr)_auto]">
        <label className="min-w-0 text-[11px] text-[var(--muted)]">
          Datum od
          <input type="date" value={dateFrom} max={dateTo || undefined}
            onChange={(event) => { setDateFrom(event.target.value); resetVisible(); }}
            className="finance-field mt-1.5 h-10 w-full min-w-0 text-[12px]" />
        </label>
        <label className="min-w-0 text-[11px] text-[var(--muted)]">
          Datum do
          <input type="date" value={dateTo} min={dateFrom || undefined}
            onChange={(event) => { setDateTo(event.target.value); resetVisible(); }}
            className="finance-field mt-1.5 h-10 w-full min-w-0 text-[12px]" />
        </label>
        <label className="min-w-0 text-[11px] text-[var(--muted)]">
          Řazení
          <select value={sort} onChange={(event) => { setSort(event.target.value as SortMode); resetVisible(); }}
            className="finance-field mt-1.5 h-10 w-full min-w-0 text-[12px]">
            <option value="newest">Nejnovější nahoře</option>
            <option value="oldest">Nejstarší nahoře</option>
            <option value="czk-desc">Známá CZK částka ↓</option>
            <option value="czk-asc">Známá CZK částka ↑</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => setHideValues((prev) => !prev)} aria-pressed={hideValues}
            className="finance-action h-10 w-full !px-3">
            {hideValues ? "Zobrazit částky" : "Skrýt částky"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-xs text-[var(--muted)]">
          Zobrazeno <span className="font-semibold text-[var(--foreground)]">{visible.length.toLocaleString("cs-CZ")}</span> z {filtered.length.toLocaleString("cs-CZ")} vybraných transakcí · celkem {transactions.length.toLocaleString("cs-CZ")}
        </p>
        {filtersActive ? <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/[.07] px-3 py-1 text-[11px] font-semibold text-[var(--accent)]">Aktivní filtr</span> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-[11px]" role="status" aria-live="polite">
        {missingFxCount > 0 ? (
          <span className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/[.045] px-2.5 py-2 text-[var(--warning)]">
            {missingFxCount.toLocaleString("cs-CZ")} transakcí bez CZK přepočtu
          </span>
        ) : null}
        {unresolvedCount > 0 ? (
          <span className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/[.045] px-2.5 py-2 text-[var(--warning)]">
            {unresolvedCount.toLocaleString("cs-CZ")} nezařazených toků
          </span>
        ) : null}
      </div>
      {deleteError ? <p role="alert" className="mb-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/[.05] p-3 text-[12px] text-[var(--danger)]">{deleteError}</p> : null}

      {filtered.length ? (
        <>
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
              {visible.map((tx) => (
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
                    {hideValues
                      ? "••••••"
                      : tx.amountCzk === null
                        ? tx.amount.toLocaleString("cs-CZ") + " " + tx.currency
                        : tx.amountCzk.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 2,
                          }) + " Kč"}
                    {tx.transferValueCzk !== null ? (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        Převedená účetní hodnota:{" "}
                        {hideValues ? "••••••" : tx.transferValueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        }) + " Kč"}
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
        {hasMore ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <p className="text-[11px] text-[var(--muted)]">Zbývá {filtered.length - visible.length} transakcí k zobrazení.</p>
            <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="finance-action !min-h-9">
              Zobrazit dalších {Math.min(PAGE_SIZE, filtered.length - visible.length)} transakcí
            </button>
          </div>
        ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center">
          <p className="text-[13px] font-semibold">Výběru neodpovídá žádná transakce.</p>
          <button type="button" onClick={resetFilters} className="finance-action mt-3 !min-h-9">Zobrazit všechny transakce</button>
        </div>
      )}
    </div>
  );
}
