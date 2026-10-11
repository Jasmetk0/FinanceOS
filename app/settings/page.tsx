import { Pill, SectionCard } from "@/components/ui";
import { getFinanceOsDataDir } from "@/lib/server/paths";
import { RestoreBackup } from "@/components/restore-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const dataDir = getFinanceOsDataDir();

  return (
    <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
      <Pill>Lokální aplikace</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Nastavení
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
          Data patří tobě a zůstávají na tomto počítači.
        </p>
      </div>

      <div className="mt-7 space-y-4">
        <SectionCard title="Základní nastavení">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-4">
              <p className="text-xs text-[var(--muted)]">Základní měna</p>
              <p className="mt-2 font-medium">CZK</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-4">
              <p className="text-xs text-[var(--muted)]">Umístění lokálních dat</p>
              <p className="mt-2 break-all font-mono text-xs">{dataDir}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Export dat"
          subtitle="Export neobsahuje API klíče ani šifrovací klíč"
        >
          <div className="flex flex-wrap gap-3">
            <a
              href="/api/export"
              className="inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
            >
              Export všech dat (.json)
            </a>
            <a
              href="/api/export/transactions"
              className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
            >
              Export transakcí (.csv)
            </a>
            <a
              href="/api/export/ai-context"
              className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white"
            >
              Export kontextu pro AI (.json)
            </a>
          </div>
        </SectionCard>

        <SectionCard
          title="Obnova ze zálohy"
          subtitle="Sloučení dat ze zálohy FinanceOS (JSON); existující údaje se nepřepisují naslepo"
        >
          <RestoreBackup />
        </SectionCard>

        <SectionCard title="Automatizace">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-4">
              <p className="text-xs text-[var(--muted)]">Synchronizace na pozadí</p>
              <p className="mt-2 font-medium">Každých 15 minut</p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Běží i po zavření prohlížeče, dokud běží FinanceOS server.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-white/[.025] p-4">
              <p className="text-xs text-[var(--muted)]">Automatická záloha</p>
              <p className="mt-2 font-medium">Denně · uchování 60 dní</p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                JSON backup bez API secrets v lokálním data adresáři.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Úložiště a zabezpečení">
          <div className="space-y-3 text-sm leading-6 text-[var(--muted)]">
            <p>
              SQLite databáze je mimo Git repozitář. Provider credentials jsou
              v databázi šifrovaně pomocí AES-256-GCM. Na Windows FinanceOS navíc
              chrání master key pomocí user-scoped DPAPI, pokud je na systému dostupné.
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
