import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getHistoryData, getPerformanceData } from "@/lib/server/analytics";
import { PortfolioHistoryChart } from "@/components/portfolio-history-chart";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pct(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("cs-CZ", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }) + " %";
}

export default function PerformancePage() {
  const data = getPerformanceData();
  const history = getHistoryData();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Money-weighted analytics</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Performance
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Výnos oddělený od vkladů a výběrů. XIRR používá skutečné časování
          externích cash flow a dnešní hodnotu portfolia.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Investiční majetek"
          value={data.totals.currentValueCzk}
          format="currency"
          hint="Broker + crypto + P2P"
        />
        <StatCard
          label={
            data.totals.performanceStatus === "partial"
              ? "Známé čisté vklady"
              : "Čisté vklady"
          }
          value={data.totals.netContributedCzk}
          format="currency"
          hint={
            data.totals.performanceStatus === "partial"
              ? "Pouze bezpečně klasifikované vlastní vklady/výběry"
              : "Vlastní kapitál bez card rewards"
          }
        />
        <StatCard
          label="Externí odměny"
          value={data.totals.externalRewardsCzk}
          format="currency"
          hint="Např. Trading 212 cashback; není to vlastní vklad ani tržní výnos"
          positive={data.totals.externalRewardsCzk > 0}
        />
        <StatCard
          label="Odhad zisku"
          value={data.totals.estimatedProfitCzk}
          format="currency"
          hint="Aktuální hodnota mínus vlastní kapitál a externí odměny"
          positive={
            data.totals.estimatedProfitCzk === null
              ? undefined
              : data.totals.estimatedProfitCzk >= 0
          }
        />
        <StatCard
          label="XIRR"
          value={data.totals.xirrPct}
          format="percent"
          hint={
            data.totals.xirrPct === null
              ? "Nedostatek cash-flow dat"
              : "Annualizovaný money-weighted return"
          }
          positive={
            data.totals.xirrPct === null
              ? undefined
              : data.totals.xirrPct >= 0
          }
        />
      </section>

      {data.totals.performanceStatus === "partial" ? (
        <div className="mt-4 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/[0.05] p-4">
          <p className="text-sm font-semibold text-[var(--warning)]">
            Celkový výkon je dočasně neúplný
          </p>
          {data.totals.staleValuationCount ? (
            <p className="mt-2 max-w-5xl text-xs leading-5 text-[var(--muted)]">
              {data.totals.staleValuationCount} investiční účet
              {data.totals.staleValuationCount === 1 ? "" : "ů"} nemá hodnotu
              doloženou až k dnešku. FinanceOS proto nepřenáší poslední známou
              hodnotu do současnosti a nevymýšlí aktuální zisk ani XIRR.
            </p>
          ) : (
            <p className="mt-2 max-w-5xl text-xs leading-5 text-[var(--muted)]">
              FinanceOS má {data.totals.unclassifiedFlowCount} investiční
              cash-flow záznam{data.totals.unclassifiedFlowCount === 1 ? "" : "ů"},
              u kterých zatím nelze bezpečně určit, zda jde o externí vklad/výběr
              nebo přesun uvnitř tvého majetku. Proto nezobrazuje celkový odhad
              zisku ani XIRR jako přesné číslo. Známá hodnota těchto toků je
              přibližně{" "}
              {data.totals.knownUnclassifiedFlowCzk.toLocaleString("cs-CZ", {
                maximumFractionDigits: 0,
              })}{" "}
              Kč.
              {data.totals.unlinkedWalletTransferCount
                ? " Z toho " +
                  data.totals.unlinkedWalletTransferCount +
                  " záznamů jsou nepropojené on-chain převody."
                : ""}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-4">
        <SectionCard
          title="Zisk a ztráta vůči vkladům"
          subtitle="Porovnej skutečnou hodnotu s vloženým kapitálem, filtruj platformy i období"
        >
          <PortfolioHistoryChart data={history.chart} defaultMetric="profit" />
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Výkon podle účtu"
          subtitle="Odhad je přesný jen tehdy, pokud provider/import obsahuje kompletní vklady a výběry"
        >
          {data.accounts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 text-right font-medium">Current value</th>
                    <th className="pb-3 text-right font-medium">External in</th>
                    <th className="pb-3 text-right font-medium">External out</th>
                    <th className="pb-3 text-right font-medium">Rewards</th>
                    <th className="pb-3 text-right font-medium">Wallet in</th>
                    <th className="pb-3 text-right font-medium">Wallet out</th>
                    <th className="pb-3 text-right font-medium">Capital attributed</th>
                    <th className="pb-3 text-right font-medium">Est. profit</th>
                    <th className="pb-3 text-right font-medium">Simple return</th>
                    <th className="pb-3 text-right font-medium">XIRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((account) => (
                    <tr
                      key={account.id}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{account.name}</p>
                          <DataFreshnessBadge
                            freshness={account.dataFreshness}
                            compact
                          />
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {account.provider} · {account.externalFlowCount} external flows
                          {account.unclassifiedFlowCount
                            ? " · " +
                              account.unclassifiedFlowCount +
                              " unresolved flow(s)"
                            : ""}
                        </p>
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.currentValueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.depositsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.withdrawalsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.externalRewardsCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.transferInCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.transferOutCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {account.netContributedCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td
                        className={[
                          "py-4 text-right font-mono text-sm",
                          account.estimatedProfitCzk === null
                            ? "text-[var(--muted)]"
                            : account.estimatedProfitCzk > 0
                              ? "text-[var(--accent)]"
                              : account.estimatedProfitCzk < 0
                                ? "text-[var(--danger)]"
                                : "",
                        ].join(" ")}
                      >
                        {account.estimatedProfitCzk === null
                          ? "—"
                          : `${account.estimatedProfitCzk > 0 ? "+" : ""}${account.estimatedProfitCzk.toLocaleString(
                              "cs-CZ",
                              { maximumFractionDigits: 0 },
                            )} Kč`}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {pct(account.simpleReturnPct)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {pct(account.xirrPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Připoj investiční účet nebo importuj Mintos.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
        <p className="text-sm font-semibold">Jak číst tato čísla</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          Nákupy a prodeje uvnitř účtu nejsou externí cash flow. Cashback a
          podobné odměny zvenku nejsou vlastní vklad, ale při výpočtu investičního
          výnosu se odečtou jako externí reward capital, aby nezvyšovaly výkon
          akcií. Přesun mezi
          vlastními platformami nebo peněženkami také nemění celkové vložené
          peníze v portfoliu. U konkrétního provideru se ale carried book value
          přesunu odečte/přičte, takže například Kraken → Phantom nezůstane
          navždy vedený jako kapitál na Krakenu. Neidentifikované on-chain
          převody jsou viditelně označené místo toho, aby je FinanceOS svévolně
          vydával za bankovní výběr.
        </p>
      </div>
    </main>
  );
}
