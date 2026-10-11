import { Pill, SectionCard, StatCard } from "@/components/ui";
import { PlanEditor } from "@/components/plan-editor";
import { getPlanData, PLAN_CLASSES } from "@/lib/server/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  etf: "ETF",
  stock: "Akcie",
  crypto: "Krypto",
  p2p: "P2P",
  cash: "Hotovost",
  other: "Ostatní",
};

export default function PlanPage() {
  const plan = getPlanData();
  const initialTargets = Object.fromEntries(
    plan.rows.map((row) => [row.assetClass, row.targetPct]),
  );

  const contributionByClass = new Map(
    plan.contributionPlan.map((item) => [item.assetClass, item.amountCzk]),
  );

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Vlastní investiční cíle</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Investiční plán
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Nastav si vlastní cílovou alokaci. FinanceOS ji pouze matematicky
          porovnává s realitou a ukazuje, jak by nové peníze přibližovaly
          portfolio k tvému vlastnímu plánu.
        </p>
      </div>

      <div className="mt-5">
        <SectionCard
          title="Cílová alokace"
          subtitle="FinanceOS žádné cílové váhy nevolí za tebe"
        >
          <PlanEditor
            initialTargets={initialTargets}
            initialMonthlyContributionCzk={plan.monthlyContributionCzk}
          />
        </SectionCard>
      </div>

      <section className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Evidovaná hodnota"
          value={plan.totalValueCzk}
          format="currency"
          hint="Pozitivní investovatelná aktiva"
        />
        <StatCard
          label="Součet cílových vah"
          value={plan.targetSumPct}
          format="percent"
          hint={plan.active ? "Plán aktivní" : "Doplň cíle na 100 %"}
          positive={plan.active}
        />
        <StatCard
          label="Měsíční příspěvek"
          value={plan.monthlyContributionCzk}
          format="currency"
        />
        <StatCard
          label="Největší odchylka"
          value={
            plan.active
              ? Math.max(...plan.rows.map((row) => Math.abs(row.driftPct)), 0)
              : 0
          }
          format="percent"
          hint={plan.active ? "Aktuální proti cíli" : "Plán neaktivní"}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <SectionCard
          title="Skutečnost vs. cíl"
          subtitle={
            plan.active
              ? "Kladný drift = nad cílem, záporný drift = pod cílem"
              : "Odchylky se aktivují, až cílové váhy dosáhnou 100 %"
          }
        >
          <div className="finance-scrollbar overflow-x-auto rounded-[14px] border border-[var(--border)]">
            <table className="finance-data-table w-full min-w-[640px] text-left">
              <thead>
                <tr className="">
                  <th className="pb-3 font-medium">Třída</th>
                  <th className="pb-3 text-right font-medium">Hodnota</th>
                  <th className="pb-3 text-right font-medium">Aktuálně</th>
                  <th className="pb-3 text-right font-medium">Cíl</th>
                  <th className="pb-3 text-right font-medium">Odchylka</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr
                    key={row.assetClass}
                    className=""
                  >
                    <td className="py-4 font-medium">
                      {labels[row.assetClass] || row.assetClass}
                    </td>
                    <td className="py-4 text-right font-mono text-sm">
                      {row.currentValueCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      Kč
                    </td>
                    <td className="py-4 text-right font-mono text-sm">
                      {row.currentPct.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      %
                    </td>
                    <td className="py-4 text-right font-mono text-sm">
                      {row.targetPct.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      %
                    </td>
                    <td
                      className={[
                        "py-4 text-right font-mono text-sm",
                        !plan.active
                          ? "text-[var(--muted)]"
                          : Math.abs(row.driftPct) < 0.5
                            ? "text-[var(--accent)]"
                            : "text-[var(--warning)]",
                      ].join(" ")}
                    >
                      {plan.active
                        ? (row.driftPct > 0 ? "+" : "") +
                          row.driftPct.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 1,
                          }) +
                          " %"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="Rozdělení dalšího příspěvku"
          subtitle={
            plan.active && plan.monthlyContributionCzk > 0
              ? "Matematické rozdělení nových peněz směrem k tvým cílům"
              : "Nastav kompletní cíl a měsíční příspěvek"
          }
        >
          {plan.active && plan.monthlyContributionCzk > 0 ? (
            <div className="space-y-3">
              {PLAN_CLASSES.map((assetClass) => {
                const amount = contributionByClass.get(assetClass) ?? 0;
                return (
                  <div
                    key={assetClass}
                    className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">
                        {labels[assetClass]}
                      </p>
                      <p className="font-mono text-sm">
                        {amount.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{
                          width:
                            plan.monthlyContributionCzk > 0
                              ? Math.max(
                                  0,
                                  Math.min(
                                    100,
                                    (amount / plan.monthlyContributionCzk) * 100,
                                  ),
                                ).toString() + "%"
                              : "0%",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--muted)]">
              FinanceOS nebude odhadovat tvoji cílovou strategii. Nejdřív ji
              nastavíš ty; pak pouze spočítáme odchylky.
            </p>
          )}
        </SectionCard>
      </section>

      <div className="mt-4 rounded-3xl border border-[var(--border)] bg-white/[.025] p-5">
        <p className="text-sm font-semibold">Co tento výpočet znamená</p>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          Contribution plan neříká, které konkrétní akcie nebo ETF koupit.
          Pouze rozděluje tebou zadanou novou částku mezi tebou zvolené třídy
          aktiv tak, aby se aktuální alokace přibližovala k tvým cílovým vahám
          bez nutnosti prodávat existující pozice.
        </p>
      </div>
    </main>
  );
}
