import Link from "next/link";
import type { CSSProperties } from "react";
import { Pill, SectionCard, EmptyState } from "@/components/ui";
import { getAccounts } from "@/lib/server/analytics";
import { ManualBalancesManager } from "@/components/manual-balances-manager";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { providerColor, providerLabel } from "@/lib/provider-visuals";
import { listManualBalances } from "@/lib/server/manual-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function money(value: number) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}

export default function AccountsPage() {
  const accounts = getAccounts();
  const manualBalances = listManualBalances();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>{accounts.length} {accounts.length === 1 ? "účet" : accounts.length >= 2 && accounts.length <= 4 ? "účty" : "účtů"}</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Účty</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)] sm:text-base">
          Všechny platformy na jednom místě. Poslední doložené hodnoty, rozdělení na hotovost a investice.
        </p>
      </div>
      <div className="mt-7">
        <SectionCard title="Přehled platforem" subtitle="Hodnoty v Kč · aktuálnost je vždy uvedena u konkrétního účtu" action={<Link href="/connections" prefetch={false} className="text-xs font-semibold text-[var(--accent)]">Správa propojení ↗</Link>}>
          {accounts.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {accounts.map((account) => {
                const accent = providerColor(account.provider);
                return (
                  <Link
                    key={account.id}
                    href={"/accounts/" + encodeURIComponent(account.id)}
                    prefetch={false}
                    className="finance-account-card group relative block min-w-0 overflow-hidden"
                    aria-label={"Detail účtu " + account.name}
                  >
                    <div className="h-[3px] w-full opacity-85" style={{ background: "linear-gradient(90deg, " + accent + ", transparent 86%)" }} aria-hidden="true" />
                    <div className="p-4 sm:p-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="finance-provider-mark" style={{ "--provider-color": accent } as CSSProperties}>
                          {providerLabel(account.provider).slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-[14px] font-semibold tracking-tight transition group-hover:text-[var(--accent)] sm:text-[15px]">{account.name}</h2>
                          <p className="mt-1 text-[11px] text-[var(--muted)]">{providerLabel(account.provider)} · {account.type} · {account.currency}</p>
                        </div>
                        <span aria-hidden="true" className="text-lg text-[var(--muted)] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]">↗</span>
                      </div>

                      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="finance-eyebrow">Poslední doložená hodnota</p>
                          <p className="mt-2 break-words text-[clamp(1.6rem,3vw,2.2rem)] font-semibold tracking-[-.055em] tabular-nums">{money(account.totalValueCzk)}</p>
                        </div>
                        <DataFreshnessBadge freshness={account.dataFreshness} />
                      </div>

                      <dl className="mt-5 grid grid-cols-2 gap-2.5">
                        <div className="rounded-xl border border-white/[.055] bg-black/[.12] p-3">
                          <dt className="text-[11px] text-[var(--muted)]">Hotovost</dt>
                          <dd className="mt-1.5 break-words text-[13px] font-semibold tabular-nums">{money(account.cashValueCzk)}</dd>
                        </div>
                        <div className="rounded-xl border border-white/[.055] bg-black/[.12] p-3">
                          <dt className="text-[11px] text-[var(--muted)]">Investice</dt>
                          <dd className="mt-1.5 break-words text-[13px] font-semibold tabular-nums">{money(account.investedValueCzk)}</dd>
                        </div>
                      </dl>
                      <p className="mt-4 border-t border-white/[.07] pt-3 text-[11px] leading-5 text-[var(--muted)]">
                        Záznam aktualizován {new Date(account.updatedAt).toLocaleString("cs-CZ")}
                        {account.dataFreshness.coverageThrough ? " · doloženo do " + new Date(account.dataFreshness.coverageThrough + "T12:00:00").toLocaleDateString("cs-CZ") : ""}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div>
              <EmptyState title="Zatím nemáš připojený účet" description="Připoj Trading 212, Kraken nebo přidej podporovaný výpis. Údaje se ukládají lokálně." />
              <Link href="/connections" prefetch={false} className="finance-action finance-action-primary mx-auto mt-4 flex w-fit">Přejít na propojení →</Link>
            </div>
          )}
        </SectionCard>
      </div>
      <div className="mt-4">
        <SectionCard title="Ručně vedené zůstatky" subtitle="Oddělené od peněžních toků, aby se příjem nezapočítal do majetku dvakrát">
          <ManualBalancesManager initialBalances={manualBalances} />
        </SectionCard>
      </div>
    </main>
  );
}
