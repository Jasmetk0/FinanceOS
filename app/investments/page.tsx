import Link from "next/link";
import { Pill, SectionCard, StatCard, EmptyState } from "@/components/ui";
import { getDashboardData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function czk(value: number) {
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
}
function pnl(value: number | null) {
  if (value === null) return "—";
  return (value > 0 ? "+" : "") + czk(value);
}
function pnlTone(value: number | null) {
  return value === null ? "text-[var(--muted)]" : value > 0 ? "text-[var(--accent)]" : value < 0 ? "text-[var(--danger)]" : "text-[var(--foreground)]";
}

export default function InvestmentsPage() {
  const dashboard = getDashboardData();
  const holdings = dashboard.holdings;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Aktuální pozice</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Investice</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)] sm:text-base">Přehled držených aktiv napříč platformami. Chybějící nákupní cenu nezaměňuj za nulový zisk.</p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard featured label="Investovaná hodnota" value={dashboard.summary.investedCzk} format="currency" />
        <StatCard label="Nerealizovaný P/L" value={dashboard.summary.unrealizedPnlCzk} format="currency" positive={dashboard.summary.unrealizedPnlCzk === null ? undefined : dashboard.summary.unrealizedPnlCzk >= 0} hint="Pouze u pozic se známou nákupní cenou" />
        <StatCard label="Pozic" value={holdings.length} />
        <StatCard label="Účtů" value={dashboard.accounts.length} />
      </section>

      <div className="mt-4">
        <SectionCard title="Držená aktiva" subtitle="Ocenění a nerealizovaný P/L dle dostupných dat" action={<Link href="/performance" prefetch={false} className="text-xs font-semibold text-[var(--accent)]">Detail výkonnosti ↗</Link>}>
          {holdings.length ? (
            <>
              <div className="grid gap-3 md:hidden">
                {holdings.map((holding) => (
                  <Link key={holding.id} href={"/investments/" + encodeURIComponent(holding.symbol)} prefetch={false} className="finance-account-card group block p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[15px] font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]">{holding.symbol}</span>
                        <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{holding.name}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/[.03] px-2 py-1 text-[10px] capitalize text-[var(--muted)]">{holding.assetClass}</span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] text-[var(--muted)]">Hodnota</p>
                        <p className="mt-1 text-[18px] font-semibold tracking-tight tabular-nums">{czk(holding.valueCzk)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-[var(--muted)]">P/L</p>
                        <p className={["mt-1 text-[13px] font-semibold tabular-nums", pnlTone(holding.pnlCzk)].join(" ")}>{pnl(holding.pnlCzk)}</p>
                      </div>
                    </div>
                    <p className="mt-3 border-t border-white/[.07] pt-3 text-[11px] text-[var(--muted)]">{holding.accountName} · {holding.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 })} ks</p>
                  </Link>
                ))}
              </div>
              <p className="finance-scroll-hint mb-2 hidden md:block lg:hidden">Tabulku můžeš posouvat do stran</p>
              <div className="finance-scrollbar hidden overflow-x-auto rounded-[15px] border border-[var(--border)] md:block">
                <table className="finance-data-table min-w-[850px] text-left">
                  <thead>
                    <tr>
                      <th>Aktivum</th>
                      <th>Účet</th>
                      <th>Třída</th>
                      <th className="text-right">Množství</th>
                      <th className="text-right">Hodnota</th>
                      <th className="text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((holding) => (
                      <tr key={holding.id}>
                        <td>
                          <Link href={"/investments/" + encodeURIComponent(holding.symbol)} prefetch={false} className="text-[13px] font-semibold text-[var(--foreground)] transition hover:text-[var(--accent)]">{holding.symbol} ↗</Link>
                          <p className="mt-1 max-w-[280px] truncate text-[11px] text-[var(--muted)]">{holding.name}</p>
                        </td>
                        <td className="text-[12px] text-[var(--muted)]">{holding.accountName}</td>
                        <td className="text-[12px] capitalize text-[var(--muted)]">{holding.assetClass}</td>
                        <td className="text-right text-[12px] tabular-nums">{holding.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 })}</td>
                        <td className="text-right text-[13px] font-semibold tabular-nums">{czk(holding.valueCzk)}</td>
                        <td className={["text-right text-[12px] font-semibold tabular-nums", pnlTone(holding.pnlCzk)].join(" ")}>{pnl(holding.pnlCzk)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div><EmptyState title="Zatím žádné pozice" description="Připoj investiční účet a spusť synchronizaci. Pokud provider neposkytuje nákupní cenu, P/L zůstane prázdné." /><Link href="/connections" prefetch={false} className="finance-action finance-action-primary mx-auto mt-4 flex w-fit">Připojit účet →</Link></div>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
