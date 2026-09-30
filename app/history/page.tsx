import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getHistoryData } from "@/lib/server/analytics";
import { HistoricalPriceImporter } from "@/components/historical-price-importer";
import {
  listPriceImportAssets,
  reconstructPricedHoldingsHistory,
} from "@/lib/server/historical-prices";
import {
  InteractiveTimeSeriesChart,
  PortfolioHistoryChart,
} from "@/components/portfolio-history-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const data = getHistoryData();
  const priceAssets = listPriceImportAssets();
  const reconstructed = reconstructPricedHoldingsHistory();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Historical coverage</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          History
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Odděleně sledujeme historii transakcí, externích vkladů a skutečných
          mark-to-market snapshotů. FinanceOS tak nepředstírá přesnost tam, kde
          ještě nemá historické tržní ceny.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Známé čisté vklady"
          value={data.summary.netContributedCzk}
          format="currency"
          hint="Vklady mínus výběry investičních účtů"
        />
        <StatCard
          label="Celkové vklady"
          value={data.summary.depositsCzk}
          format="currency"
        />
        <StatCard
          label="Celkové výběry"
          value={data.summary.withdrawalsCzk}
          format="currency"
        />
        <StatCard
          label="Externí odměny"
          value={data.summary.externalRewardsCzk}
          format="currency"
          hint="Např. Trading 212 cashback; není to vlastní vklad"
          positive={data.summary.externalRewardsCzk > 0}
        />
        <StatCard
          label="Portfolio snapshots"
          value={data.snapshots.length}
          hint={
            data.summary.firstSnapshot
              ? "Od " +
                new Date(
                  data.summary.firstSnapshot + "T12:00:00",
                ).toLocaleDateString("cs-CZ")
              : "Zatím bez snapshotu"
          }
        />
      </section>

      <div className="mt-4">
        <SectionCard
          title="Historie vkladů, výběrů a externích odměn"
          subtitle="Vlastní kapitál je vedený odděleně od cashbacku a dalších externích odměn"
        >
          {data.monthlyCapitalFlows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Měsíc</th>
                    <th className="pb-3 text-right font-medium">Vklady</th>
                    <th className="pb-3 text-right font-medium">Výběry</th>
                    <th className="pb-3 text-right font-medium">Čisté vlastní vklady</th>
                    <th className="pb-3 text-right font-medium">Externí odměny</th>
                    <th className="pb-3 text-right font-medium">Kapitál pro P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.monthlyCapitalFlows].reverse().map((item) => (
                    <tr
                      key={item.month}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-3 font-mono text-sm">{item.month}</td>
                      <td className="py-3 text-right font-mono text-sm">
                        {item.depositsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {item.withdrawalsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {item.netContributedCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {item.externalRewardsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {item.capitalForPnlCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        Kč
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím nejsou rozpoznané žádné externí investiční vklady nebo výběry.
            </p>
          )}
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            „Čisté vlastní vklady“ = tvoje vklady mínus výběry. „Kapitál pro
            P/L“ k nim přidává externí odměny, aby cashback nezvyšoval vykázaný
            investiční výnos.
          </p>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Interaktivní historie investičního portfolia"
          subtitle="Přepínej hodnotu, čisté vklady, P/L a procentní výnos; filtruj období i jednotlivé platformy"
        >
          <PortfolioHistoryChart data={data.chart} />
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Reconstructed priced positions"
          subtitle="Z transakčních quantity změn a importovaných historical close cen; bez hotovosti"
        >
          <InteractiveTimeSeriesChart
            data={reconstructed.series.map((item) => ({
              date: item.date,
              value: item.valueCzk,
            }))}
            label="Reconstructed priced positions"
            valueFormat="currency"
            emptyText="Importuj historical close ceny alespoň pro jeden asset. FinanceOS potom zpětně dopočítá hodnotu držených pozic v dnech, pro které má cenová data."
          />
          {reconstructed.series.length ? (
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              Tato křivka není plný historical net worth: zahrnuje pouze pozice
              s dostupnou cenovou historií a nezahrnuje historickou hotovost.
            </p>
          ) : null}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Historical price coverage"
          subtitle="Které assety už mají importované denní close ceny"
        >
          {reconstructed.assetCoverage.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Asset</th>
                    <th className="pb-3 font-medium">Provider</th>
                    <th className="pb-3 text-right font-medium">Prices</th>
                    <th className="pb-3 font-medium">Coverage</th>
                    <th className="pb-3 text-right font-medium">Missing CZK</th>
                  </tr>
                </thead>
                <tbody>
                  {reconstructed.assetCoverage.map((item) => (
                    <tr
                      key={item.assetId}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4">
                        <p className="text-sm font-medium">{item.symbol}</p>
                        <p className="mt-1 max-w-[280px] truncate text-xs text-[var(--muted)]">
                          {item.name}
                        </p>
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {item.provider}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {item.priceCount.toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {item.firstPrice && item.lastPrice
                          ? new Date(
                              item.firstPrice + "T12:00:00",
                            ).toLocaleDateString("cs-CZ") +
                            " → " +
                            new Date(
                              item.lastPrice + "T12:00:00",
                            ).toLocaleDateString("cs-CZ")
                          : "—"}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {item.missingCzk.toLocaleString("cs-CZ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím nebyly importovány žádné historical prices.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Import historical prices"
          subtitle="CSV import pro zpětnou rekonstrukci hodnoty pozic"
        >
          <HistoricalPriceImporter assets={priceAssets} />
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Coverage podle účtu"
          subtitle="Přesně vidíš, jak hluboko sahají importovaná data a odkdy máme vlastní snapshoty"
        >
          {data.coverage.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 text-right font-medium">Transactions</th>
                    <th className="pb-3 font-medium">Oldest transaction</th>
                    <th className="pb-3 font-medium">Newest transaction</th>
                    <th className="pb-3 text-right font-medium">Snapshots</th>
                    <th className="pb-3 font-medium">Snapshot coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverage.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {item.provider} · {item.type}
                        </p>
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {item.transactionCount.toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {item.oldestTransaction
                          ? new Date(item.oldestTransaction).toLocaleDateString(
                              "cs-CZ",
                            )
                          : "—"}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {item.newestTransaction
                          ? new Date(item.newestTransaction).toLocaleDateString(
                              "cs-CZ",
                            )
                          : "—"}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {item.snapshotCount.toLocaleString("cs-CZ")}
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {item.firstSnapshot
                          ? new Date(
                              item.firstSnapshot + "T12:00:00",
                            ).toLocaleDateString("cs-CZ") +
                            " → " +
                            new Date(
                              (item.lastSnapshot || item.firstSnapshot) +
                                "T12:00:00",
                            ).toLocaleDateString("cs-CZ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím není k dispozici žádná historie.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
        <p className="text-sm font-semibold">Přesnost historical reconstruction</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          FinanceOS už umí historické close ceny importovat a z quantity změn
          rekonstruovat hodnotu pozic. Pro úplný historical net worth ještě
          potřebujeme pokrýt všechny držené assety a historickou hotovost.
          Skutečné denní snapshoty proto zůstávají oddělené od rekonstruované
          křivky.
        </p>
      </div>
    </main>
  );
}
