import Link from "next/link";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getDashboardData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function InvestmentsPage() {
  const dashboard = getDashboardData();
  const holdings = dashboard.holdings;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Live local data</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Investments
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Aktuální pozice napříč připojenými investičními účty.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Investovaná hodnota"
          value={dashboard.summary.investedCzk}
          format="currency"
        />
        <StatCard
          label="Nerealizovaný P/L"
          value={dashboard.summary.unrealizedPnlCzk}
          format="currency"
          positive={
            dashboard.summary.unrealizedPnlCzk === null
              ? undefined
              : dashboard.summary.unrealizedPnlCzk >= 0
          }
        />
        <StatCard label="Pozic" value={holdings.length} />
        <StatCard label="Účtů" value={dashboard.accounts.length} />
      </section>

      <div className="mt-4">
        <SectionCard
          title="Pozice"
          subtitle="U pozic bez dostupného cost basis může být P/L prázdné"
        >
          {holdings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                    <th className="pb-3 font-medium">Asset</th>
                    <th className="pb-3 font-medium">Account</th>
                    <th className="pb-3 font-medium">Class</th>
                    <th className="pb-3 text-right font-medium">Quantity</th>
                    <th className="pb-3 text-right font-medium">Value</th>
                    <th className="pb-3 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((holding) => (
                    <tr
                      key={holding.id}
                      className="border-b border-white/6 last:border-0"
                    >
                      <td className="py-4">
                        <Link
                          href={"/investments/" + encodeURIComponent(holding.symbol)}
                          prefetch={false}
                          className="font-semibold underline decoration-white/15 underline-offset-4 transition hover:decoration-[var(--accent)]"
                        >
                          {holding.symbol}
                        </Link>
                        <p className="mt-1 max-w-[280px] truncate text-xs text-[var(--muted)]">
                          {holding.name}
                        </p>
                      </td>
                      <td className="py-4 text-sm text-[var(--muted)]">
                        {holding.accountName}
                      </td>
                      <td className="py-4 text-sm capitalize text-[var(--muted)]">
                        {holding.assetClass}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {holding.quantity.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 8,
                        })}
                      </td>
                      <td className="py-4 text-right font-mono text-sm">
                        {holding.valueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </td>
                      <td
                        className={[
                          "py-4 text-right font-mono text-sm",
                          holding.pnlCzk === null
                            ? "text-[var(--muted)]"
                            : holding.pnlCzk >= 0
                              ? "text-[var(--accent)]"
                              : "text-[var(--danger)]",
                        ].join(" ")}
                      >
                        {holding.pnlCzk === null
                          ? "—"
                          : `${holding.pnlCzk >= 0 ? "+" : ""}${holding.pnlCzk.toLocaleString(
                              "cs-CZ",
                              { maximumFractionDigits: 0 },
                            )} Kč`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Připoj účet a spusť synchronizaci.
            </p>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
