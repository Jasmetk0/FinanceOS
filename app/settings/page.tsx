import { Pill, SectionCard } from "@/components/ui";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
      <Pill>Foundation</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Základní preference budoucího FinanceOS.
        </p>
      </div>

      <div className="mt-7 space-y-4">
        <SectionCard title="Reporting" subtitle="Tyto hodnoty zatím nejsou persistované">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-[var(--muted)]">Base currency</span>
              <select
                defaultValue="CZK"
                disabled
                className="mt-2 w-full rounded-xl border border-white/9 bg-white/[0.035] px-3 py-2.5 text-sm text-white disabled:opacity-80"
              >
                <option>CZK</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-[var(--muted)]">Portfolio timezone</span>
              <select
                defaultValue="Europe/Prague"
                disabled
                className="mt-2 w-full rounded-xl border border-white/9 bg-white/[0.035] px-3 py-2.5 text-sm text-white disabled:opacity-80"
              >
                <option>Europe/Prague</option>
              </select>
            </label>
          </div>
        </SectionCard>

        <SectionCard title="Sync" subtitle="Budoucí výchozí synchronizační politika">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/7 bg-white/[0.025] p-4">
            <div>
              <p className="text-sm font-medium">Automatic sync</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Inkrementální sync providerů a denní kontrolní snapshot.
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-[var(--muted)]">
              Not configured
            </span>
          </div>
        </SectionCard>

        <SectionCard title="Data ownership">
          <p className="text-sm leading-6 text-[var(--muted)]">
            FinanceOS bude navržen tak, aby šlo všechna vlastní data exportovat.
            Export, backup a restore přidáme před tím, než aplikace začne držet
            dlouhodobou finanční historii.
          </p>
        </SectionCard>
      </div>
    </main>
  );
}
