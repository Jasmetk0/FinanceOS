import Link from "next/link";
import { Pill, SectionCard, StatCard, EmptyState } from "@/components/ui";
import { HoldingsExplorer } from "@/components/holdings-explorer";
import { getDashboardData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function InvestmentsPage() {
  const dashboard = getDashboardData();
  const holdings = dashboard.holdings;
  const unavailablePnl = holdings.filter((item) => item.pnlCzk === null).length;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Aktuální pozice · {holdings.length.toLocaleString("cs-CZ")}</Pill>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Investice</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Vyhledávej, porovnávej a filtruj všechny pozice. Údaje jsou z posledních dostupných záznamů platformy.
          </p>
        </div>
        <Link href="/performance" prefetch={false} className="finance-action">Výkonnost a vklady ↗</Link>
      </div>

      <section className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard featured label="Investovaná hodnota" value={dashboard.summary.investedCzk} format="currency" hint="Součet doložených investičních hodnot účtů" />
        <StatCard label="Nerealizovaný P/L" value={dashboard.summary.unrealizedPnlCzk} format="currency" positive={dashboard.summary.unrealizedPnlCzk === null ? undefined : dashboard.summary.unrealizedPnlCzk >= 0} hint={dashboard.summary.unrealizedPnlCzk === null ? "Není k dispozici kompletní P/L" : "Pouze tam, kde je P/L doložené"} />
        <StatCard label="Počet pozic" value={holdings.length} hint="Pozice vedené u investičních platforem" />
        <StatCard label="Propojené účty" value={dashboard.accounts.length} hint="Včetně účtů bez aktuálních pozic" />
      </section>

      {unavailablePnl > 0 ? (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--warning)]/20 bg-[var(--warning)]/[.045] px-4 py-3">
          <p className="text-xs leading-5 text-[var(--muted)]">
            <span className="font-semibold text-[var(--warning)]">Neúplný P/L:</span>{" "}
            {unavailablePnl.toLocaleString("cs-CZ")} pozic nemá spolehlivou hodnotu nerealizovaného P/L. Jejich výsledek zůstává „—“.
          </p>
          <Link href="/connections" prefetch={false} className="text-xs font-semibold text-[var(--warning)] hover:underline">Zkontrolovat zdroje ↗</Link>
        </div>
      ) : null}

      <div className="mt-4">
        <SectionCard title="Průzkumník portfolia" subtitle="Filtruj podle účtu, platformy, třídy aktiv a dostupnosti P/L. Řazení nepřepisuje zdrojová data." action={<Link href="/accounts" prefetch={false} className="text-xs font-semibold text-[var(--accent)]">Přehled účtů ↗</Link>}>
          {holdings.length ? (
            <HoldingsExplorer holdings={holdings} />
          ) : (
            <div>
              <EmptyState title="Zatím žádné pozice" description="Připoj investiční účet a spusť synchronizaci. Dokud není známá nákupní cena, výsledek se nezobrazuje jako nula." />
              <Link href="/connections" prefetch={false} className="finance-action finance-action-primary mx-auto mt-4 flex w-fit">Připojit účet →</Link>
            </div>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
