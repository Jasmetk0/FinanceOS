"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type IconName =
  | "overview" | "holdings" | "performance" | "history" | "insights"
  | "plan" | "analyst" | "reports" | "journal" | "transactions"
  | "cash" | "accounts" | "connections" | "settings";

type NavigationItem = { href: string; label: string; icon: IconName; keywords?: string };

const navigationGroups: Array<{ title: string; items: NavigationItem[] }> = [
  {
    title: "Portfolio",
    items: [
      { href: "/", label: "Přehled", icon: "overview", keywords: "dashboard majetek" },
      { href: "/accounts", label: "Účty", icon: "accounts", keywords: "trading212 kraken mintos investown phantom" },
      { href: "/investments", label: "Investice", icon: "holdings", keywords: "akcie etf crypto pozice" },
      { href: "/performance", label: "Výkonnost", icon: "performance", keywords: "zisk výnos xirr pnl" },
      { href: "/cash-flow", label: "Peněžní toky", icon: "cash", keywords: "vklady výběry převody" },
    ],
  },
  {
    title: "Analýza a plánování",
    items: [
      { href: "/history", label: "Historie", icon: "history", keywords: "vývoj graf" },
      { href: "/insights", label: "Analýzy", icon: "insights" },
      { href: "/plan", label: "Plán", icon: "plan", keywords: "cíle" },
      { href: "/analyst", label: "AI analytik", icon: "analyst" },
      { href: "/reports", label: "Reporty", icon: "reports" },
    ],
  },
  {
    title: "Evidence",
    items: [
      { href: "/transactions", label: "Transakce", icon: "transactions", keywords: "obchody ledger" },
      { href: "/journal", label: "Deník", icon: "journal" },
    ],
  },
  {
    title: "Nastavení",
    items: [
      { href: "/connections", label: "Propojení", icon: "connections", keywords: "api import synchronizace" },
      { href: "/settings", label: "Nastavení", icon: "settings" },
    ],
  },
];

const allNavigation = navigationGroups.flatMap((group) => group.items);

const icons: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="8" rx="1.3" /><rect x="14" y="3" width="7" height="5" rx="1.3" /><rect x="14" y="12" width="7" height="9" rx="1.3" /><rect x="3" y="15" width="7" height="6" rx="1.3" /></>,
  holdings: <><path d="M3 3v18h18" /><path d="m6 16 5-5 4 3 6-8" /></>,
  performance: <><path d="M3 17 9 11l4 4 8-9" /><path d="M15 6h6v6" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l4 2" /></>,
  insights: <><path d="M12 2 9.8 9.8 2 12l7.8 2.2L12 22l2.2-7.8L22 12l-7.8-2.2z" /></>,
  plan: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  analyst: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M9 2v3m6-3v3M8 12h.01M16 12h.01M8 16c2 1.5 6 1.5 8 0" /></>,
  reports: <><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  journal: <><path d="M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 7h7M8 11h7M8 15h4" /></>,
  transactions: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>,
  cash: <><rect x="2" y="5" width="20" height="14" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M6 9h.01M18 15h.01" /></>,
  accounts: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  connections: <><path d="M9 7V4m6 3V4M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v4" /><path d="M5 12H3m18 0h-2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .2.2 1.2 1.4-2.1 3.5-1.9-.6a8 8 0 0 1-1.8 1l-.4 2h-4l-.4-2a8 8 0 0 1-1.8-1l-1.9.6-2.1-3.5 1.4-1.6a8 8 0 0 1 0-2l-1.4-1.6 2.1-3.5 1.9.6a8 8 0 0 1 1.8-1l.4-2h4l.4 2a8 8 0 0 1 1.8 1l1.9-.6 2.1 3.5-1.4 1.6a8 8 0 0 1 0 2Z" transform="translate(0 -2) scale(.9) translate(1.3 1.3)" /></>,
};

function NavIcon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" prefetch={false} className="group flex items-center gap-3 rounded-xl outline-offset-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--accent)] text-[var(--background)] shadow-[0_6px_24px_rgba(75,219,176,.16)]">
        <svg aria-hidden="true" viewBox="0 0 28 28" className="h-7 w-7" fill="none"><path d="M5 20V8h6M5 14h6M14 20V8l4.5 8L23 8v12" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="leading-none">
        <span className="block text-[17px] font-bold tracking-[-.045em] text-white">Finance<span className="text-[var(--accent)]">OS</span></span>
        <span className="mt-1.5 block text-[10px] font-medium uppercase tracking-[.19em] text-[var(--muted)]">Investiční centrum</span>
      </span>
    </Link>
  );
}

function NavItem({ item, pathname, onNavigate }: { item: NavigationItem; pathname: string; onNavigate?: () => void }) {
  const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--accent)]/[.105] text-[var(--foreground)]"
          : "text-[var(--muted)] hover:bg-white/[.045] hover:text-[var(--foreground)]",
      ].join(" ")}
    >
      {active ? <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[var(--accent)]" /> : null}
      <NavIcon name={item.icon} className={active ? "h-[18px] w-[18px] text-[var(--accent)]" : "h-[18px] w-[18px] text-[var(--muted)] group-hover:text-[var(--foreground)]"} />
      <span>{item.label}</span>
      {active ? <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
    </Link>
  );
}

