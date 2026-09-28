import { Pill, SectionCard, StatCard } from "@/components/ui";
import { demoHoldings, summary } from "@/lib/mock-data";

export default function InvestmentsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Demo data</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Investments
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Pozice, alokace a výkonnost napříč připojenými investičními účty.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Investováno"
          value={summary.investedCzk}
          format="currency"
          hint="Ukázková čistá vložená částka"
        />
        <StatCard
          label="Nerealizovaný P/L"
          value={summary.unrealizedPnlCzk}
          format="currency"
          hint="+11,8 %"
          positive
        />
        <StatCard label="Pozic" value={demoHoldings.length} />
        <StatCard label="Základní měna" value={1} hint="CZK" />
      </section>

      <div className="mt-4">
        <SectionCard
          title="Pozice"
          subtitle="Ukázková data — skutečné pozice přijdou až z provider adapterů"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                  <th className="pb-3 font-medium">Asset</th>
                  <th className="pb-3 font-medium">Class</th>
                  <th className="pb-3 text-right font-medium">Value</th>
                  <th className="pb-3 text-right font-medium">Weight</th>
                  <th className="pb-3 text-right font-medium">P/L</th>
                </tr>
              </thead>
              <tbody>
                {demoHoldings.map((holding) => (
                  <tr key={holding.symbol} className="border-b border-white/6 last:border-0">
                    <td className="py-4">
                      <p className="font-semibold">{holding.symbol}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {holding.name}
                      </p>
                    </td>
                    <td className="py-4 text-sm text-[var(--muted)]">
                      {holding.assetClass}
                    </td>
                    <td className="py-4 text-right font-mono text-sm">
                      {holding.valueCzk.toLocaleString("cs-CZ")} Kč
                    </td>
                    <td className="py-4 text-right font-mono text-sm">
                      {holding.weight.toLocaleString("cs-CZ")} %
                    </td>
                    <td
                      className={[
                        "py-4 text-right font-mono text-sm",
                        holding.pnlCzk >= 0
                          ? "text-[var(--accent)]"
                          : "text-[var(--danger)]",
                      ].join(" ")}
                    >
                      {holding.pnlCzk >= 0 ? "+" : ""}
                      {holding.pnlCzk.toLocaleString("cs-CZ")} Kč
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
