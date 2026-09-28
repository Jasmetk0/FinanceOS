import { getPlanData } from "@/lib/server/plan";
import { listJournalEntries } from "@/lib/server/journal";
import {
  getCashFlowData,
  getDashboardData,
  getInsightsData,
  getPerformanceData,
  getTransactions,
} from "@/lib/server/analytics";
import { reconstructPricedHoldingsHistory } from "@/lib/server/historical-prices";
import { getInvestownImportStatus } from "@/lib/server/investown";

export function buildAiContext() {
  const dashboard = getDashboardData();
  const performance = getPerformanceData();
  const cashFlow = getCashFlowData(24);
  const insights = getInsightsData();
  const plan = getPlanData();
  const journal = listJournalEntries(100);
  const transactions = getTransactions(250);
  const reconstructedHistory = reconstructPricedHoldingsHistory();
  const investown = getInvestownImportStatus();

  return {
    schema: "financeos-ai-context-v1",
    generatedAt: new Date().toISOString(),
    reportingCurrency: "CZK",
    portfolio: {
      summary: dashboard.summary,
      accounts: dashboard.accounts,
      holdings: dashboard.holdings,
      allocation: dashboard.allocation,
      snapshots: dashboard.portfolioSeries,
    },
    performance,
    cashFlow,
    plan,
    investmentJournal: journal,
    insights: {
      largestHolding: insights.largestHolding,
      topThreeSharePct: insights.topThreeSharePct,
      providerRanking: insights.providerRanking,
      assetClassRanking: insights.assetClassRanking,
      recentSavingsRate: insights.recentSavingsRate,
      dataWarnings: insights.warnings,
    },
    recentTransactions: transactions,
    providerCoverage: {
      investown,
    },
    historicalMarketData: {
      priceCoverage: reconstructedHistory.assetCoverage,
      reconstructedPricedPositions: reconstructedHistory.series.slice(-365),
      note:
        "Reconstructed priced positions exclude historical cash and assets without imported price coverage.",
    },
    privacy: {
      apiSecretsIncluded: false,
      encryptedCredentialsIncluded: false,
      providerRawJsonIncluded: false,
    },
    limitations: [
      "Historical mark-to-market values before the first FinanceOS snapshot may be incomplete.",
      "Performance metrics depend on provider/import coverage of deposits and withdrawals.",
      "Kraken asset-level cost basis can be incomplete when assets were transferred into the account.",
      "Investown history is reconstructed from the imported statement and is only as complete as that export.",
    ],
  };
}
