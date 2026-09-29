import Link from "next/link";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { getDashboardData, getHistoryData } from "@/lib/server/analytics";
import { PortfolioHistoryChart } from "@/components/portfolio-history-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  const data = getDashboardData();
  const history = getHistoryData();
  const hasPortfolioData =
    data.connections.length > 0 ||
    data.accounts.some((account) => account.provider !== "manual");

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Pill>{hasPortfolioData ? "Portfolio data" : "Setup required"}</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Přehled majetku
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            FinanceOS sjednocuje investiční účty, transakce a ručně zadané
            peněžní toky do jedné lokální databáze.
          </p>
        </div>
        <SyncButton />
      </div>

      {!hasPortfolioData ? (
        <div className="mb-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
          <p className="font-medium">Připoj první investiční účet</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            API klíče se ukládají pouze lokálně, šifrovaně. FinanceOS
            nepotřebuje oprávnění k obchodování ani k výběrům.
          </p>
          <Link
            href="/connections"
            className="mt-4 inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
          >
            Open Connections
          </Link>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Celkový majetek"
          value={data.summary.netWorthCzk}
          format="currency"
          hint="Součet aktuálně naceněných účtů"
        />
        <StatCard
          label="Investovaná hodnota"
          value={data.summary.investedCzk}
          format="currency"
          hint="Investiční část připojených účtů"
        />
        <StatCard
          label="Nerealizovaný P/L"
          value={data.summary.unrealizedPnlCzk}
          format="currency"
          hint="Kde ho provider poskytuje"
          positive={data.summary.unrealizedPnlCzk >= 0}
        />
        <StatCard
          label="Hotovost"
          value={data.summary.cashCzk}
          format="currency"
          hint="Cash a ruční cash-flow"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Vývoj investičního portfolia"
          subtitle="Interaktivně: hodnota, vklady, zisk/ztráta, výnos %, platformy a období"
        >
          <PortfolioHistoryChart data={history.chart} compact />
        </SectionCard>

        <SectionCard title="Účty" subtitle="Aktuální hodnota podle zdroje">
          {data.accounts.length ? (
            <div className="space-y-5">
              {data.accounts.map((account) => {
                const share = data.summary.netWorthCzk
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (account.valueCzk / data.summary.netWorthCzk) * 100,
                      ),
                    )
                  : 0;
                return (
                  <div key={account.id}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{account.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {account.type} · {account.provider}
                        </p>
                      </div>
                      <p className="font-mono text-sm">
                        {account.valueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </p>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádná data.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Alokace"
          subtitle="Podle třídy aktuálně držených aktiv"
        >
          {data.allocation.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.allocation.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
                >
                  <span className="text-sm capitalize text-[var(--muted)]">
                    {item.label}
                  </span>
                  <p className="mt-2 text-xl font-semibold">
                    {item.valueCzk.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    Kč
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádné pozice.</p>
          )}
        </SectionCard>

        <SectionCard title="Poslední aktivita" subtitle="Sjednocený ledger">
          {data.recentTransactions.length ? (
            <div className="divide-y divide-white/7">
              {data.recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {tx.symbol || tx.note || tx.kind}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {tx.accountName} ·{" "}
                      {new Date(tx.occurredAt).toLocaleDateString("cs-CZ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm">
                      {tx.amountCzk === null
                        ? `${tx.amount.toLocaleString("cs-CZ")} ${tx.currency}`
                        : `${tx.amountCzk.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 0,
                          })} Kč`}
                    </p>
                    <p className="mt-1 text-xs uppercase text-[var(--muted)]">
                      {tx.kind}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím žádné transakce.
            </p>
          )}
        </SectionCard>
      </section>
    </main>
  );
}
