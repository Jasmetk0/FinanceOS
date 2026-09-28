import { Pill, SectionCard } from "@/components/ui";
import { getFinanceOsDataDir } from "@/lib/server/paths";
import { RestoreBackup } from "@/components/restore-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const dataDir = getFinanceOsDataDir();

  return (
    <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
      <Pill>Local-first</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Data patří tobě a zůstávají na tomto počítači.
        </p>
      </div>

      <div className="mt-7 space-y-4">
        <SectionCard title="Reporting">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
              <p className="text-xs text-[var(--muted)]">Base currency</p>
              <p className="mt-2 font-medium">CZK</p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
              <p className="text-xs text-[var(--muted)]">Local data directory</p>
              <p className="mt-2 break-all font-mono text-xs">{dataDir}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Data export"
          subtitle="Export neobsahuje API secrets ani encryption key"
        >
          <div className="flex flex-wrap gap-3">
            <a
              href="/api/export"
              className="inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
            >
              Export all data (.json)
            </a>
            <a
              href="/api/export/transactions"
              className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
            >
              Export transactions (.csv)
            </a>
          </div>
        </SectionCard>

        <SectionCard
          title="Restore backup"
          subtitle="Merge-only obnova dat z FinanceOS JSON exportu"
        >
          <RestoreBackup />
        </SectionCard>

        <SectionCard title="Automation">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
              <p className="text-xs text-[var(--muted)]">Background sync</p>
              <p className="mt-2 font-medium">Every 15 minutes</p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Běží i po zavření prohlížeče, dokud běží FinanceOS server.
              </p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4">
              <p className="text-xs text-[var(--muted)]">Automatic backup</p>
              <p className="mt-2 font-medium">Daily · 60-day retention</p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                JSON backup bez API secrets v lokálním data adresáři.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Storage & security">
          <div className="space-y-3 text-sm leading-6 text-[var(--muted)]">
            <p>
              SQLite databáze a náhodný 256bit master key jsou mimo Git repozitář.
              Provider credentials jsou v databázi pouze šifrovaně pomocí AES-256-GCM.
            </p>
            <p>
              Privátní API routy odmítají jiné hosty než localhost. Desktop launcher
              spouští FinanceOS jen na lokálním rozhraní.
            </p>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
