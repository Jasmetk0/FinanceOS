import { Pill, SectionCard, StatCard } from "@/components/ui";
import { ManualTransactionForm } from "@/components/manual-transaction-form";
import { CashFlowCsvImporter } from "@/components/cashflow-csv-importer";
import { getCashFlowData } from "@/lib/server/analytics";
import { getTrading212CardStatus } from "@/lib/server/trading212-card";
import { InteractiveCashFlowChart } from "@/components/interactive-cash-flow-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CashFlowPage() {
  const data = getCashFlowData(18);
  const card = getTrading212CardStatus();
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

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
        <StatCard
          label="212 cashback"
          value={data.totals.cashbackCzk}
          format="currency"
          hint="Skutečně rozpoznaný cashback z karty"
          positive={data.totals.cashbackCzk > 0}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Měsíční cash flow"
          subtitle="Přesné částky po najetí, filtry období a čisté cash flow"
        >
          <InteractiveCashFlowChart months={data.months} />
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
                ["212 card cashback", lastMonth.cashbackCzk],
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

      {card.detected ? (
        <div className="mt-4">
          <SectionCard
            title="Trading 212 Card"
            subtitle="Card debit / refund / cashback rozpoznané z bohatšího Trading 212 CSV exportu"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Spending Pot", card.spendingPotCzk],
                ["Card spend", card.spendCzk],
                ["Refunds", card.refundsCzk],
                ["Cashback", card.cashbackCzk],
                ["Effective cashback", card.effectiveCashbackPct],
              ].map(([label, raw]) => {
                const value = raw === null ? null : Number(raw);
                return (
                  <div
                    key={String(label)}
                    className="rounded-2xl border border-white/7 bg-white/[0.02] p-4"
                  >
                    <p className="text-xs text-[var(--muted)]">{label}</p>
                    <p className="mt-2 font-mono text-lg font-semibold">
                      {value === null
                        ? "—"
                        : label === "Effective cashback"
                          ? value.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 2,
                            }) + " %"
                          : value.toLocaleString("cs-CZ", {
                              maximumFractionDigits: 0,
                            }) + " Kč"}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              FinanceOS nepředpokládá, že každý malý příchozí pohyb je cashback.
              Přesnou klasifikaci přebírá z Trading 212 history exportu, kde je
              rozlišeno Card debit, Card credit, Deposit a Spending cashback.
            </p>
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-4">
        <SectionCard
          title="Import cash-flow history"
          subtitle="Bankovní nebo vlastní CSV se signed amount sloupcem"
        >
          <CashFlowCsvImporter />
        </SectionCard>
      </div>
    </main>
  );
}
