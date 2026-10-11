"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import type { getAccounts } from "@/lib/server/analytics";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { providerColor, providerLabel } from "@/lib/provider-visuals";

type Account = ReturnType<typeof getAccounts>[number];
type ViewMode = "grid" | "list";
type SortMode = "value-desc" | "value-asc" | "name" | "updated";
type FreshnessFilter = "all" | "current" | "stale" | "other";

function money(value: number) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}

function friendlyDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "datum není dostupné" : parsed.toLocaleDateString("cs-CZ");
}

function AccountCard({
  account,
  isList,
  hideValues,
}: {
  account: Account;
  isList: boolean;
  hideValues: boolean;
}) {
  const color = providerColor(account.provider);
  const link = "/accounts/" + encodeURIComponent(account.id);
  const shown = (value: number) => (hideValues ? "••••••" : money(value));
  const style = { "--provider-color": color } as CSSProperties;

  if (isList) {
    return (
      <Link
        href={link}
        prefetch={false}
        aria-label={"Otevřít detail účtu " + account.name}
        className="finance-account-card group flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 border-l-[3px] px-3.5 py-3.5 sm:flex-nowrap sm:px-4"
        style={{ borderLeftColor: color }}
      >
        <span className="finance-provider-mark !h-9 !w-9 !rounded-xl" style={style}>
          {providerLabel(account.provider).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-[1_1_190px]">
          <p className="truncate text-[13px] font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]" title={account.name}>{account.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{providerLabel(account.provider)} · {account.currency}</p>
        </div>
        <div className="min-w-0 flex-[1_1_150px] sm:text-right">
          <p className="text-[10px] text-[var(--muted)]">Hodnota účtu</p>
          <p className="mt-0.5 break-words text-[16px] font-semibold tracking-[-.03em] tabular-nums">{shown(account.totalValueCzk)}</p>
        </div>
        <div className="min-w-0 flex-[1_1_130px] text-[11px] text-[var(--muted)]">
          <p>Hotovost: <span className="font-medium text-[var(--foreground)]">{shown(account.cashValueCzk)}</span></p>
          <p className="mt-1">Investice: <span className="font-medium text-[var(--foreground)]">{shown(account.investedValueCzk)}</span></p>
        </div>
        <div className="flex min-w-0 flex-[1_1_160px] items-center justify-between gap-2 sm:justify-end">
          <DataFreshnessBadge freshness={account.dataFreshness} compact />
          <span aria-hidden="true" className="text-[var(--accent)]">↗</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={link}
      prefetch={false}
      aria-label={"Otevřít detail účtu " + account.name}
      className="finance-account-card group relative flex min-w-0 flex-col overflow-hidden p-[14px] sm:p-4"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] opacity-80"
        style={{ background: "linear-gradient(90deg, " + color + ", transparent 82%)" }}
      />
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="finance-provider-mark !h-9 !w-9 !rounded-xl" style={style}>
          {providerLabel(account.provider).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold tracking-tight text-[var(--foreground)] group-hover:text-[var(--accent)]" title={account.name}>{account.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{providerLabel(account.provider)} · {account.currency}</p>
        </div>
        <span aria-hidden="true" className="text-[var(--muted)] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]">↗</span>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-medium text-[var(--muted)]">Poslední doložená hodnota</p>
        <p className="mt-1 break-words text-[clamp(1.2rem,2vw,1.55rem)] font-semibold leading-tight tracking-[-.045em] tabular-nums">{shown(account.totalValueCzk)}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[.075] pt-3">
        <div className="min-w-0">
          <dt className="text-[10px] text-[var(--muted)]">Hotovost</dt>
          <dd className="mt-1 break-words text-[12px] font-medium tabular-nums">{shown(account.cashValueCzk)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] text-[var(--muted)]">Investice</dt>
          <dd className="mt-1 break-words text-[12px] font-medium tabular-nums">{shown(account.investedValueCzk)}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <DataFreshnessBadge freshness={account.dataFreshness} compact />
        <span className="text-[10px] text-[var(--muted)]" title={"Aktualizováno " + friendlyDate(account.updatedAt)}>
          {friendlyDate(account.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

export function AccountsExplorer({ accounts }: { accounts: Account[] }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [freshness, setFreshness] = useState<FreshnessFilter>("all");
  const [sort, setSort] = useState<SortMode>("value-desc");
  const [view, setView] = useState<ViewMode>("grid");
  const [hideValues, setHideValues] = useState(false);

  const providers = useMemo(
    () => [...new Set(accounts.map((account) => account.provider))].sort((a, b) => providerLabel(a).localeCompare(providerLabel(b), "cs")),
    [accounts],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("cs-CZ");
    return accounts
      .filter((account) => {
        if (provider !== "all" && account.provider !== provider) return false;
        if (freshness === "current" && account.dataFreshness.status !== "current") return false;
        if (freshness === "stale" && account.dataFreshness.status !== "stale") return false;
        if (freshness === "other" && !["unknown", "manual"].includes(account.dataFreshness.status)) return false;
        if (!needle) return true;
        return [account.name, providerLabel(account.provider), account.type, account.currency]
          .some((value) => value.toLocaleLowerCase("cs-CZ").includes(needle));
      })
      .sort((a, b) => {
        const result =
          sort === "value-desc" ? b.totalValueCzk - a.totalValueCzk :
          sort === "value-asc" ? a.totalValueCzk - b.totalValueCzk :
          sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) :
          a.name.localeCompare(b.name, "cs");
        return result || a.name.localeCompare(b.name, "cs") || a.id.localeCompare(b.id);
      });
  }, [accounts, query, provider, freshness, sort]);

  const filtersActive = Boolean(query.trim()) || provider !== "all" || freshness !== "all" || sort !== "value-desc";

  return (
    <div>
      <div className="mb-4 grid gap-2.5 rounded-2xl border border-[var(--border)] bg-black/[.11] p-3 md:grid-cols-[minmax(160px,1fr)_minmax(130px,170px)_minmax(145px,180px)_minmax(145px,175px)]">
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Hledat účet</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Název, platforma…"
            className="finance-field h-10 w-full min-w-0 text-[12px]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Platforma</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className="finance-field h-10 w-full min-w-0 text-[12px]">
            <option value="all">Všechny platformy</option>
            {providers.map((item) => <option value={item} key={item}>{providerLabel(item)}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Aktuálnost</span>
          <select value={freshness} onChange={(event) => setFreshness(event.target.value as FreshnessFilter)} className="finance-field h-10 w-full min-w-0 text-[12px]">
            <option value="all">Všechny stavy</option>
            <option value="current">Aktuální</option>
            <option value="stale">Neaktuální</option>
            <option value="other">Ruční / neznámé</option>
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Řadit</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="finance-field h-10 w-full min-w-0 text-[12px]">
            <option value="value-desc">Hodnota: nejvyšší</option>
            <option value="value-asc">Hodnota: nejnižší</option>
            <option value="name">Název A–Z</option>
            <option value="updated">Poslední aktualizace</option>
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-[11px] text-[var(--muted)]">
          Zobrazeno <span className="font-semibold text-[var(--foreground)]">{filtered.length}</span> z {accounts.length} účtů
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filtersActive ? (
            <button
              type="button"
              onClick={() => { setQuery(""); setProvider("all"); setFreshness("all"); setSort("value-desc"); }}
              className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
            >
              Vymazat filtry
            </button>
          ) : null}
          <button type="button" onClick={() => setHideValues((old) => !old)} aria-pressed={hideValues} className="finance-action !min-h-9 !px-3" title="Pouze vizuální skrytí částek na této obrazovce">
            {hideValues ? "Zobrazit částky" : "Skrýt částky"}
          </button>
          <div role="group" aria-label="Rozložení účtů" className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1">
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold transition", view === "grid" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Karty</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={["rounded-lg px-3 py-1.5 text-[11px] font-semibold transition", view === "list" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-white"].join(" ")}>Seznam</button>
          </div>
        </div>
      </div>

      {filtered.length ? (
        <div className={view === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2.5"}>
          {filtered.map((account) => <AccountCard key={account.id} account={account} isList={view === "list"} hideValues={hideValues} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center">
          <p className="text-[13px] font-semibold">Žádný účet neodpovídá výběru</p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">Zkus změnit hledaný výraz nebo vymazat filtry.</p>
          <button type="button" className="finance-action mt-4" onClick={() => { setQuery(""); setProvider("all"); setFreshness("all"); setSort("value-desc"); }}>Zobrazit všechny účty</button>
        </div>
      )}
    </div>
  );
}
