import { getPlanData } from "@/lib/server/plan";
import {
  getCashFlowData,
  getDashboardData,
  getInsightsData,
  getPerformanceData,
  getTransactions,
} from "@/lib/server/analytics";

export function buildAiContext() {
  const dashboard = getDashboardData();
  const performance = getPerformanceData();
  const cashFlow = getCashFlowData(24);
  const insights = getInsightsData();
  const plan = getPlanData();
  const transactions = getTransactions(250);

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
    insights: {
      largestHolding: insights.largestHolding,
      topThreeSharePct: insights.topThreeSharePct,
      providerRanking: insights.providerRanking,
      assetClassRanking: insights.assetClassRanking,
      recentSavingsRate: insights.recentSavingsRate,
      dataWarnings: insights.warnings,
    },
    recentTransactions: transactions,
    privacy: {
      apiSecretsIncluded: false,
      encryptedCredentialsIncluded: false,
      providerRawJsonIncluded: false,
    },
    limitations: [
      "Historical mark-to-market values before the first FinanceOS snapshot may be incomplete.",
      "Performance metrics depend on provider/import coverage of deposits and withdrawals.",
      "Kraken asset-level cost basis can be incomplete when assets were transferred into the account.",
    ],
  };
}
