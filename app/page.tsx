import Link from "next/link";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { getDashboardData, getHistoryData } from "@/lib/server/analytics";
import { PortfolioHistoryChart } from "@/components/portfolio-history-chart";
import { providerColor, providerLabel } from "@/lib/provider-visuals";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  const data = getDashboardData();
  const history = getHistoryData();
  const hasPortfolioData =
    data.connections.length > 0 ||
    data.accounts.some((account) => account.provider !== "manual");
  const staleAccounts = data.accounts.filter((account) => account.dataFreshness.status === "stale");
  const quickLinks = [
    { href: "/performance", title: "Výkonnost", description: "Zisk a výnos" },
    { href: "/cash-flow", title: "Peněžní toky", description: "Vklady a výběry" },
    { href: "/investments", title: "Investice", description: "Aktuální pozice" },
    { href: "/connections", title: "Propojení", description: "API a importy" },
  ];

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Pill>{hasPortfolioData ? "Osobní investiční centrum" : "Začni připojením účtu"}</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-[2.65rem]">
            Přehled majetku
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Všechny investice na jednom místě. Sleduj hodnotu portfolia,
            výkonnost a skutečné vklady napříč platformami.
          </p>
        </div>
        <SyncButton />
      </div>

      <nav aria-label="Rychlé odkazy" className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {quickLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className="group flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white/[.025] px-4 py-3.5 transition hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/[.05]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--foreground)]">{item.title}</span>
              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{item.description}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-base text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-[var(--accent)]">↗</span>
          </Link>
        ))}
      </nav>

      {!hasPortfolioData ? (
        <div className="mb-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
          <p className="font-medium">Připoj první investiční účet</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            API klíče se ukládají pouze lokálně, šifrovaně. FinanceOS
            nepotřebuje oprávnění k obchodování ani k výběrům.
          </p>
          <Link
            href="/connections"
            prefetch={false}
            className="mt-4 inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
          >
            Připojit účet
          </Link>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Celkový majetek"
          value={data.summary.netWorthCzk}
          format="currency"
          hint={
            data.summary.unclassifiedCzk
              ? "Provider totals včetně explicitně nezařazené hodnoty"
              : "Součet posledních doložených hodnot účtů"
          }
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
          hint={
            data.summary.unrealizedPnlCzk === null
              ? "Nedostatek dat pro kompletní P/L"
              : "Kde ho provider poskytuje"
          }
          positive={
            data.summary.unrealizedPnlCzk === null
              ? undefined
              : data.summary.unrealizedPnlCzk >= 0
          }
        />
        <StatCard
          label="Hotovost"
          value={data.summary.cashCzk}
          format="currency"
          hint="Pouze známá hotovost; nezařazená hodnota se sem nepočítá"
        />
      </section>

      {staleAccounts.length > 0 ? (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/[.055] px-4 py-3.5">
          <div>
            <p className="text-sm font-semibold text-[var(--warning)]">Některé údaje nemusí být aktuální</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {staleAccounts.length} {staleAccounts.length === 1 ? "účet má" : "účtů má"} starší doložená data. Poslední hodnotu nezaměňuj za dnešní ocenění.
            </p>
          </div>
          <Link href="/accounts" prefetch={false} className="shrink-0 text-xs font-semibold text-[var(--warning)] underline underline-offset-4 hover:text-white">
            Zkontrolovat účty →
          </Link>
        </div>
      ) : null}

      {Math.abs(data.summary.unclassifiedCzk) > 0.01 ? (
        <div className="mt-4 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/[0.05] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Nezařazená hodnota v provider datech</p>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--muted)]">
                FinanceOS ji zahrnuje do celkového majetku, protože ji provider
                uvádí v account total, ale nevydává ji za hotovost ani investici,
                dokud ji neumíme bezpečně vysvětlit.
              </p>
            </div>
            <p className="shrink-0 font-mono text-sm text-[var(--warning)]">
              {data.summary.unclassifiedCzk.toLocaleString("cs-CZ", {
                maximumFractionDigits: 2,
              })}{" "}
              Kč
            </p>
          </div>
        </div>
      ) : null}

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Vývoj investičního portfolia"
          subtitle="Hodnota, čisté vklady a skutečný výsledek · filtrování podle období a platformy"
          action={<Link href="/history" prefetch={false} className="text-xs font-semibold text-[var(--accent)] hover:underline">Detailní historie ↗</Link>}
        >
          <PortfolioHistoryChart data={history.chart} compact />
        </SectionCard>

        <SectionCard
          title="Účty"
          subtitle="Hodnota a aktuálnost dat jednotlivých platforem"
          action={<Link href="/accounts" prefetch={false} className="text-xs font-semibold text-[var(--accent)] hover:underline">Všechny účty ↗</Link>}
        >
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
                  <div key={account.id} className="rounded-xl p-2 transition hover:bg-white/[.03]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={"/accounts/" + encodeURIComponent(account.id)}
                            className="font-semibold transition hover:text-[var(--accent)]"
                          >
                            {account.name}
                          </Link>
                          <DataFreshnessBadge
                            freshness={account.dataFreshness}
                            compact
                          />
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {account.type} · {providerLabel(account.provider)}
                          {account.reconciliationStatus === "warning"
                            ? " · reconciliation warning"
                            : ""}
                        </p>
                        {Math.abs(account.unclassifiedValueCzk) > 0.01 ? (
                          <p className="mt-1 text-[10px] text-[var(--warning)]">
                            Nezařazeno{" "}
                            {account.unclassifiedValueCzk.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 2,
                            })}{" "}
                            Kč
                          </p>
                        ) : null}
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
                        className="h-full rounded-full"
                        style={{
                          width: `${share}%`,
                          backgroundColor: providerColor(account.provider),
                        }}
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
          subtitle="Rozložení hodnoty podle třídy aktiv"
          action={<Link href="/investments" prefetch={false} className="text-xs font-semibold text-[var(--accent)] hover:underline">Zobrazit pozice ↗</Link>}
        >
          {data.allocation.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.allocation.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-4"
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

        <SectionCard title="Poslední aktivita" subtitle="Nejnovější záznamy ze všech účtů" action={<Link href="/transactions" prefetch={false} className="text-xs font-semibold text-[var(--accent)] hover:underline">Všechny transakce ↗</Link>}>
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
