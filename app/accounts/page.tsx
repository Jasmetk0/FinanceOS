import { EmptyState, Pill, SectionCard } from "@/components/ui";
import { demoAccounts } from "@/lib/mock-data";

export default function AccountsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Demo data</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Accounts
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Všechny finanční účty v jednom modelu bez ohledu na platformu.
        </p>
      </div>

      <div className="mt-7">
        <SectionCard title="Účty" subtitle="Zatím pouze návrh datové vrstvy">
          <div className="grid gap-3 md:grid-cols-2">
            {demoAccounts.map((account) => (
              <article
                key={account.id}
                className="rounded-2xl border border-white/7 bg-white/[0.025] p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{account.name}</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">{account.type}</p>
                  </div>
                  <span className="rounded-full border border-white/8 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                    {account.status}
                  </span>
                </div>
                <p className="mt-6 text-2xl font-semibold">
                  {account.valueCzk.toLocaleString("cs-CZ")} Kč
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">Ukázková hodnota</p>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-4">
        <EmptyState
          title="Skutečné účty zatím nejsou připojené"
          description="V dalším kroku vytvoříme zabezpečené provider adaptéry a uložiště credentials. Teprve potom se demo hodnoty nahradí skutečnými daty."
        />
      </div>
    </main>
  );
}
