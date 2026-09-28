import { StatCard, SectionCard, Pill } from "@/components/ui";
import {
  allocation,
  platformBalances,
  portfolioSeries,
  recentTransactions,
  summary,
} from "@/lib/mock-data";

function PortfolioChart() {
  const points = portfolioSeries
    .map((item, index) => {
      const x = (index / (portfolioSeries.length - 1)) * 100;
      const values = portfolioSeries.map((point) => point.valueCzk);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const y = 94 - ((item.valueCzk - min) / (max - min || 1)) * 78;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="mt-4">
      <svg
        viewBox="0 0 100 100"
        className="h-52 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="Ukázkový graf historického vývoje portfolia"
      >
        <defs>
          <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#69e3aa" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#69e3aa" stopOpacity="0" />
          </linearGradient>
        </defs>
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
        <polygon
          points={`0,100 ${points} 100,100`}
          fill="url(#portfolioFill)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#69e3aa"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        {portfolioSeries.map((item) => (
          <span key={item.label}>{item.label}</span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Pill>Demo data</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Přehled majetku
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            První UI kostra FinanceOS. Čísla níže jsou pouze ukázková a nejsou
            připojena k žádnému účtu.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm text-[var(--muted)]">Poslední synchronizace</p>
          <p className="mt-1 text-sm font-medium">Zatím nepřipojeno</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Celkový majetek"
          value={summary.netWorthCzk}
          format="currency"
          hint="+2,8 % tento měsíc"
          positive
        />
        <StatCard
          label="Investováno"
          value={summary.investedCzk}
          format="currency"
          hint="Čisté vklady do investic"
        />
        <StatCard
          label="Nerealizovaný P/L"
          value={summary.unrealizedPnlCzk}
          format="currency"
          hint="+11,8 %"
          positive
        />
        <StatCard
          label="Hotovost"
          value={summary.cashCzk}
          format="currency"
          hint="Napříč účty"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Vývoj kapitálu"
          subtitle="Ukázková denní hodnota všech aktiv v CZK"
        >
          <PortfolioChart />
        </SectionCard>

        <SectionCard title="Platformy" subtitle="Ukázkové rozložení majetku">
          <div className="space-y-5">
            {platformBalances.map((platform) => (
              <div key={platform.name}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{platform.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {platform.kind}
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    {platform.valueCzk.toLocaleString("cs-CZ")} Kč
                  </p>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${platform.share}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard title="Alokace" subtitle="Ukázkové rozdělení podle třídy aktiv">
          <div className="grid gap-3 sm:grid-cols-2">
            {allocation.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--muted)]">{item.label}</span>
                  <span className="font-mono text-sm">{item.share}%</span>
                </div>
                <p className="mt-2 text-xl font-semibold">
                  {item.valueCzk.toLocaleString("cs-CZ")} Kč
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Poslední aktivita" subtitle="Ukázkové transakce">
          <div className="divide-y divide-white/7">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tx.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {tx.account} · {tx.date}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{tx.amount}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{tx.kind}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </main>
  );
}
