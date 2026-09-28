import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getAnnualReports } from "@/lib/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function money(value: number) {
  return value.toLocaleString("cs-CZ", {
    maximumFractionDigits: 0,
  }) + " Kč";
}

export default function ReportsPage() {
  const data = getAnnualReports();
  const latest = data.totalsByYear[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Annual data summary</Pill>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Reports
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Roční přehled výnosů a transakcí napříč providery. Je to datový
            podklad, ne automaticky hotové daňové přiznání.
          </p>
        </div>
        <a
          href="/api/export/annual-report"
          className="inline-flex shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
        >
          Export annual report (.csv)
        </a>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Latest year"
          value={latest?.year ?? 0}
          hint={latest ? "Nejnovější rok v datech" : "Bez dat"}
        />
        <StatCard
          label="Interest"
          value={latest?.interestCzk ?? 0}
          format="currency"
          hint={latest ? String(latest.year) : "Bez dat"}
        />
        <StatCard
          label="Dividends"
          value={latest?.dividendsCzk ?? 0}
          format="currency"
          hint={latest ? String(latest.year) : "Bez dat"}
        />
        <StatCard
          label="Sales proceeds"
          value={latest?.salesCzk ?? 0}
          format="currency"
          hint={latest ? String(latest.year) : "Bez dat"}
        />
      </section>

      <div className="mt-4">
        <SectionCard
          title="Roční souhrn"
          subtitle="CZK hodnoty používají historický FX převod tam, kde ho FinanceOS zná"
        >
          {data.totalsByYear.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Year</th>
                    <th className="pb-3 text-right font-medium">Interest</th>
                    <th className="pb-3 text-right font-medium">Dividends</th>
                    <th className="pb-3 text-right font-medium">Other income</th>
                    <th className="pb-3 text-right font-medium">Sales</th>
                    <th className="pb-3 text-right font-medium">Purchases</th>
                    <th className="pb-3 text-right font-medium">Fees</th>
                    <th className="pb-3 text-right font-medium">Principal in</th>
                    <th className="pb-3 text-right font-medium">Principal out</th>
                    <th className="pb-3 text-right font-medium">Transactions</th>
                    <th className="pb-3 text-right font-medium">Missing CZK</th>
                  </tr>
                </thead>
                <tbody>
                  {data.totalsByYear.map((row) => (
                    <tr
                      key={row.year}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4 font-semibold">{row.year}</td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.interestCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.dividendsCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.incomeCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.salesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.purchasesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.feesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.principalInvestedCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.principalReturnedCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {row.transactionCount.toLocaleString("cs-CZ")}
                      </td>
                      <td
                        className={[
                          "py-4 text-right font-mono text-sm",
                          row.missingCzkCount
                            ? "text-[var(--warning)]"
                            : "text-[var(--accent)]",
                        ].join(" ")}
                      >
                        {row.missingCzkCount.toLocaleString("cs-CZ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím není k dispozici žádná transakční historie.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Provider breakdown"
          subtitle="Roční souhrn po jednotlivých zdrojích"
        >
          {data.reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Year</th>
                    <th className="pb-3 font-medium">Provider</th>
                    <th className="pb-3 text-right font-medium">Interest</th>
                    <th className="pb-3 text-right font-medium">Dividends</th>
                    <th className="pb-3 text-right font-medium">Sales</th>
                    <th className="pb-3 text-right font-medium">Purchases</th>
                    <th className="pb-3 text-right font-medium">Fees</th>
                    <th className="pb-3 text-right font-medium">Deposits</th>
                    <th className="pb-3 text-right font-medium">Withdrawals</th>
                    <th className="pb-3 text-right font-medium">Principal in</th>
                    <th className="pb-3 text-right font-medium">Principal out</th>
                    <th className="pb-3 text-right font-medium">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.map((row) => (
                    <tr
                      key={row.year + "-" + row.provider}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4 font-medium">{row.year}</td>
                      <td className="py-4 text-sm capitalize">
                        {row.provider}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.interestCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.dividendsCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.salesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.purchasesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.feesCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.depositsCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.withdrawalsCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.principalInvestedCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {money(row.principalReturnedCzk)}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {row.transactionCount.toLocaleString("cs-CZ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádná data.</p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
        <p className="text-sm font-semibold">Daňová interpretace</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          FinanceOS zde pouze agreguje evidovaná data. Neurčuje, co je podle
          aktuální české legislativy zdanitelné, osvobozené nebo jaký náklad lze
          uplatnit. U prodejů navíc samotné sales proceeds nejsou totéž co
          daňový zisk.
        </p>
      </div>
    </main>
  );
}
