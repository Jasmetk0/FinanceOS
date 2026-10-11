import { Pill, SectionCard, StatCard } from "@/components/ui";
import { getInsightsData } from "@/lib/server/analytics";
import { providerColor, providerLabel } from "@/lib/provider-visuals";
import { DataHealthExplorer } from "@/components/data-health-explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function InsightsPage() {
  const data = getInsightsData();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Analytika portfolia</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Analýzy
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
          label="Míra úspor · 3M"
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
            " aktivních propojení"
          }
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Kvalita dat" subtitle="Filtruj synchronizační chyby, nedoložené informace a koncentraci portfolia">
          <DataHealthExplorer warnings={data.warnings} />
        </SectionCard>

        <SectionCard title="Koncentrace podle platforem" subtitle="Podíl na celkovém majetku">
          {data.providerRanking.length ? (
            <div className="space-y-4">
              {data.providerRanking.map((item) => (
                <div key={item.provider}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: providerColor(item.provider) }}
                      />
                      {providerLabel(item.provider)}
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
                      className="h-full rounded-full"
                      style={{
                        width:
                          Math.max(0, Math.min(100, item.sharePct)).toString() + "%",
                        backgroundColor: providerColor(item.provider),
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
        <SectionCard title="Třídy aktiv" subtitle="Aktuálně naceněné pozice">
          {data.assetClassRanking.length ? (
            <div className="space-y-3">
              {data.assetClassRanking.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/6 bg-white/[.025] px-3 py-3"
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

        <SectionCard title="Koncentrace portfolia">
          {data.largestHolding ? (
            <div>
              <p className="text-sm text-[var(--muted)]">Největší pozice</p>
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
              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p className="text-sm text-[var(--muted)]">Tři největší pozice</p>
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
