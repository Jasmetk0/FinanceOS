import { Pill, SectionCard } from "@/components/ui";
import { ConnectionsManager } from "@/components/connections-manager";
import { MintosImporter } from "@/components/mintos-importer";
import { getMintosImportStatus } from "@/lib/server/mintos";
import { InvestownImporter } from "@/components/investown-importer";
import { listConnections } from "@/lib/server/repository";
import { getInvestownImportStatus } from "@/lib/server/investown";
import { getTrading212CardStatus } from "@/lib/server/trading212-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  const connections = listConnections();
  const investownStatus = getInvestownImportStatus();
  const mintosStatus = getMintosImportStatus();
  const trading212Card = getTrading212CardStatus();

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
        <SectionCard
          title="Trading 212 Card & Spending Pot"
          subtitle="Automatická klasifikace karty přes Trading 212 history export"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
              <p className="text-xs text-[var(--muted)]">Card detected</p>
              <p className="mt-2 text-sm font-semibold">
                {trading212Card.detected ? "Ano" : "Zatím ne"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
              <p className="text-xs text-[var(--muted)]">Spending Pot</p>
              <p className="mt-2 font-mono text-sm font-semibold">
                {trading212Card.spendingPotCzk === null
                  ? "—"
                  : trading212Card.spendingPotCzk.toLocaleString("cs-CZ", {
                      maximumFractionDigits: 0,
                    }) + " Kč"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
              <p className="text-xs text-[var(--muted)]">Card rows</p>
              <p className="mt-2 font-mono text-sm font-semibold">
                {trading212Card.spendCount.toLocaleString("cs-CZ")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
              <p className="text-xs text-[var(--muted)]">Unresolved cash-ins</p>
              <p className="mt-2 font-mono text-sm font-semibold">
                {trading212Card.unresolvedCashInCount.toLocaleString("cs-CZ")}
              </p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {trading212Card.unresolvedCashInCzk.toLocaleString("cs-CZ", {
                  maximumFractionDigits: 0,
                })}{" "}
                Kč čeká na přesnou klasifikaci
              </p>
            </div>
            <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
              <p className="text-xs text-[var(--muted)]">Card export sync</p>
              <p className="mt-2 text-sm font-semibold">
                {trading212Card.pending
                  ? "Čeká na report #" + trading212Card.pending.reportId
                  : trading212Card.lastError
                    ? "Chyba enrichmentu"
                    : trading212Card.lastRefreshAt
                      ? "Aktualizováno"
                      : "Backfill se spustí při syncu"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            Veřejný endpoint /history/transactions vrací jen základní pohyb
            WITHDRAW/DEPOSIT bez obchodníka. FinanceOS proto automaticky používá
            oficiální CSV export API jako enrichment vrstvu. Z něj získá Card
            debit, Spending cashback, Merchant name a Merchant category.
            {trading212Card.lastError
              ? " Poslední chyba: " +
                trading212Card.lastError +
                (trading212Card.retryAfter
                  ? " · další automatický pokus po " +
                    new Date(trading212Card.retryAfter).toLocaleString("cs-CZ")
                  : "")
              : ""}
          </p>
        </SectionCard>
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
          withdrawals. Phantom je připojen pouze watch-only přes veřejnou Solana
          adresu — seed phrase ani private key do FinanceOS nikdy nezadávej.
          FinanceOS secrets z API neposílá zpět do prohlížeče.
        </p>
      </div>
    </main>
  );
}
