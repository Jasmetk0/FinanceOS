import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getInsightsData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function InsightsPage() {
  const data = getInsightsData();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Deterministic analytics</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Insights
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Automatické signály z tvých vlastních dat. Zatím bez AI a bez
          doporučení k nákupu nebo prodeji — pouze měřitelné změny, koncentrace
          a kvalita dat.
        </p>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Největší pozice"
          value={data.largestHolding?.sharePct ?? 0}
          format="percent"
          hint={data.largestHolding?.symbol || "Bez pozic"}
        />
        <StatCard
          label="Top 3 koncentrace"
          value={data.topThreeSharePct}
          format="percent"
          hint="Podíl tří největších pozic"
        />
        <StatCard
          label="Savings rate · 3M"
          value={data.recentSavingsRate ?? 0}
          format="percent"
          hint={
            data.recentSavingsRate === null
              ? "Bez dostatku cash-flow dat"
              : "Poslední tři měsíce"
          }
          positive={(data.recentSavingsRate ?? 0) >= 0}
        />
        <StatCard
          label="Historie"
          value={data.transactionCount}
          hint={
            String(data.snapshotCount) +
            " snapshotů · " +
            String(data.connectionCount) +
            " live connections"
          }
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Data health" subtitle="Co stojí za kontrolu">
          {data.warnings.length ? (
            <div className="space-y-3">
              {data.warnings.map((warning) => (
                <article
                  key={warning.id}
                  className={[
                    "rounded-2xl border p-4",
                    warning.severity === "error"
                      ? "border-[var(--danger)]/25 bg-[var(--danger)]/[0.04]"
                      : warning.severity === "warning"
                        ? "border-[var(--warning)]/25 bg-[var(--warning)]/[0.04]"
                        : "border-white/8 bg-white/[0.02]",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        "h-2 w-2 rounded-full",
                        warning.severity === "error"
                          ? "bg-[var(--danger)]"
                          : warning.severity === "warning"
                            ? "bg-[var(--warning)]"
                            : "bg-[var(--accent)]",
                      ].join(" ")}
                    />
                    <h2 className="text-sm font-semibold">{warning.title}</h2>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {warning.detail}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              FinanceOS momentálně nevidí žádný z definovaných problémů s daty.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Provider concentration" subtitle="Podíl na celkovém majetku">
          {data.providerRanking.length ? (
            <div className="space-y-4">
              {data.providerRanking.map((item) => (
                <div key={item.provider}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium capitalize">
                      {item.provider}
                    </span>
                    <span className="font-mono text-sm">
                      {item.sharePct.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      %
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width:
                          Math.max(0, Math.min(100, item.sharePct)).toString() + "%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádná data.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Asset classes" subtitle="Aktuálně naceněné pozice">
          {data.assetClassRanking.length ? (
            <div className="space-y-3">
              {data.assetClassRanking.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{item.label}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {item.valueCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      Kč
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    {item.sharePct.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    %
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádné pozice.</p>
          )}
        </SectionCard>

        <SectionCard title="Concentration snapshot">
          {data.largestHolding ? (
            <div>
              <p className="text-sm text-[var(--muted)]">Largest holding</p>
              <p className="mt-2 text-3xl font-semibold">
                {data.largestHolding.symbol}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {data.largestHolding.valueCzk.toLocaleString("cs-CZ", {
                  maximumFractionDigits: 0,
                })}{" "}
                Kč ·{" "}
                {data.largestHolding.sharePct.toLocaleString("cs-CZ", {
                  maximumFractionDigits: 1,
                })}{" "}
                %
              </p>
              <div className="mt-6 border-t border-white/7 pt-5">
                <p className="text-sm text-[var(--muted)]">Top 3 combined</p>
                <p className="mt-2 text-2xl font-semibold">
                  {data.topThreeSharePct.toLocaleString("cs-CZ", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  %
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Připoj nebo importuj investiční účet.
            </p>
          )}
        </SectionCard>
      </section>
    </main>
  );
}
