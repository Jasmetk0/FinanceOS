import { Pill } from "@/components/ui";
import { ConnectionsManager } from "@/components/connections-manager";
import { MintosImporter } from "@/components/mintos-importer";
import { getMintosImportStatus } from "@/lib/server/mintos";
import { InvestownImporter } from "@/components/investown-importer";
import { listConnections } from "@/lib/server/repository";
import { getInvestownImportStatus } from "@/lib/server/investown";
import { Trading212SpendingPot } from "@/components/trading212-spending-pot";
import { getTrading212SpendingPot } from "@/lib/server/trading212-auxiliary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  const connections = listConnections();
  const investownStatus = getInvestownImportStatus();
  const mintosStatus = getMintosImportStatus();
  const trading212SpendingPot = getTrading212SpendingPot();

  return (
    <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <Pill>Encrypted local credentials</Pill>
      <div className="mt-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Connections
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          Připoj read-only API. Credentials se po validaci zašifrují AES-256-GCM
          a uloží mimo Git repozitář do lokálního FinanceOS data adresáře.
        </p>
      </div>

      <div className="mt-7">
        <ConnectionsManager initialConnections={connections} />
      </div>

      <div className="mt-4">
        <Trading212SpendingPot initialValue={trading212SpendingPot} />
      </div>

      <div className="mt-4">
        <MintosImporter initialStatus={mintosStatus} />
      </div>

      <div className="mt-4">
        <InvestownImporter initialStatus={investownStatus} />
      </div>

      <div className="mt-4 rounded-3xl border border-[var(--accent)]/15 bg-[var(--accent)]/[0.035] p-5">
        <p className="text-sm font-semibold">Security baseline</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          U Trading 212 nepovoluj oprávnění k obchodování. U Kraken stačí query
          oprávnění pro funds, closed orders/trades a ledger. Nikdy nepovoluj
          withdrawals. FinanceOS secrets z API neposílá zpět do prohlížeče.
        </p>
      </div>
    </main>
  );
}