function NavSections({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Hlavní navigace" className="space-y-5">
      {navigationGroups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted)]/80">{group.title}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const currentPage = [...allNavigation].reverse().find((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/")) || allNavigation[0];
  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("cs-CZ");
    return needle
      ? allNavigation.filter((item) => (item.label + " " + (item.keywords || "")).toLocaleLowerCase("cs-CZ").includes(needle))
      : allNavigation;
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        setMobileOpen(false);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (mobileOpen) menuCloseRef.current?.focus();
  }, [mobileOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[246px_minmax(0,1fr)]">
      <a href="#main-content" className="skip-link">Přeskočit na obsah</a>

      <aside className="finance-scrollbar sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-5 lg:flex">
        <div className="px-3 pb-7 pt-1"><Brand /></div>
        <NavSections pathname={pathname} />
        <div className="mt-auto pt-8">
          <div className="rounded-2xl border border-[var(--border)] bg-white/[.025] px-3 py-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]" /> Lokální režim
            </div>
            <p className="mt-1.5 text-[11px] leading-[1.65] text-[var(--muted)]">Data a přístupové údaje zůstávají v tomto zařízení.</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)]/90 px-4 backdrop-blur-xl sm:px-7 lg:h-[74px] lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Otevřít navigaci" aria-expanded={mobileOpen} aria-controls="mobile-navigation" className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--foreground)] hover:bg-white/[.05] lg:hidden">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div className="min-w-0">
              <p className="hidden text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted)] sm:block">FinanceOS / {navigationGroups.find((group) => group.items.some((item) => item.href === currentPage.href))?.title}</p>
              <p className="truncate text-base font-semibold tracking-tight text-[var(--foreground)] sm:mt-0.5">{currentPage.label}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Hledat stránku" aria-keyshortcuts="Control+K Meta+K" className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-white/[.025] px-3 text-xs font-medium text-[var(--muted)] transition hover:border-white/20 hover:text-white sm:min-w-[170px] sm:justify-between">
              <span className="flex items-center gap-2"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg><span className="hidden sm:inline">Rychlý přechod</span></span>
              <kbd className="hidden rounded-md border border-white/10 bg-white/[.04] px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
            </button>
            <Link href="/connections" prefetch={false} className="flex h-10 items-center gap-2 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[.09] px-3 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/[.16] sm:px-4">
              <NavIcon name="connections" className="h-4 w-4" /><span className="hidden min-[390px]:inline">Propojení</span>
            </Link>
          </div>
        </header>
        <div id="main-content" tabIndex={-1} className="min-w-0 outline-none">{children}</div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" id="mobile-navigation">
          <button type="button" className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="Zavřít navigaci" onClick={() => setMobileOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Navigace FinanceOS" className="finance-scrollbar absolute bottom-0 left-0 top-0 flex w-[min(340px,88vw)] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] px-4 py-5 shadow-2xl">
            <div className="mb-7 flex items-center justify-between">
              <Brand />
              <button ref={menuCloseRef} type="button" aria-label="Zavřít menu" onClick={() => setMobileOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] text-white"><span aria-hidden="true" className="text-xl">×</span></button>
            </div>
            <NavSections pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/75 px-3 pt-[10vh] backdrop-blur-sm sm:pt-[14vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label="Rychlý přechod na stránku" className="w-full max-w-lg overflow-hidden rounded-[22px] border border-white/15 bg-[var(--panel-strong)] shadow-[0_32px_100px_rgba(0,0,0,.6)]">
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-5">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--accent)]"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
              <input ref={searchRef} type="search" aria-label="Hledat v navigaci" placeholder="Kam chceš přejít?" value={query} onChange={(event) => setQuery(event.target.value)} className="h-[62px] w-full bg-transparent text-sm text-white outline-none placeholder:text-[var(--muted)]" />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="Zavřít hledání" className="rounded-md border border-white/10 px-2 py-1 text-xs text-[var(--muted)]">Esc</button>
            </div>
            <div className="finance-scrollbar max-h-[min(60vh,490px)] overflow-y-auto p-2.5">
              {searchResults.length ? searchResults.map((item) => (
                <Link key={item.href} href={item.href} prefetch={false} onClick={() => { setSearchOpen(false); setQuery(""); }} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[var(--foreground)] transition hover:bg-white/[.07] focus:bg-white/[.07]">
                  <NavIcon name={item.icon} className="h-[18px] w-[18px] text-[var(--accent)]" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-xs text-[var(--muted)]">{item.href}</span>
                </Link>
              )) : <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">Pro tento dotaz není žádná stránka.</p>}
            </div>
            <p className="border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted)]">Pro rychlé otevření kdykoli stiskni Ctrl + K.</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
