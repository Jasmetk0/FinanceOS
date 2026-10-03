import { Pill, SectionCard } from "@/components/ui";
import { ConnectionsManager } from "@/components/connections-manager";
import { MintosImporter } from "@/components/mintos-importer";
import { getMintosImportStatus } from "@/lib/server/mintos";
import { InvestownImporter } from "@/components/investown-importer";
import { listConnections } from "@/lib/server/repository";
import { getInvestownImportStatus } from "@/lib/server/investown";
import { getTrading212CardStatus } from "@/lib/server/trading212-card";
import { getPhantomStatus } from "@/lib/server/integrations/phantom";
import { getKrakenStatus } from "@/lib/server/integrations/kraken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  const connections = listConnections();
  const investownStatus = getInvestownImportStatus();
  const mintosStatus = getMintosImportStatus();
  const trading212Card = getTrading212CardStatus();
  const phantomStatus = getPhantomStatus();
  const krakenStatus = getKrakenStatus();

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

      {krakenStatus.connected ? (
        <div className="mt-4">
          <SectionCard
            title="Kraken Pro accounting coverage"
            subtitle="BalanceEx, Earn, wallet transfers, cost basis a API-key coverage"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Balance source</p>
                <p className="mt-2 text-sm font-semibold">
                  {krakenStatus.balanceSource || "čeká na nový sync"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  dostupné{" "}
                  {krakenStatus.availableValueCzk.toLocaleString("cs-CZ", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Kč · hold{" "}
                  {krakenStatus.heldValueCzk.toLocaleString("cs-CZ", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Kč
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Earn</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {krakenStatus.earn.available
                    ? krakenStatus.earn.allocatedCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      }) + " Kč"
                    : "N/A"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {krakenStatus.earn.activeStrategies.toLocaleString("cs-CZ")}{" "}
                  aktivních strategií · rewards{" "}
                  {krakenStatus.earn.rewardedCzk.toLocaleString("cs-CZ", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  Kč
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Wallet transfers</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {krakenStatus.funding.ownedTransfers.toLocaleString("cs-CZ")}{" "}
                  interních
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {krakenStatus.funding.unclassifiedTransfers.toLocaleString(
                    "cs-CZ",
                  )}{" "}
                  čeká na spárování
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Cost basis</p>
                <p className="mt-2 text-sm font-semibold">
                  {krakenStatus.costBasis.status || "čeká na rekonstrukci"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {krakenStatus.costBasis.incompleteSymbols.length.toLocaleString(
                    "cs-CZ",
                  )}{" "}
                  symbolů nekompletních
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">API historie</p>
                <p className="mt-2 text-sm font-semibold">
                  {krakenStatus.key.hasHistoryRestriction
                    ? "Omezená"
                    : "Bez známého omezení"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  Export API{" "}
                  {krakenStatus.key.exportDataEnabled ? "povoleno" : "nepovoleno"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">History audit</p>
                <p className="mt-2 text-sm font-semibold">
                  {krakenStatus.historyAudit.mode === "full"
                    ? "Plný scan"
                    : krakenStatus.historyAudit.mode === "incremental"
                      ? "Incremental"
                      : "čeká na nový sync"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  trades{" "}
                  {krakenStatus.historyAudit.trades.providerCount.toLocaleString(
                    "cs-CZ",
                  )}{" "}
                  · ledger{" "}
                  {krakenStatus.historyAudit.ledgers.providerCount.toLocaleString(
                    "cs-CZ",
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Margin</p>
                <p className="mt-2 text-sm font-semibold">
                  {krakenStatus.margin.queryEnabled
                    ? krakenStatus.margin.openPositions.toLocaleString("cs-CZ") +
                      " otevřených pozic"
                    : "Query není povolen"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {krakenStatus.margin.openPositions > 0
                    ? "Výkon účtu vyžaduje margin-aware accounting"
                    : "Spot accounting bez detekované otevřené margin pozice"}
                </p>
              </div>
            </div>

            {krakenStatus.key.hasHistoryRestriction ||
            krakenStatus.margin.openPositions > 0 ||
            krakenStatus.funding.unclassifiedTransfers > 0 ||
            krakenStatus.earn.error ||
            krakenStatus.funding.depositStatusError ||
            krakenStatus.funding.withdrawalStatusError ? (
              <div className="mt-4 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
                {krakenStatus.key.hasHistoryRestriction
                  ? "API key má časové omezení historie; starší P/L nemusí být kompletní. "
                  : ""}
                {krakenStatus.margin.openPositions > 0
                  ? "Kraken má otevřenou margin pozici; spot P/L zatím není kompletní model celého účtu. "
                  : ""}
                {krakenStatus.funding.unclassifiedTransfers > 0
                  ? krakenStatus.funding.unclassifiedTransfers.toLocaleString("cs-CZ") +
                    " crypto transferů zatím není bezpečně propojeno s vlastní peněženkou. "
                  : ""}
                {krakenStatus.earn.error
                  ? "Earn diagnostika: " + krakenStatus.earn.error + ". "
                  : ""}
                {krakenStatus.funding.depositStatusError
                  ? "Deposit enrichment: " +
                    krakenStatus.funding.depositStatusError +
                    ". "
                  : ""}
                {krakenStatus.funding.withdrawalStatusError
                  ? "Withdrawal enrichment: " +
                    krakenStatus.funding.withdrawalStatusError +
                    "."
                  : ""}
              </div>
            ) : (
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                Kraken v2 audit nenašel známé omezení API historie, otevřenou
                margin pozici ani nevyřešený wallet transfer.
              </p>
            )}
          </SectionCard>
        </div>
      ) : null}

      {phantomStatus.connected ? (
        <div className="mt-4">
          <SectionCard
            title="Phantom watch-only coverage"
            subtitle="Kontrola toho, co FinanceOS skutečně načetl z veřejné Solana adresy"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Status</p>
                <p className="mt-2 text-sm font-semibold">
                  {phantomStatus.status}
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Známá hodnota</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {phantomStatus.valueCzk === null
                    ? "—"
                    : phantomStatus.valueCzk.toLocaleString("cs-CZ", {
                        maximumFractionDigits: 0,
                      }) + " Kč"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Valuation</p>
                <p className="mt-2 text-sm font-semibold">
                  {phantomStatus.valuationStatus || "čeká na první sync"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {phantomStatus.unpricedTokenCount.toLocaleString("cs-CZ")}{" "}
                  tokenů bez ceny
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Kraken ↔ Phantom</p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {phantomStatus.matchedKrakenTransfers.toLocaleString("cs-CZ")}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {phantomStatus.matchedKrakenTransfersWithBookValue.toLocaleString(
                    "cs-CZ",
                  )}{" "}
                  s carried book value
                </p>
              </div>
              <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                <p className="text-xs text-[var(--muted)]">Chain scan</p>
                <p className="mt-2 text-sm font-semibold">
                  {phantomStatus.chainHistoryMatch.historyCompleteToOldestTransfer
                    ? "Pokryto"
                    : "Částečné"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {phantomStatus.chainHistoryMatch.signaturesScanned.toLocaleString(
                    "cs-CZ",
                  )}{" "}
                  relevantních signatures
                </p>
              </div>
            </div>
            {phantomStatus.lastError || phantomStatus.chainHistoryMatch.error ? (
              <p className="mt-4 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
                {phantomStatus.lastError ||
                  phantomStatus.chainHistoryMatch.error}
              </p>
            ) : null}
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-4">
        <SectionCard
          title="Trading 212 Card & Spending Pot"
          subtitle="Automatická klasifikace z provider historie + bohatšího Trading 212 exportu"
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
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {trading212Card.classificationSource === "rich_export"
                  ? "Merchant export"
                  : trading212Card.classificationSource === "validated_public_history"
                    ? "Ověřený fallback z cash historie"
                    : trading212Card.classificationSource === "mixed"
                      ? "Merchant export + ověřený fallback"
                      : "Bez card evidence"}
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
            WITHDRAW/DEPOSIT bez obchodníka. Když bohatší export funguje,
            FinanceOS z něj doplní Card debit, cashback, Merchant name a Merchant
            category. Pokud je export rate-limitovaný, účetní klasifikaci
            nezablokuje: cashback a card spend označí jen tam, kde se v provider
            historii opakovaně potvrdí přesný cashbackový vzorec. Merchant názvy
            se v fallback režimu nevymýšlí.
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
