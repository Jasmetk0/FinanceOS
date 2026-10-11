import Link from "next/link";
import { Pill, SectionCard, EmptyState } from "@/components/ui";
import { getAccounts } from "@/lib/server/analytics";
import { ManualBalancesManager } from "@/components/manual-balances-manager";
import { AccountsExplorer } from "@/components/accounts-explorer";
import { listManualBalances } from "@/lib/server/manual-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AccountsPage() {
  const accounts = getAccounts();
  const manualBalances = listManualBalances();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>{accounts.length} {accounts.length === 1 ? "účet" : accounts.length >= 2 && accounts.length <= 4 ? "účty" : "účtů"}</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Účty</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)] sm:text-base">
          Přehled platforem, doložené hodnoty a aktuálnost dat — vše můžeš filtrovat a seřadit.
        </p>
      </div>
      <div className="mt-5">
        <SectionCard
          title="Přehled platforem"
          subtitle="Kompaktní karty · tři vedle sebe na velké obrazovce"
          action={<Link href="/connections" prefetch={false} className="text-xs font-semibold text-[var(--accent)]">Správa propojení ↗</Link>}
        >
          {accounts.length ? (
            <AccountsExplorer accounts={accounts} />
          ) : (
            <div>
              <EmptyState title="Zatím nemáš připojený účet" description="Připoj Trading 212, Kraken nebo přidej podporovaný výpis. Údaje se ukládají lokálně." />
              <Link href="/connections" prefetch={false} className="finance-action finance-action-primary mx-auto mt-4 flex w-fit">Přejít na propojení →</Link>
            </div>
          )}
        </SectionCard>
      </div>
      <div className="mt-4">
        <SectionCard title="Ručně vedené zůstatky" subtitle="Oddělené od peněžních toků, aby se příjem nezapočítal do majetku dvakrát">
          <ManualBalancesManager initialBalances={manualBalances} />
        </SectionCard>
      </div>
    </main>
  );
}
