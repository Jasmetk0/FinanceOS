import Link from "next/link";
import { notFound } from "next/navigation";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { AccountDailyHistoryTable } from "@/components/account-daily-history-table";
import { PortfolioHistoryChart } from "@/components/portfolio-history-chart";
import { TransactionsTable } from "@/components/transactions-table";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { providerLabel } from "@/lib/provider-visuals";
import { getAccountDetail } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function money(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("cs-CZ", {
    maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0,
  }) + " Kč";
}

function pct(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return (value > 0 ? "+" : "") +
    value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
    " %";
}

function sourceLabel(source: string) {
  if (source === "api_sync") return "Live API synchronizace";
  if (source === "statement") return "Importovaný výpis";
  if (source === "manual_override") return "Výpis + ruční aktuální stav";
  if (source === "manual") return "Ruční účet";
  return "Neurčený zdroj";
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("cs-CZ") : "—";
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const detail = getAccountDetail(decodeURIComponent(rawId));
  if (!detail) notFound();

  const performance = detail.performance;
  const isStale = detail.dataFreshness.status === "stale";

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Link href="/accounts" className="text-sm text-[var(--muted)] transition hover:text-white">
        ← Accounts
      </Link>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{providerLabel(detail.provider)}</Pill>
            <DataFreshnessBadge freshness={detail.dataFreshness} />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {detail.name}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {detail.type} · {detail.currency} · {detail.externalId}
          </p>
        </div>
        <div className="text-left lg:text-right">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
            Poslední doložená hodnota
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold">
            {money(detail.totalValueCzk)}
          </p>
        </div>
      </div>

      {isStale ? (
        <div className="mt-5 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/[0.05] p-4">
          <p className="text-sm font-semibold text-[var(--warning)]">
            Účet nemá data až k dnešku
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Poslední doložený stav je{" "}
            {detail.dataFreshness.coverageThrough
              ? new Date(detail.dataFreshness.coverageThrough + "T12:00:00").toLocaleDateString("cs-CZ")
              : "neznámý"}
            . FinanceOS proto nevydává starší hodnotu za dnešní výkon.
          </p>
        </div>
      ) : null}

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Celková hodnota" value={detail.totalValueCzk} format="currency" hint="Poslední doložená hodnota účtu" />
        <StatCard label="Hotovost" value={detail.cashValueCzk} format="currency" hint="Známá cash část účtu" />
        <StatCard
          label="Investováno"
          value={detail.investedValueCzk}
          format="currency"
          hint={detail.holdings.length.toLocaleString("cs-CZ") + " aktuálních pozic"}
        />
        <StatCard
          label="Odhad zisku"
          value={performance?.estimatedProfitCzk ?? null}
          format="currency"
          hint={
            performance?.estimatedProfitCzk === null || !performance
              ? "Nedostatek aktuálních / úplných cash-flow dat"
              : "Simple return " + pct(performance.simpleReturnPct)
          }
          positive={
            performance?.estimatedProfitCzk === null ||
            performance?.estimatedProfitCzk === undefined
              ? undefined
              : performance.estimatedProfitCzk >= 0
          }
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
        <SectionCard title="Vývoj účtu" subtitle="Hodnota, vklady, P/L a výnos pouze pro tento účet">
          {detail.chart.points.length ? (
            <PortfolioHistoryChart data={detail.chart} compact />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Pro tento účet zatím není uložená historická řada.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Výkon" subtitle="Cash-flow očištěná analytika">
          <dl className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">XIRR</dt>
              <dd className="font-mono">{pct(performance?.xirrPct)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">Čistý vložený kapitál</dt>
              <dd className="font-mono">{money(performance?.netContributedCzk ?? null)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">Vklady</dt>
              <dd className="font-mono">{money(performance?.depositsCzk ?? null)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">Výběry</dt>
              <dd className="font-mono">{money(performance?.withdrawalsCzk ?? null)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">Transfery dovnitř</dt>
              <dd className="font-mono">{money(performance?.transferInCzk ?? null)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">Transfery ven</dt>
              <dd className="font-mono">{money(performance?.transferOutCzk ?? null)}</dd>
            </div>
            <div className="border-t border-white/7 pt-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--muted)]">Realizované P/L</dt>
                <dd className="font-mono">{money(detail.realizedPnlCzk)}</dd>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4">
                <dt className="text-[var(--muted)]">Nerealizované P/L</dt>
                <dd className="font-mono">{money(detail.unrealizedPnlCzk)}</dd>
              </div>
            </div>
          </dl>
        </SectionCard>
      </section>

      {detail.dailyHistory.length ? (
        <section className="mt-4">
          <SectionCard
            title="Denní historie účtu"
            subtitle="Každý známý den: hodnota, cash, investice, vklady, výběry, kapitál, P/L a výnos"
          >
            <AccountDailyHistoryTable rows={detail.dailyHistory} />
          </SectionCard>
        </section>
      ) : null}

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Datové pokrytí" subtitle="Jak moc tomuto účtu můžeme věřit">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--muted)]">Zdroj</dt>
              <dd className="mt-1 font-medium">{sourceLabel(detail.dataFreshness.source)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Doloženo do</dt>
              <dd className="mt-1 font-mono">
                {detail.dataFreshness.coverageThrough
                  ? new Date(detail.dataFreshness.coverageThrough + "T12:00:00").toLocaleDateString("cs-CZ")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">FinanceOS aktualizace</dt>
              <dd className="mt-1 font-mono">{dateTime(detail.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Transakce</dt>
              <dd className="mt-1 font-mono">{detail.coverage.transactionCount.toLocaleString("cs-CZ")}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">První transakce</dt>
              <dd className="mt-1 font-mono">{dateTime(detail.coverage.firstTransactionAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Poslední transakce</dt>
              <dd className="mt-1 font-mono">{dateTime(detail.coverage.lastTransactionAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Snapshoty</dt>
              <dd className="mt-1 font-mono">{detail.coverage.snapshotCount.toLocaleString("cs-CZ")}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Reconciliation</dt>
              <dd className="mt-1 font-mono">{detail.reconciliationStatus}</dd>
            </div>
          </dl>

          {detail.sourceMetadata.importMode ||
          detail.sourceMetadata.balanceMode ||
          detail.sourceMetadata.costBasisStatus ||
          detail.sourceMetadata.lifetimeComplete !== null ? (
            <div className="mt-5 border-t border-white/7 pt-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                Provider metadata
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {detail.sourceMetadata.importMode ? (
                  <span className="rounded-full border border-white/8 px-2.5 py-1">{detail.sourceMetadata.importMode}</span>
                ) : null}
                {detail.sourceMetadata.balanceMode ? (
                  <span className="rounded-full border border-white/8 px-2.5 py-1">{detail.sourceMetadata.balanceMode}</span>
                ) : null}
                {detail.sourceMetadata.costBasisStatus ? (
                  <span className="rounded-full border border-white/8 px-2.5 py-1">cost basis {detail.sourceMetadata.costBasisStatus}</span>
                ) : null}
                {detail.sourceMetadata.lifetimeComplete !== null ? (
                  <span className="rounded-full border border-white/8 px-2.5 py-1">
                    lifetime {detail.sourceMetadata.lifetimeComplete ? "complete" : "partial"}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {detail.sourceMetadata.unknownTypes.length ? (
            <p className="mt-4 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
              Neznámé typy transakcí: {detail.sourceMetadata.unknownTypes.join(", ")}
            </p>
          ) : null}

          {detail.provider === "trading212" &&
          detail.sourceMetadata.historicalReconstruction ? (
            <div className="mt-5 border-t border-white/7 pt-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                Denní rekonstrukce Trading 212
              </p>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--muted)]">Kompletní dny</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .reconstructedDays ?? 0,
                    ).toLocaleString("cs-CZ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Neúplné dny</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .partialDays ?? 0,
                    ).toLocaleString("cs-CZ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Cenově pokryté assety</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .assetsResolved ?? 0,
                    ).toLocaleString("cs-CZ")}
                    {" / "}
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .assetsTotal ?? 0,
                    ).toLocaleString("cs-CZ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Čeká na další sync</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .assetsPending ?? 0,
                    ).toLocaleString("cs-CZ")}
                    {" assetů"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Historie API</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {detail.sourceMetadata.historicalReconstruction
                      .transactionHistoryComplete === true
                      ? "kompletní"
                      : "doplňuje se"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Quantity nesoulady</dt>
                  <dd className="mt-1 font-mono text-sm">
                    {Number(
                      detail.sourceMetadata.historicalReconstruction
                        .quantityMismatchCount ?? 0,
                    ).toLocaleString("cs-CZ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">
                    Nevysvětlený počáteční cash
                  </dt>
                  <dd className="mt-1 font-mono text-sm">
                    {money(
                      Number(
                        detail.sourceMetadata.historicalReconstruction
                          .openingCashResidualCzk ?? 0,
                      ),
                    )}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                Historické body jsou rekonstruované z transakcí, denních close
                cen a historických kurzů ČNB. Skutečné snapshoty načtené přímo
                z Trading 212 mají vždy přednost.
              </p>
              {Array.isArray(
                detail.sourceMetadata.historicalReconstruction
                  .unresolvedAssets,
              ) &&
              detail.sourceMetadata.historicalReconstruction.unresolvedAssets
                .length ? (
                <p className="mt-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
                  Bez historické ceny zatím:{" "}
                  {detail.sourceMetadata.historicalReconstruction.unresolvedAssets
                    .map(String)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Struktura transakcí" subtitle="Počet záznamů podle typu">
          {detail.transactionKinds.length ? (
            <div className="space-y-3">
              {detail.transactionKinds.map((item) => {
                const share = detail.coverage.transactionCount
                  ? (item.count / detail.coverage.transactionCount) * 100
                  : 0;
                return (
                  <div key={item.kind}>
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="capitalize">{item.kind}</span>
                      <span className="font-mono text-[var(--muted)]">{item.count.toLocaleString("cs-CZ")}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: Math.max(2, share) + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Tento účet zatím nemá transakční historii.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4">
        <SectionCard title="Aktuální pozice" subtitle={detail.holdings.length.toLocaleString("cs-CZ") + " držených aktiv"}>
          {detail.holdings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Asset</th>
                    <th className="pb-3 font-medium">Class</th>
                    <th className="pb-3 text-right font-medium">Quantity</th>
                    <th className="pb-3 text-right font-medium">Avg. price</th>
                    <th className="pb-3 text-right font-medium">Current</th>
                    <th className="pb-3 text-right font-medium">Value</th>
                    <th className="pb-3 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.holdings.map((holding) => (
                    <tr key={holding.id} className="border-b border-white/6 last:border-0">
                      <td className="py-4">
                        <Link
                          href={"/investments/" + encodeURIComponent(holding.symbol)}
                          className="font-medium transition hover:text-[var(--accent)]"
                        >
                          {holding.symbol}
                        </Link>
                        {holding.name !== holding.symbol ? (
                          <p className="mt-1 max-w-[320px] truncate text-xs text-[var(--muted)]">{holding.name}</p>
                        ) : null}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">{holding.assetClass}</td>
                      <td className="py-4 text-right font-mono text-sm">
                        {holding.quantity.toLocaleString("cs-CZ", { maximumFractionDigits: 8 })}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {holding.averagePrice === null
                          ? "—"
                          : holding.averagePrice.toLocaleString("cs-CZ", { maximumFractionDigits: 4 }) + " " + holding.currency}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {holding.currentPrice === null
                          ? "—"
                          : holding.currentPrice.toLocaleString("cs-CZ", { maximumFractionDigits: 4 }) + " " + holding.currency}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">{money(holding.marketValueCzk)}</td>
                      <td className="py-4 text-right font-mono text-sm">{money(holding.unrealizedPnlCzk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Tento účet momentálně nemá samostatně evidované pozice.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4">
        <SectionCard
          title="Transakce účtu"
          subtitle={"Nejnovějších " + detail.transactions.length.toLocaleString("cs-CZ") + " záznamů"}
        >
          <TransactionsTable transactions={detail.transactions} />
        </SectionCard>
      </section>
    </main>
  );
}
