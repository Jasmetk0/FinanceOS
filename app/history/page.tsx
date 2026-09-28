import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getHistoryData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function LineChart({
  data,
  valueKey,
  emptyText,
}: {
  data: Array<Record<string, string | number>>;
  valueKey: string;
  emptyText: string;
}) {
  if (data.length < 2) {
    return (
      <div className="grid h-52 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
        <p className="max-w-lg text-sm leading-6 text-[var(--muted)]">
          {emptyText}
        </p>
      </div>
    );
  }

  const values = data.map((item) => Number(item[valueKey] || 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = data
    .map((item, index) => {
      const x = (index / Math.max(1, data.length - 1)) * 100;
      const value = Number(item[valueKey] || 0);
      const y = 92 - ((value - min) / (max - min || 1)) * 78;
      return String(x) + "," + String(y);
    })
    .join(" ");

  const selected =
    data.length <= 5
      ? data
      : [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]];

  return (
    <div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-52 w-full overflow-visible"
      >
        {[20, 40, 60, 80].map((y) => (
          <line
            key={y}
            x1="0"
            x2="100"
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.4"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#69e3aa"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]">
        {selected.map((item) => (
          <span key={String(item.date)}>
            {new Date(String(item.date) + "T12:00:00").toLocaleDateString("cs-CZ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const data = getHistoryData();

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

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Skutečná hodnota portfolia"
          subtitle="Denní snapshoty vytvořené FinanceOS"
        >
          <LineChart
            data={data.snapshots}
            valueKey="valueCzk"
            emptyText="Po první synchronizaci začne FinanceOS ukládat denní hodnotu. Pro dobu před prvním snapshotem zatím neodhadujeme tržní cenu bez historických market dat."
          />
        </SectionCard>

        <SectionCard
          title="Známý vložený kapitál"
          subtitle="Kumulativní externí vklady mínus výběry"
        >
          <LineChart
            data={data.contributions}
            valueKey="cumulativeNetContributedCzk"
            emptyText="Provider zatím neposkytl dostatek záznamů vkladů/výběrů, nebo ještě nebyl proveden první sync."
          />
        </SectionCard>
      </section>

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
        <p className="text-sm font-semibold">Co ještě chybí k úplné historii</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          Transakce můžeme stáhnout hluboko do minulosti, ale přesnou hodnotu
          každé pozice v každém historickém dni potřebujeme dopočítat z
          historických cen instrumentů. Tento graf proto zatím zobrazuje jen
          skutečné snapshoty a známé cash flow, ne vymyšlenou zpětnou křivku.
        </p>
      </div>
    </main>
  );
}
