import Link from "next/link";
import { Pill, SectionCard, StatCard } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { getDashboardData } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function PortfolioChart({
  data,
}: {
  data: Array<{ date: string; valueCzk: number }>;
}) {
  if (data.length < 2) {
    return (
      <div className="grid h-52 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] text-center">
        <div className="px-6">
          <p className="text-sm font-medium">Historie se teprve začne tvořit</p>
          <p className="mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">
            FinanceOS ukládá denní snapshot při každé synchronizaci. Starší
            přesné tržní hodnoty doplní samostatný historical-price engine.
          </p>
        </div>
      </div>
    );
  }

  const values = data.map((item) => item.valueCzk);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = data
    .map((item, index) => {
      const x = (index / Math.max(1, data.length - 1)) * 100;
      const y = 94 - ((item.valueCzk - min) / (max - min || 1)) * 78;
      return `${x},${y}`;
    })
    .join(" ");

  const labels =
    data.length <= 6
      ? data
      : [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]];

  return (
    <div className="mt-4">
      <svg
        viewBox="0 0 100 100"
        className="h-52 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="Vývoj celkové hodnoty portfolia"
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
        <polygon points={`0,100 ${points} 100,100`} fill="url(#portfolioFill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#69e3aa"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        {labels.map((item) => (
          <span key={item.date}>
            {new Date(item.date + "T12:00:00").toLocaleDateString("cs-CZ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const data = getDashboardData();
  const hasConnections = data.connections.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Pill>{hasConnections ? "Live local data" : "Setup required"}</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Přehled majetku
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
            FinanceOS sjednocuje investiční účty, transakce a ručně zadané
            peněžní toky do jedné lokální databáze.
          </p>
        </div>
        <SyncButton />
      </div>

      {!hasConnections ? (
        <div className="mb-4 rounded-3xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-5">
          <p className="font-medium">Připoj první investiční účet</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            API klíče se ukládají pouze lokálně, šifrovaně. FinanceOS
            nepotřebuje oprávnění k obchodování ani k výběrům.
          </p>
          <Link
            href="/connections"
            className="mt-4 inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
          >
            Open Connections
          </Link>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Celkový majetek"
          value={data.summary.netWorthCzk}
          format="currency"
          hint="Součet aktuálně naceněných účtů"
        />
        <StatCard
          label="Investovaná hodnota"
          value={data.summary.investedCzk}
          format="currency"
          hint="Investiční část připojených účtů"
        />
        <StatCard
          label="Nerealizovaný P/L"
          value={data.summary.unrealizedPnlCzk}
          format="currency"
          hint="Kde ho provider poskytuje"
          positive={data.summary.unrealizedPnlCzk >= 0}
        />
        <StatCard
          label="Hotovost"
          value={data.summary.cashCzk}
          format="currency"
          hint="Cash a ruční cash-flow"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <SectionCard
          title="Vývoj kapitálu"
          subtitle="Denní snapshoty v CZK od prvního syncu"
        >
          <PortfolioChart data={data.portfolioSeries} />
        </SectionCard>

        <SectionCard title="Účty" subtitle="Aktuální hodnota podle zdroje">
          {data.accounts.length ? (
            <div className="space-y-5">
              {data.accounts.map((account) => {
                const share = data.summary.netWorthCzk
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (account.valueCzk / data.summary.netWorthCzk) * 100,
                      ),
                    )
                  : 0;
                return (
                  <div key={account.id}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{account.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {account.type} · {account.provider}
                        </p>
                      </div>
                      <p className="font-mono text-sm">
                        {account.valueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </p>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádná data.</p>
          )}
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Alokace"
          subtitle="Podle třídy aktuálně držených aktiv"
        >
          {data.allocation.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.allocation.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
                >
                  <span className="text-sm capitalize text-[var(--muted)]">
                    {item.label}
                  </span>
                  <p className="mt-2 text-xl font-semibold">
                    {item.valueCzk.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 0,
                    })}{" "}
                    Kč
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Zatím žádné pozice.</p>
          )}
        </SectionCard>

        <SectionCard title="Poslední aktivita" subtitle="Sjednocený ledger">
          {data.recentTransactions.length ? (
            <div className="divide-y divide-white/7">
              {data.recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {tx.symbol || tx.note || tx.kind}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {tx.accountName} ·{" "}
                      {new Date(tx.occurredAt).toLocaleDateString("cs-CZ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm">
                      {tx.amountCzk === null
                        ? `${tx.amount.toLocaleString("cs-CZ")} ${tx.currency}`
                        : `${tx.amountCzk.toLocaleString("cs-CZ", {
                            maximumFractionDigits: 0,
                          })} Kč`}
                    </p>
                    <p className="mt-1 text-xs uppercase text-[var(--muted)]">
                      {tx.kind}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím žádné transakce.
            </p>
          )}
        </SectionCard>
      </section>
    </main>
  );
}
