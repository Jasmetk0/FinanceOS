"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AutoSync } from "@/components/auto-sync";

const navigation = [
  { href: "/", label: "Dashboard", short: "DB" },
  { href: "/investments", label: "Investments", short: "IN" },
  { href: "/performance", label: "Performance", short: "PF" },
  { href: "/insights", label: "Insights", short: "IS" },
  { href: "/analyst", label: "Analyst", short: "AI" },
  { href: "/transactions", label: "Transactions", short: "TX" },
  { href: "/cash-flow", label: "Cash Flow", short: "CF" },
  { href: "/accounts", label: "Accounts", short: "AC" },
  { href: "/connections", label: "Connections", short: "CN" },
  { href: "/settings", label: "Settings", short: "ST" },
];

function NavLink({
  href,
  label,
  short,
  pathname,
}: {
  href: string;
  label: string;
  short: string;
  pathname: string;
}) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
        active
          ? "bg-white/8 text-white"
          : "text-[var(--muted)] hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      <span
        className={[
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[10px] font-semibold tracking-wider",
          active
            ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border-white/8 bg-white/[0.025] text-[var(--muted)] group-hover:text-white",
        ].join(" ")}
      >
        {short}
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <AutoSync />
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-white/7 bg-black/10 p-4 lg:flex lg:flex-col">
        <div className="px-2 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted)]">
            Personal finance
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-black text-[#07100d]">
              F
            </span>
            <span className="text-xl font-semibold tracking-tight">FinanceOS</span>
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {navigation.map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/7 bg-white/[0.025] p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
            Status
          </p>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
            <span>Local mode</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Data i API credentials zůstávají lokálně na tomto počítači.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-white/7 bg-[#07100d]/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-xs font-black text-[#07100d]">
                F
              </span>
              <span className="font-semibold">FinanceOS</span>
            </Link>
            <span className="rounded-full border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--warning)]">
              Demo
            </span>
          </div>

          <nav className="finance-scrollbar -mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1">
            {navigation.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "whitespace-nowrap rounded-lg px-3 py-2 text-xs transition",
                    active
                      ? "bg-white/8 text-white"
                      : "text-[var(--muted)] hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {children}
      </div>
      </div>
    </>
  );
}
