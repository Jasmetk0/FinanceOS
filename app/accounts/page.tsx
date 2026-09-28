import { Pill, SectionCard } from "@/components/ui";
import { getAccounts } from "@/lib/server/analytics";
import { ManualBalancesManager } from "@/components/manual-balances-manager";
import { listManualBalances } from "@/lib/server/manual-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AccountsPage() {
  const accounts = getAccounts();
  const manualBalances = listManualBalances();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>{accounts.length} accounts</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Accounts
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Jednotný pohled na broker, crypto a ruční finance.
        </p>
      </div>

      <div className="mt-7">
        <SectionCard title="Účty" subtitle="Hodnoty přepočtené do CZK">
          {accounts.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {accounts.map((account) => (
                <article
                  key={account.id}
                  className="rounded-2xl border border-white/7 bg-white/[0.025] p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold">{account.name}</h2>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {account.provider} · {account.type} · {account.currency}
                      </p>
                    </div>
                    <p className="font-mono text-lg font-semibold">
                      {account.totalValueCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      Kč
                    </p>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-white/[0.025] p-3">
                      <dt className="text-xs text-[var(--muted)]">Cash</dt>
                      <dd className="mt-1 font-mono">
                        {account.cashValueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </dd>
                    </div>
                    <div className="rounded-xl bg-white/[0.025] p-3">
                      <dt className="text-xs text-[var(--muted)]">Investments</dt>
                      <dd className="mt-1 font-mono">
                        {account.investedValueCzk.toLocaleString("cs-CZ", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        Kč
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4 text-xs text-[var(--muted)]">
                    Updated {new Date(account.updatedAt).toLocaleString("cs-CZ")}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Zatím žádné účty. Připoj Trading 212 nebo Kraken.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Manual balances"
          subtitle="Oddělené od cash-flow journalu, aby se výplata nebo dar nepočítaly do net worth dvakrát"
        >
          <ManualBalancesManager initialBalances={manualBalances} />
        </SectionCard>
      </div>
    </main>
  );
}
