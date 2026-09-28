import { Pill, SectionCard, StatCard } from "@/components/ui";
import { ManualTransactionForm } from "@/components/manual-transaction-form";
import { getCashFlowData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function CashFlowChart({
  months,
}: {
  months: Array<{
    month: string;
    incomeCzk: number;
    giftsCzk: number;
    expensesCzk: number;
    interestCzk: number;
    netCzk: number;
  }>;
}) {
  if (!months.length) {
    return (
      <div className="grid h-52 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] text-center">
        <div className="px-6">
          <p className="text-sm font-medium">Zatím žádný cash-flow záznam</p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Přidej první výplatu, dar nebo výdaj přes Add manual transaction.
          </p>
        </div>
      </div>
    );
  }

  const max = Math.max(
    1,
    ...months.flatMap((item) => [
      item.incomeCzk + item.giftsCzk + item.interestCzk,
      item.expensesCzk,
    ]),
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[640px] items-end gap-3 pt-6">
        {months.map((item) => {
          const income = item.incomeCzk + item.giftsCzk + item.interestCzk;
          const incomeHeight = Math.max(2, (income / max) * 150);
          const expenseHeight = Math.max(2, (item.expensesCzk / max) * 150);

          return (
            <div key={item.month} className="flex min-w-[58px] flex-1 flex-col items-center">
              <div className="flex h-40 items-end gap-1.5">
                <div
                  className="w-4 rounded-t-md bg-[var(--accent)]"
                  style={{ height: incomeHeight }}
                  title={`Příjmy ${income.toLocaleString("cs-CZ")} Kč`}
                />
                <div
                  className="w-4 rounded-t-md bg-white/25"
                  style={{ height: expenseHeight }}
                  title={`Výdaje ${item.expensesCzk.toLocaleString("cs-CZ")} Kč`}
                />
              </div>
              <p className="mt-2 text-[10px] text-[var(--muted)]">
                {new Date(item.month + "-01T12:00:00").toLocaleDateString("cs-CZ", {
                  month: "short",
                  year: "2-digit",
                })}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex gap-5 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />
          Příjmy
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-white/25" />
          Výdaje
        </span>
      </div>
    </div>
  );
}

export default function CashFlowPage() {
  const data = getCashFlowData(18);
  const lastMonth = data.months.at(-1);

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Pill>Personal cash flow</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Cash Flow
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            Výplaty, dary, úroky a výdaje oddělené od investičních transferů.
          </p>
        </div>
        <ManualTransactionForm />
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Příjmy"
          value={data.totals.grossIncomeCzk}
          format="currency"
          hint="Ve zobrazeném období"
        />
        <StatCard
          label="Výdaje"
          value={data.totals.expensesCzk}
          format="currency"
          hint="Ve zobrazeném období"
        />
        <StatCard
          label="Čistá úspora"
          value={data.totals.netCzk}
          format="currency"
          hint="Příjmy mínus výdaje"
          positive={data.totals.netCzk >= 0}
        />
        <StatCard
          label="Savings rate"
          value={data.totals.savingsRate ?? 0}
          format="percent"
          hint={
            data.totals.savingsRate === null
              ? "Bez příjmů nelze spočítat"
              : "Za zobrazené období"
          }
          positive={(data.totals.savingsRate ?? 0) >= 0}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Měsíční cash flow"
          subtitle="Zeleně příjmy, šedě výdaje"
        >
          <CashFlowChart months={data.months} />
        </SectionCard>

        <SectionCard
          title="Poslední měsíc"
          subtitle={lastMonth ? lastMonth.month : "Bez dat"}
        >
          {lastMonth ? (
            <dl className="space-y-4">
              {[
                ["Salary / income", lastMonth.incomeCzk],
                ["Gifts", lastMonth.giftsCzk],
                ["Interest", lastMonth.interestCzk],
                ["Expenses", -lastMonth.expensesCzk],
                ["Net", lastMonth.netCzk],
              ].map(([label, raw]) => {
                const value = Number(raw);
                return (
                  <div key={String(label)} className="flex items-center justify-between gap-4">
                    <dt className="text-sm text-[var(--muted)]">{label}</dt>
                    <dd
                      className={[
                        "font-mono text-sm",
                        value > 0
                          ? "text-[var(--accent)]"
                          : value < 0
                            ? "text-[var(--danger)]"
                            : "",
                      ].join(" ")}
                    >
                      {value > 0 ? "+" : ""}
                      {value.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      Kč
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádná data.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Kategorie" subtitle="Součet absolutních částek">
          {data.categories.length ? (
            <div className="space-y-3">
              {data.categories.slice(0, 12).map((item, index) => (
                <div
                  key={`${item.category}-${item.kind}-${index}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{item.category}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      {item.kind}
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    {item.totalCzk.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    Kč
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádné kategorie.</p>
          )}
        </SectionCard>

        <SectionCard title="Zdroje příjmů" subtitle="Výplaty, dary, úroky">
          {data.sources.length ? (
            <div className="space-y-3">
              {data.sources.map((item) => (
                <div
                  key={item.source}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5"
                >
                  <p className="text-sm font-medium">{item.source}</p>
                  <p className="font-mono text-sm">
                    {item.totalCzk.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    Kč
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádné zdroje.</p>
          )}
        </SectionCard>
      </section>
    </main>
  );
}
