import { Pill, SectionCard } from "@/components/ui";

const providers = [
  {
    name: "Trading 212",
    status: "Ready for adapter",
    description: "Portfolio, transakce a historie přes read-only API.",
  },
  {
    name: "Kraken",
    status: "Ready for adapter",
    description: "Crypto balances, trades a ledger přes read-only API credentials.",
  },
  {
    name: "Mintos",
    status: "Import planned",
    description: "Nejdřív přes export/import, později API pokud bude dostupné.",
  },
  {
    name: "Manual",
    status: "Planned",
    description: "Hotovost, příjmy, dary a další ručně evidované položky.",
  },
];

export default function ConnectionsPage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>No credentials stored</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Connections
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Tady budou bezpečně spravované read-only integrace. První UI verze záměrně
          ještě žádný API klíč nepřijímá ani neukládá.
        </p>
      </div>

      <div className="mt-7">
        <SectionCard
          title="Providers"
          subtitle="Každá platforma dostane vlastní adapter se stejným interním rozhraním"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {providers.map((provider) => (
              <article
                key={provider.name}
                className="rounded-2xl border border-white/7 bg-white/[0.025] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-semibold">{provider.name}</h2>
                  <span className="rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--warning)]">
                    {provider.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {provider.description}
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-5 w-full rounded-xl border border-white/9 bg-white/5 px-4 py-2.5 text-sm text-[var(--muted)] opacity-70"
                >
                  Connect · next phase
                </button>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 rounded-3xl border border-[var(--accent)]/15 bg-[var(--accent)]/[0.035] p-5">
        <p className="text-sm font-semibold">Security baseline</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          FinanceOS bude požadovat jen oprávnění potřebná ke čtení dat. Secrets
          nepůjdou do klientského JavaScriptu ani do Git repozitáře. Skutečný storage
          a šifrování implementujeme před prvním připojením reálného účtu.
        </p>
      </div>
    </main>
  );
}
