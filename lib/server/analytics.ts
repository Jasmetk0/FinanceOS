import { getDb } from "@/lib/server/db";
import { listConnections } from "@/lib/server/repository";

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pnlIsKnown(status: unknown) {
  return status === "available" || status === "not_applicable";
}

function pnlValue(value: unknown, status: unknown): number | null {
  return pnlIsKnown(status) ? num(value) : null;
}

export type AccountDataFreshnessStatus =
  | "current"
  | "stale"
  | "manual"
  | "unknown";

export type AccountDataFreshnessSource =
  | "api_sync"
  | "statement"
  | "manual_override"
  | "manual"
  | "unknown";

export interface AccountDataFreshness {
  status: AccountDataFreshnessStatus;
  source: AccountDataFreshnessSource;
  coverageThrough: string | null;
  missingSince: string | null;
  updatedAt: string | null;
}

function parseRawObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function nextIsoDate(date: string): string {
  const parsed = new Date(date + "T00:00:00.000Z");
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function accountDataFreshness(row: {
  provider?: unknown;
  updated_at?: unknown;
  raw_json?: unknown;
}): AccountDataFreshness {
  const provider = String(row.provider || "");
  const updatedAt =
    row.updated_at === null || row.updated_at === undefined
      ? null
      : String(row.updated_at);
  const updatedDate = isoDate(updatedAt);
  const raw = parseRawObject(row.raw_json);

  if (provider === "manual") {
    return {
      status: "manual",
      source: "manual",
      coverageThrough: updatedDate,
      missingSince: null,
      updatedAt,
    };
  }

  let source: AccountDataFreshnessSource = "unknown";
  let coverageThrough: string | null = null;

  const balanceMode =
    typeof raw.balanceMode === "string" ? raw.balanceMode : "";
  const importMode =
    typeof raw.importMode === "string" ? raw.importMode : "";
  const statementLastAt =
    typeof raw.statementLastAt === "string"
      ? isoDate(raw.statementLastAt)
      : null;

  if (balanceMode === "manual-override" || importMode === "balance-only") {
    source = "manual_override";
    coverageThrough = updatedDate;
  } else if (
    statementLastAt &&
    (
      balanceMode === "derived-from-full-statement" ||
      provider === "investown" ||
      provider === "mintos"
    )
  ) {
    source = "statement";
    coverageThrough = statementLastAt;
  } else if (
    provider === "trading212" ||
    provider === "kraken" ||
    provider === "phantom"
  ) {
    source = "api_sync";
    coverageThrough = updatedDate;
  } else if (updatedDate) {
    source = "unknown";
    coverageThrough = updatedDate;
  }

  if (!coverageThrough) {
    return {
      status: "unknown",
      source,
      coverageThrough: null,
      missingSince: null,
      updatedAt,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (coverageThrough >= today) {
    return {
      status: "current",
      source,
      coverageThrough,
      missingSince: null,
      updatedAt,
    };
  }

  return {
    status: "stale",
    source,
    coverageThrough,
    missingSince: nextIsoDate(coverageThrough),
    updatedAt,
  };
}

function getCombinedSnapshotSeries(db: ReturnType<typeof getDb>) {
  const rows = db
    .prepare(`
      SELECT account_id, recorded_at, total_value_czk
      FROM snapshots
      WHERE COALESCE(quality, 'verified') != 'partial'
      ORDER BY recorded_at ASC, account_id ASC
    `)
    .all();

  const byDate = new Map<
    string,
    Array<{ accountId: string; valueCzk: number }>
  >();

  for (const row of rows) {
    const date = String(row.recorded_at);
    const list = byDate.get(date) ?? [];
    list.push({
      accountId: String(row.account_id),
      valueCzk: num(row.total_value_czk),
    });
    byDate.set(date, list);
  }

  const latestByAccount = new Map<string, number>();
  const series: Array<{ date: string; valueCzk: number }> = [];

  for (const date of [...byDate.keys()].sort()) {
    for (const item of byDate.get(date) ?? []) {
      latestByAccount.set(item.accountId, item.valueCzk);
    }

    series.push({
      date,
      valueCzk: [...latestByAccount.values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
    });
  }

  return series;
}

export interface PortfolioHistoryMetric {
  valueCzk: number | null;
  contributedCzk: number;
  externalRewardsCzk: number;
  capitalAttributedCzk: number;
  profitCzk: number | null;
  returnPct: number | null;
}

export interface PortfolioHistoryCoverage {
  complete: boolean;
  performanceComplete?: boolean;
  knownProviders: string[];
  missingProviders: string[];
}

export interface PortfolioHistoryPoint {
  date: string;
  total: PortfolioHistoryMetric;
  providers: Record<string, PortfolioHistoryMetric>;
  coverage: PortfolioHistoryCoverage;
}

function historyMetric(
  valueCzk: number | null,
  contributedCzk: number,
  externalRewardsCzk: number,
  capitalAttributedCzk: number,
  performanceComplete = true,
): PortfolioHistoryMetric {
  const profitCzk =
    valueCzk === null || !performanceComplete
      ? null
      : valueCzk - capitalAttributedCzk;

  return {
    valueCzk,
    contributedCzk,
    externalRewardsCzk,
    capitalAttributedCzk,
    profitCzk,
    returnPct:
      profitCzk === null || capitalAttributedCzk <= 0
        ? null
        : (profitCzk / capitalAttributedCzk) * 100,
  };
}

function getPortfolioHistoryChartData(db: ReturnType<typeof getDb>) {
  const snapshotRows = db
    .prepare(`
      SELECT
        s.recorded_at,
        s.account_id,
        s.total_value_czk,
        s.quality AS snapshot_quality,
        a.provider,
        a.type
      FROM snapshots s
      JOIN accounts a ON a.id = s.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
      ORDER BY s.recorded_at ASC, s.account_id ASC
    `)
    .all();

  const accountActivityRows = db
    .prepare(`
      SELECT
        a.id AS account_id,
        a.provider,
        a.updated_at,
        a.raw_json,
        (
          SELECT MIN(t.occurred_at)
          FROM transactions t
          WHERE t.account_id = a.id
        ) AS first_transaction,
        (
          SELECT MIN(s.recorded_at)
          FROM snapshots s
          WHERE s.account_id = a.id
        ) AS first_snapshot
      FROM accounts a
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
    `)
    .all();

  const accountActivity = accountActivityRows.map((row) => {
    const transactionDate = row.first_transaction
      ? String(row.first_transaction).slice(0, 10)
      : null;
    const snapshotDate = row.first_snapshot
      ? String(row.first_snapshot).slice(0, 10)
      : null;
    const startDate =
      transactionDate && snapshotDate
        ? transactionDate < snapshotDate
          ? transactionDate
          : snapshotDate
        : transactionDate || snapshotDate;

    const freshness = accountDataFreshness(row);

    return {
      accountId: String(row.account_id),
      provider: String(row.provider),
      startDate,
      valueThroughDate:
        freshness.status === "manual" ? null : freshness.coverageThrough,
    };
  });

  const unlinkedWalletRow = db
    .prepare(`
      SELECT
        MIN(substr(occurred_at, 1, 10)) AS first_gap,
        COUNT(*) AS count
      FROM transactions
      WHERE kind = 'transfer'
        AND flow_scope = 'unclassified'
    `)
    .get();
  const unlinkedWalletStart = unlinkedWalletRow?.first_gap
    ? String(unlinkedWalletRow.first_gap)
    : null;

  const unclassifiedPerformanceRows = db
    .prepare(`
      SELECT
        t.provider,
        MIN(substr(t.occurred_at, 1, 10)) AS first_gap
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND t.flow_scope = 'unclassified'
        AND t.kind IN ('deposit', 'withdrawal', 'transfer')
      GROUP BY t.provider
    `)
    .all();

  const performanceGapByProvider = new Map<string, string>();
  for (const row of unclassifiedPerformanceRows) {
    if (!row.first_gap) continue;
    performanceGapByProvider.set(
      String(row.provider),
      String(row.first_gap),
    );
  }
  const firstPerformanceGap =
    [...performanceGapByProvider.values()].sort()[0] ?? null;

  const flowRows = db
    .prepare(`
      SELECT
        substr(t.occurred_at, 1, 10) AS day,
        t.provider,
        t.kind,
        t.category,
        t.flow_scope,
        t.amount_czk,
        t.transfer_value_czk
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND (
          (
            t.amount_czk IS NOT NULL
            AND (
              (
                t.kind IN ('deposit', 'withdrawal')
                AND (
                  t.flow_scope = 'external'
                  OR (
                    t.flow_scope = 'legacy'
                    AND t.provider IN ('kraken', 'investown', 'mintos')
                  )
                )
              )
              OR (
                t.kind = 'income'
                AND t.category = 'card_cashback'
                AND t.flow_scope = 'external'
              )
            )
          )
          OR (
            t.kind = 'transfer'
            AND t.transfer_value_czk IS NOT NULL
          )
        )
      ORDER BY day ASC, t.occurred_at ASC
    `)
    .all();

  const providers = new Set<string>();
  const latestByAccount = new Map<
    string,
    { provider: string; valueCzk: number }
  >();
  const snapshotsByDate = new Map<
    string,
    Array<{
      accountId: string;
      provider: string;
      valueCzk: number;
      partial: boolean;
    }>
  >();

  for (const row of snapshotRows) {
    const date = String(row.recorded_at).slice(0, 10);
    const provider = String(row.provider);
    providers.add(provider);
    const list = snapshotsByDate.get(date) ?? [];
    list.push({
      accountId: String(row.account_id),
      provider,
      valueCzk: num(row.total_value_czk),
      partial: String(row.snapshot_quality || "verified") === "partial",
    });
    snapshotsByDate.set(date, list);
  }

  for (const row of flowRows) {
    providers.add(String(row.provider));
  }

  const flows = flowRows.map((row) => {
    const kind = String(row.kind);
    const category = String(row.category || "");
    const isReward = kind === "income" && category === "card_cashback";
    const ownContributionDelta =
      kind === "deposit"
        ? Math.abs(num(row.amount_czk))
        : kind === "withdrawal"
          ? -Math.abs(num(row.amount_czk))
          : 0;
    const rewardDelta = isReward ? num(row.amount_czk) : 0;
    const transferDelta =
      kind === "transfer" ? num(row.transfer_value_czk) : 0;

    return {
      date: String(row.day),
      provider: String(row.provider),
      ownContributionDelta,
      rewardDelta,
      transferDelta,
    };
  });

  const contributionByProvider = new Map<string, number>();
  const rewardsByProvider = new Map<string, number>();
  const transferAttributionByProvider = new Map<string, number>();
  let totalOwnContribution = 0;
  let totalExternalRewards = 0;
  const points: PortfolioHistoryPoint[] = [];
  let flowIndex = 0;

  for (const date of [...snapshotsByDate.keys()].sort()) {
    while (flowIndex < flows.length && flows[flowIndex].date <= date) {
      const flow = flows[flowIndex];
      contributionByProvider.set(
        flow.provider,
        (contributionByProvider.get(flow.provider) ?? 0) +
          flow.ownContributionDelta,
      );
      rewardsByProvider.set(
        flow.provider,
        (rewardsByProvider.get(flow.provider) ?? 0) + flow.rewardDelta,
      );
      transferAttributionByProvider.set(
        flow.provider,
        (transferAttributionByProvider.get(flow.provider) ?? 0) +
          flow.transferDelta,
      );
      totalOwnContribution += flow.ownContributionDelta;
      totalExternalRewards += flow.rewardDelta;
      flowIndex += 1;
    }

    for (const item of snapshotsByDate.get(date) ?? []) {
      if (item.partial) {
        // A partial snapshot is an explicit coverage gap, not a date that can
        // be skipped. Remove the account until a later complete snapshot
        // arrives so the SVG path breaks instead of drawing a fake straight
        // interpolation across an unknown historical interval.
        latestByAccount.delete(item.accountId);
        continue;
      }

      latestByAccount.set(item.accountId, {
        provider: item.provider,
        valueCzk: item.valueCzk,
      });
    }

    const providerValues = new Map<string, number>();
    for (const account of latestByAccount.values()) {
      providerValues.set(
        account.provider,
        (providerValues.get(account.provider) ?? 0) + account.valueCzk,
      );
    }

    const providerMetrics: Record<string, PortfolioHistoryMetric> = {};
    let totalValue = 0;
    const knownProviders: string[] = [];
    const missingProviders: string[] = [];

    for (const provider of [...providers].sort()) {
      const activeAccounts = accountActivity.filter(
        (item) =>
          item.provider === provider &&
          item.startDate !== null &&
          item.startDate <= date,
      );
      const providerShouldExist = activeAccounts.length > 0;
      const providerComplete =
        providerShouldExist &&
        activeAccounts.every(
          (item) =>
            latestByAccount.has(item.accountId) &&
            (item.valueThroughDate === null || date <= item.valueThroughDate),
        );
      const value =
        providerComplete && providerValues.has(provider)
          ? providerValues.get(provider) ?? 0
          : providerShouldExist
            ? null
            : null;
      const contributed = contributionByProvider.get(provider) ?? 0;
      const externalRewards = rewardsByProvider.get(provider) ?? 0;
      const transferAttribution =
        transferAttributionByProvider.get(provider) ?? 0;
      const capitalAttributed =
        contributed + externalRewards + transferAttribution;
      const providerPerformanceGap = performanceGapByProvider.get(provider);
      const providerPerformanceComplete =
        !providerPerformanceGap || date < providerPerformanceGap;
      providerMetrics[provider] = historyMetric(
        value,
        contributed,
        externalRewards,
        capitalAttributed,
        providerPerformanceComplete,
      );

      if (!providerShouldExist) continue;
      if (value === null) {
        missingProviders.push(provider);
      } else {
        knownProviders.push(provider);
        totalValue += value;
      }
    }

    const hasUnlinkedWalletGap =
      unlinkedWalletStart !== null && unlinkedWalletStart <= date;
    if (hasUnlinkedWalletGap) {
      missingProviders.push("unlinked-wallet");
    }

    const complete =
      missingProviders.length === 0 && knownProviders.length > 0;

    points.push({
      date,
      // Never present a partial sum of providers as the user's historical
      // total portfolio value. Until every provider known to be active on the
      // date has a valuation source, total value / P&L / return stay unknown.
      total: historyMetric(
        complete ? totalValue : null,
        totalOwnContribution,
        totalExternalRewards,
        totalOwnContribution + totalExternalRewards,
        !firstPerformanceGap || date < firstPerformanceGap,
      ),
      providers: providerMetrics,
      coverage: {
        complete,
        knownProviders,
        missingProviders,
      },
    });
  }

  const completePoints = points.filter((point) => point.coverage.complete);
  const coverageStatus: "complete" | "partial" | "insufficient" =
    completePoints.length === points.length && points.length > 0
      ? "complete"
      : completePoints.length > 0
        ? "partial"
        : "insufficient";

  return {
    providers: [...providers].sort(),
    points,
    coverage: {
      completePointCount: completePoints.length,
      totalPointCount: points.length,
      firstCompleteDate: completePoints[0]?.date ?? null,
      latestCompleteDate: completePoints.at(-1)?.date ?? null,
      status: coverageStatus,
    },
  };
}


export function getDashboardData() {
  const db = getDb();

  const totals =
    db.prepare(`
      SELECT
        COALESCE(SUM(total_value_czk), 0) AS net_worth,
        COALESCE(SUM(invested_value_czk), 0) AS invested,
        COALESCE(SUM(unrealized_pnl_czk), 0) AS unrealized_pnl,
        COALESCE(SUM(
          CASE
            WHEN type IN ('brokerage', 'crypto', 'p2p')
              AND unrealized_pnl_status NOT IN ('available', 'not_applicable')
            THEN 1 ELSE 0
          END
        ), 0) AS unavailable_unrealized_pnl,
        COALESCE(SUM(cash_value_czk), 0) AS cash,
        COALESCE(SUM(unclassified_value_czk), 0) AS unclassified
      FROM accounts
    `).get() ?? {};

  const accounts = db
    .prepare(`
      SELECT
        id, provider, name, type, currency, total_value_czk,
        unclassified_value_czk, reconciliation_difference,
        reconciliation_status, updated_at, raw_json
      FROM accounts
      WHERE total_value_czk != 0 OR provider != 'manual'
      ORDER BY total_value_czk DESC
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      name: String(row.name),
      type: String(row.type),
      currency: String(row.currency),
      valueCzk: num(row.total_value_czk),
      unclassifiedValueCzk: num(row.unclassified_value_czk),
      reconciliationDifferenceCzk: num(row.reconciliation_difference),
      reconciliationStatus: String(row.reconciliation_status || "unknown"),
      updatedAt: String(row.updated_at),
      dataFreshness: accountDataFreshness(row),
    }));

  const holdings = db
    .prepare(`
      SELECT
        h.id,
        a.symbol,
        a.name,
        a.asset_class,
        h.quantity,
        h.market_value_czk,
        h.unrealized_pnl_czk,
        ac.name AS account_name,
        ac.provider
      FROM holdings h
      JOIN assets a ON a.id = h.asset_id
      JOIN accounts ac ON ac.id = h.account_id
      ORDER BY h.market_value_czk DESC
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol),
      name: String(row.name),
      assetClass: String(row.asset_class),
      quantity: num(row.quantity),
      valueCzk: num(row.market_value_czk),
      pnlCzk:
        row.unrealized_pnl_czk === null ? null : num(row.unrealized_pnl_czk),
      accountName: String(row.account_name),
      provider: String(row.provider),
    }));

  const recentTransactions = db
    .prepare(`
      SELECT
        t.id,
        t.kind,
        t.occurred_at,
        t.currency,
        t.amount,
        t.amount_czk,
        t.note,
        t.category,
        t.source_label,
        t.flow_scope,
        t.transfer_value_czk,
        ac.name AS account_name,
        COALESCE(a.symbol, '') AS symbol
      FROM transactions t
      JOIN accounts ac ON ac.id = t.account_id
      LEFT JOIN assets a ON a.id = t.asset_id
      ORDER BY t.occurred_at DESC
      LIMIT 12
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      occurredAt: String(row.occurred_at),
      currency: String(row.currency),
      amount: num(row.amount),
      amountCzk: row.amount_czk === null ? null : num(row.amount_czk),
      note: row.note ? String(row.note) : null,
      category: row.category ? String(row.category) : null,
      sourceLabel: row.source_label ? String(row.source_label) : null,
      flowScope: String(row.flow_scope || "legacy"),
      transferValueCzk:
        row.transfer_value_czk === null || row.transfer_value_czk === undefined
          ? null
          : num(row.transfer_value_czk),
      accountName: String(row.account_name),
      symbol: String(row.symbol || ""),
    }));

  const portfolioSeries = getCombinedSnapshotSeries(db).slice(-730);

  const allocationMap = new Map<string, number>();
  for (const holding of holdings) {
    allocationMap.set(
      holding.assetClass,
      (allocationMap.get(holding.assetClass) ?? 0) + holding.valueCzk,
    );
  }

  // Current holdings already contain Kraken fiat balances as asset_class=cash.
  // Add account-level values only where they are not represented by holdings.
  const brokerageCashRow = db
    .prepare(
      "SELECT COALESCE(SUM(cash_value_czk), 0) AS total FROM accounts WHERE type = 'brokerage'",
    )
    .get();
  const brokerageCash = num(brokerageCashRow?.total);
  if (brokerageCash) {
    allocationMap.set(
      "cash",
      (allocationMap.get("cash") ?? 0) + brokerageCash,
    );
  }

  // P2P accounts can expose project-level holdings (Investown) or only
  // an account total (Mintos). Add only the account value that is not already
  // represented by holdings of any asset class, otherwise allocation would double count it.
  const p2pAccounts = db
    .prepare(
      "SELECT id, total_value_czk FROM accounts WHERE type = 'p2p'",
    )
    .all();

  let p2pResidual = 0;
  for (const account of p2pAccounts) {
    const represented = db
      .prepare(
        "SELECT COALESCE(SUM(h.market_value_czk), 0) AS total " +
          "FROM holdings h WHERE h.account_id = ?",
      )
      .get(String(account.id));

    p2pResidual += Math.max(
      0,
      num(account.total_value_czk) - num(represented?.total),
    );
  }

  if (p2pResidual) {
    allocationMap.set(
      "p2p",
      (allocationMap.get("p2p") ?? 0) + p2pResidual,
    );
  }

  const unclassifiedRow = db
    .prepare(
      "SELECT COALESCE(SUM(unclassified_value_czk), 0) AS total FROM accounts",
    )
    .get();
  const unclassifiedValue = num(unclassifiedRow?.total);
  if (Math.abs(unclassifiedValue) > 0.01) {
    allocationMap.set(
      "unclassified",
      (allocationMap.get("unclassified") ?? 0) + unclassifiedValue,
    );
  }

  const standaloneCashRow = db
    .prepare(
      "SELECT COALESCE(SUM(total_value_czk), 0) AS total FROM accounts " +
        "WHERE type = 'cash' " +
        "AND NOT (provider = 'manual' AND external_id = 'main')",
    )
    .get();
  const standaloneCash = Math.max(0, num(standaloneCashRow?.total));
  if (standaloneCash) {
    allocationMap.set(
      "cash",
      (allocationMap.get("cash") ?? 0) + standaloneCash,
    );
  }

  const manualAssetRow = db
    .prepare(
      "SELECT COALESCE(SUM(total_value_czk), 0) AS total FROM accounts WHERE provider = 'manual' AND type = 'asset' AND external_id LIKE 'balance:%'",
    )
    .get();
  const manualAssets = Math.max(0, num(manualAssetRow?.total));
  if (manualAssets) {
    allocationMap.set(
      "other",
      (allocationMap.get("other") ?? 0) + manualAssets,
    );
  }

  const allocation = [...allocationMap.entries()]
    .map(([label, valueCzk]) => ({ label, valueCzk }))
    .sort((a, b) => b.valueCzk - a.valueCzk);

  return {
    summary: {
      netWorthCzk: num(totals.net_worth),
      investedCzk: num(totals.invested),
      unrealizedPnlCzk:
        num(totals.unavailable_unrealized_pnl) > 0
          ? null
          : num(totals.unrealized_pnl),
      cashCzk: num(totals.cash),
      unclassifiedCzk: num(totals.unclassified),
    },
    accounts,
    holdings,
    recentTransactions,
    portfolioSeries,
    allocation,
    connections: listConnections(),
  };
}

export function getTransactions(limit = 500) {
  return getDb()
    .prepare(`
      SELECT
        t.id,
        t.provider,
        t.external_id,
        t.kind,
        t.occurred_at,
        t.currency,
        t.amount,
        t.amount_czk,
        t.quantity,
        t.price,
        t.fee,
        t.note,
        t.category,
        t.source_label,
        t.flow_scope,
        t.transfer_value_czk,
        ac.name AS account_name,
        COALESCE(a.symbol, '') AS symbol,
        COALESCE(a.name, '') AS asset_name
      FROM transactions t
      JOIN accounts ac ON ac.id = t.account_id
      LEFT JOIN assets a ON a.id = t.asset_id
      ORDER BY t.occurred_at DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      externalId: String(row.external_id),
      kind: String(row.kind),
      occurredAt: String(row.occurred_at),
      currency: String(row.currency),
      amount: num(row.amount),
      amountCzk: row.amount_czk === null ? null : num(row.amount_czk),
      quantity: row.quantity === null ? null : num(row.quantity),
      price: row.price === null ? null : num(row.price),
      fee: row.fee === null ? null : num(row.fee),
      note: row.note ? String(row.note) : null,
      category: row.category ? String(row.category) : null,
      sourceLabel: row.source_label ? String(row.source_label) : null,
      flowScope: String(row.flow_scope || "legacy"),
      transferValueCzk:
        row.transfer_value_czk === null || row.transfer_value_czk === undefined
          ? null
          : num(row.transfer_value_czk),
      accountName: String(row.account_name),
      symbol: String(row.symbol || ""),
      assetName: String(row.asset_name || ""),
    }));
}

export function getAccounts() {
  return getDb()
    .prepare(`
      SELECT
        id, provider, external_id, name, type, currency,
        cash_value_czk, invested_value_czk, total_value_czk,
        realized_pnl_czk, unrealized_pnl_czk, updated_at, raw_json
      FROM accounts
      ORDER BY total_value_czk DESC, name ASC
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      externalId: String(row.external_id),
      name: String(row.name),
      type: String(row.type),
      currency: String(row.currency),
      cashValueCzk: num(row.cash_value_czk),
      investedValueCzk: num(row.invested_value_czk),
      totalValueCzk: num(row.total_value_czk),
      realizedPnlCzk: num(row.realized_pnl_czk),
      unrealizedPnlCzk: num(row.unrealized_pnl_czk),
      updatedAt: String(row.updated_at),
      dataFreshness: accountDataFreshness(row),
    }));
}

export function getHoldings() {
  return getDashboardData().holdings;
}


export interface CashFlowMonth {
  month: string;
  incomeCzk: number;
  giftsCzk: number;
  expensesCzk: number;
  interestCzk: number;
  cashbackCzk: number;
  netCzk: number;
  savingsRate: number | null;
}

export function getCashFlowData(months = 18) {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT provider, kind, occurred_at, amount_czk, category, source_label
      FROM transactions
      WHERE amount_czk IS NOT NULL
        AND (
          (
            provider = 'manual'
            AND kind IN ('income', 'gift', 'expense', 'interest', 'fee')
          )
          OR (
            provider = 'trading212'
            AND (
              category LIKE 'card_spend:%'
              OR category LIKE 'card_refund:%'
              OR category IN ('card_cashback', 'card_fee')
            )
          )
        )
      ORDER BY occurred_at ASC
    `)
    .all();

  const byMonth = new Map<string, CashFlowMonth>();

  for (const row of rows) {
    const occurredAt = String(row.occurred_at);
    const month = occurredAt.slice(0, 7);
    if (!month) continue;

    const item =
      byMonth.get(month) ??
      {
        month,
        incomeCzk: 0,
        giftsCzk: 0,
        expensesCzk: 0,
        interestCzk: 0,
        cashbackCzk: 0,
        netCzk: 0,
        savingsRate: null,
      };

    const provider = String(row.provider);
    const kind = String(row.kind);
    const category = String(row.category || "");
    const amount = num(row.amount_czk);

    if (provider === "trading212") {
      if (category.startsWith("card_spend:")) {
        item.expensesCzk += Math.abs(amount);
      } else if (category.startsWith("card_refund:")) {
        item.expensesCzk -= Math.abs(amount);
      } else if (category === "card_cashback") {
        // Refunds can reverse previously awarded cashback. Preserve the sign
        // so FinanceOS reports net cashback actually retained.
        item.cashbackCzk += amount;
      } else if (category === "card_fee") {
        item.expensesCzk += Math.abs(amount);
      }
    } else {
      if (kind === "income") item.incomeCzk += Math.max(0, amount);
      if (kind === "gift") item.giftsCzk += Math.max(0, amount);
      if (kind === "interest") item.interestCzk += Math.max(0, amount);
      if (kind === "expense" || kind === "fee") {
        item.expensesCzk += Math.abs(amount);
      }
    }

    byMonth.set(month, item);
  }

  const allMonths = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-Math.max(1, months))
    .map((item) => {
      const grossIncome =
        item.incomeCzk + item.giftsCzk + item.interestCzk + item.cashbackCzk;
      const netCzk = grossIncome - item.expensesCzk;
      return {
        ...item,
        netCzk,
        savingsRate: grossIncome > 0 ? (netCzk / grossIncome) * 100 : null,
      };
    });

  const totals = allMonths.reduce(
    (acc, item) => {
      acc.incomeCzk += item.incomeCzk;
      acc.giftsCzk += item.giftsCzk;
      acc.expensesCzk += item.expensesCzk;
      acc.interestCzk += item.interestCzk;
      acc.cashbackCzk += item.cashbackCzk;
      acc.netCzk += item.netCzk;
      return acc;
    },
    {
      incomeCzk: 0,
      giftsCzk: 0,
      expensesCzk: 0,
      interestCzk: 0,
      cashbackCzk: 0,
      netCzk: 0,
    },
  );

  const categoryRows = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(category, ''), 'Uncategorized') AS category,
        kind,
        SUM(ABS(amount_czk)) AS total
      FROM transactions
      WHERE amount_czk IS NOT NULL
        AND (
          (
            provider = 'manual'
            AND kind IN ('income', 'gift', 'expense', 'interest', 'fee')
          )
          OR (
            provider = 'trading212'
            AND (
              category LIKE 'card_spend:%'
              OR category LIKE 'card_refund:%'
              OR category IN ('card_cashback', 'card_fee')
            )
          )
        )
      GROUP BY category, kind
      ORDER BY total DESC
    `)
    .all()
    .map((row) => {
      const category = String(row.category);
      const prettyCategory = category.startsWith("card_spend:")
        ? "Card · " +
          category
            .slice("card_spend:".length)
            .replace(/_/g, " ")
        : category.startsWith("card_refund:")
          ? "Card refund · " +
            category
              .slice("card_refund:".length)
              .replace(/_/g, " ")
          : category === "card_cashback"
            ? "Trading 212 card cashback"
            : category === "card_fee"
              ? "Trading 212 card fee"
              : category;
      return {
        category: prettyCategory,
        kind: String(row.kind),
        totalCzk: num(row.total),
      };
    });

  const sourceRows = db
    .prepare(`
      SELECT
        CASE
          WHEN provider = 'trading212' AND category = 'card_cashback'
            THEN 'Trading 212 cashback'
          ELSE COALESCE(NULLIF(source_label, ''), 'Unspecified')
        END AS source,
        SUM(CASE
          WHEN provider = 'trading212' AND category = 'card_cashback'
            THEN amount_czk
          WHEN provider = 'manual' AND kind IN ('income', 'gift', 'interest')
            THEN ABS(amount_czk)
          ELSE 0
        END) AS total
      FROM transactions
      WHERE amount_czk IS NOT NULL
        AND (
          provider = 'manual'
          OR (provider = 'trading212' AND category = 'card_cashback')
        )
      GROUP BY source
      HAVING total > 0
      ORDER BY total DESC
      LIMIT 20
    `)
    .all()
    .map((row) => ({
      source: String(row.source),
      totalCzk: num(row.total),
    }));

  const grossIncome =
    totals.incomeCzk +
    totals.giftsCzk +
    totals.interestCzk +
    totals.cashbackCzk;

  return {
    months: allMonths,
    totals: {
      ...totals,
      grossIncomeCzk: grossIncome,
      savingsRate:
        grossIncome > 0 ? (totals.netCzk / grossIncome) * 100 : null,
    },
    categories: categoryRows,
    sources: sourceRows,
  };
}


type DatedCashFlow = { date: Date; amount: number };

function xnpv(rate: number, flows: DatedCashFlow[]): number {
  if (!flows.length || rate <= -0.999999) return Number.NaN;
  const origin = flows[0].date.getTime();
  const yearMs = 365.2425 * 24 * 60 * 60 * 1000;

  return flows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - origin) / yearMs;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

function solveXirr(flows: DatedCashFlow[]): number | null {
  const valid = flows
    .filter(
      (flow) =>
        Number.isFinite(flow.amount) &&
        !Number.isNaN(flow.date.getTime()) &&
        flow.amount !== 0,
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (
    valid.length < 2 ||
    !valid.some((flow) => flow.amount < 0) ||
    !valid.some((flow) => flow.amount > 0)
  ) {
    return null;
  }

  let low = -0.9999;
  let high = 10;
  let lowValue = xnpv(low, valid);
  let highValue = xnpv(high, valid);

  for (let expansion = 0; expansion < 8 && lowValue * highValue > 0; expansion += 1) {
    high *= 5;
    highValue = xnpv(high, valid);
  }

  if (
    !Number.isFinite(lowValue) ||
    !Number.isFinite(highValue) ||
    lowValue * highValue > 0
  ) {
    return null;
  }

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const mid = (low + high) / 2;
    const value = xnpv(mid, valid);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 0.0001) return mid;

    if (lowValue * value <= 0) {
      high = mid;
      highValue = value;
    } else {
      low = mid;
      lowValue = value;
    }
  }

  return (low + high) / 2;
}

export function getPerformanceData() {
  const db = getDb();

  const accounts = db
    .prepare(`
      SELECT
        id, provider, name, type, total_value_czk,
        realized_pnl_czk, unrealized_pnl_czk,
        realized_pnl_status, unrealized_pnl_status, updated_at, raw_json
      FROM accounts
      WHERE type IN ('brokerage', 'crypto', 'p2p')
      ORDER BY total_value_czk DESC
    `)
    .all();

  const now = new Date();
  const accountRows = accounts.map((account) => {
    const id = String(account.id);
    const cashRows = db
      .prepare(`
        SELECT kind, category, occurred_at, amount_czk
        FROM transactions
        WHERE account_id = ?
          AND amount_czk IS NOT NULL
          AND (
            (
              kind IN ('deposit', 'withdrawal')
              AND (
                flow_scope = 'external'
                OR (
                  flow_scope = 'legacy'
                  AND provider IN ('kraken', 'investown', 'mintos')
                )
              )
            )
            OR (
              kind = 'income'
              AND category = 'card_cashback'
              AND flow_scope = 'external'
            )
          )
        ORDER BY occurred_at ASC
      `)
      .all(id);

    const transferRows = db
      .prepare(`
        SELECT occurred_at, transfer_value_czk, flow_scope, category
        FROM transactions
        WHERE account_id = ?
          AND kind = 'transfer'
          AND transfer_value_czk IS NOT NULL
        ORDER BY occurred_at ASC
      `)
      .all(id);

    const unresolvedAccountFlowRow = db
      .prepare(`
        SELECT
          COUNT(*) AS count,
          SUM(
            CASE
              WHEN kind IN ('deposit', 'withdrawal')
                AND amount_czk IS NOT NULL
              THEN ABS(amount_czk)
              ELSE 0
            END
          ) AS known_value_czk
        FROM transactions
        WHERE account_id = ?
          AND flow_scope = 'unclassified'
          AND (
            kind IN ('deposit', 'withdrawal')
            OR (
              kind = 'transfer'
              AND transfer_value_czk IS NULL
            )
          )
      `)
      .get(id);

    let deposits = 0;
    let withdrawals = 0;
    let externalRewards = 0;
    let transferIn = 0;
    let transferOut = 0;
    const flows: DatedCashFlow[] = [];

    for (const row of cashRows) {
      const kind = String(row.kind);
      const amount = Math.abs(num(row.amount_czk));
      const date = new Date(String(row.occurred_at));

      if (kind === "deposit") {
        deposits += amount;
        flows.push({ date, amount: -amount });
      } else if (kind === "withdrawal") {
        withdrawals += amount;
        flows.push({ date, amount });
      } else if (String(row.category || "") === "card_cashback") {
        const signedReward = num(row.amount_czk);
        externalRewards += signedReward;
        // Positive reward is cash entering the portfolio; a cashback reversal
        // is the opposite external flow.
        flows.push({ date, amount: -signedReward });
      }
    }

    for (const row of transferRows) {
      const value = num(row.transfer_value_czk);
      const date = new Date(String(row.occurred_at));
      if (value > 0) {
        transferIn += value;
        flows.push({ date, amount: -value });
      }
      if (value < 0) {
        transferOut += Math.abs(value);
        flows.push({ date, amount: Math.abs(value) });
      }
    }

    const currentValue = num(account.total_value_czk);
    const freshness = accountDataFreshness(account);
    const valueThroughDate = freshness.coverageThrough;
    const valueIsCurrent =
      freshness.status === "current" || freshness.status === "manual";
    if (currentValue > 0 && valueIsCurrent) {
      flows.push({ date: now, amount: currentValue });
    }

    // Per-account/provider capital attribution moves with owned-wallet
    // transfers. Portfolio-level contribution below remains external-only.
    const netContributed =
      deposits - withdrawals + transferIn - transferOut;
    const performanceExternalCapital =
      netContributed + externalRewards;
    const unclassifiedFlowCount = num(unresolvedAccountFlowRow?.count);
    const knownUnclassifiedFlowCzk = num(
      unresolvedAccountFlowRow?.known_value_czk,
    );
    const accountPerformanceComplete = unclassifiedFlowCount === 0;
    const estimatedProfit =
      accountPerformanceComplete && valueIsCurrent
        ? currentValue - performanceExternalCapital
        : null;
    const simpleReturn =
      accountPerformanceComplete &&
      estimatedProfit !== null &&
      performanceExternalCapital > 0
        ? (estimatedProfit / performanceExternalCapital) * 100
        : null;
    const xirr =
      accountPerformanceComplete && valueIsCurrent ? solveXirr(flows) : null;

    return {
      id,
      provider: String(account.provider),
      name: String(account.name),
      type: String(account.type),
      currentValueCzk: currentValue,
      depositsCzk: deposits,
      withdrawalsCzk: withdrawals,
      externalRewardsCzk: externalRewards,
      transferInCzk: transferIn,
      transferOutCzk: transferOut,
      netContributedCzk: netContributed,
      performanceExternalCapitalCzk: performanceExternalCapital,
      estimatedProfitCzk: estimatedProfit,
      valueThroughDate,
      valueIsCurrent,
      dataFreshness: freshness,
      simpleReturnPct: simpleReturn,
      xirrPct: xirr === null ? null : xirr * 100,
      realizedPnlCzk: pnlValue(
        account.realized_pnl_czk,
        account.realized_pnl_status,
      ),
      unrealizedPnlCzk: pnlValue(
        account.unrealized_pnl_czk,
        account.unrealized_pnl_status,
      ),
      realizedPnlStatus: String(account.realized_pnl_status || "unknown"),
      unrealizedPnlStatus: String(account.unrealized_pnl_status || "unknown"),
      externalFlowCount: cashRows.length,
      performanceStatus: accountPerformanceComplete ? "complete" : "partial",
      unclassifiedFlowCount,
      knownUnclassifiedFlowCzk,
    };
  });

  const totals = accountRows.reduce(
    (acc, account) => {
      acc.currentValueCzk += account.currentValueCzk;
      acc.depositsCzk += account.depositsCzk;
      acc.withdrawalsCzk += account.withdrawalsCzk;
      acc.externalRewardsCzk += account.externalRewardsCzk;
      if (!account.valueIsCurrent) acc.staleValuationCount += 1;
      if (account.realizedPnlCzk === null) {
        acc.realizedPnlUnknown += 1;
      } else {
        acc.realizedPnlCzk += account.realizedPnlCzk;
      }
      if (account.unrealizedPnlCzk === null) {
        acc.unrealizedPnlUnknown += 1;
      } else {
        acc.unrealizedPnlCzk += account.unrealizedPnlCzk;
      }
      return acc;
    },
    {
      currentValueCzk: 0,
      depositsCzk: 0,
      withdrawalsCzk: 0,
      cardSpendCzk: 0,
      cardRefundsCzk: 0,
      externalRewardsCzk: 0,
      realizedPnlCzk: 0,
      unrealizedPnlCzk: 0,
      realizedPnlUnknown: 0,
      unrealizedPnlUnknown: 0,
      staleValuationCount: 0,
    },
  );

  const realizedPnlCzk =
    totals.realizedPnlUnknown > 0 ? null : totals.realizedPnlCzk;
  const unrealizedPnlCzk =
    totals.unrealizedPnlUnknown > 0 ? null : totals.unrealizedPnlCzk;

  const portfolioGap = db
    .prepare(`
      SELECT
        COUNT(*) AS count,
        SUM(
          CASE
            WHEN t.kind = 'transfer'
              AND t.transfer_value_czk IS NOT NULL
            THEN ABS(t.transfer_value_czk)
            WHEN t.kind IN ('deposit', 'withdrawal')
              AND t.amount_czk IS NOT NULL
            THEN ABS(t.amount_czk)
            ELSE 0
          END
        ) AS known_value_czk,
        SUM(CASE WHEN t.kind = 'transfer' THEN 1 ELSE 0 END) AS wallet_count,
        SUM(
          CASE
            WHEN t.kind = 'transfer'
              AND t.transfer_value_czk < 0
            THEN ABS(t.transfer_value_czk)
            ELSE 0
          END
        ) AS known_wallet_book_value_out
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND t.flow_scope = 'unclassified'
        AND t.kind IN ('deposit', 'withdrawal', 'transfer')
    `)
    .get();
  const unclassifiedFlowCount = num(portfolioGap?.count);
  const knownUnclassifiedFlowCzk = num(portfolioGap?.known_value_czk);
  const unlinkedWalletTransferCount = num(portfolioGap?.wallet_count);
  const unlinkedWalletBookValueOutCzk = num(
    portfolioGap?.known_wallet_book_value_out,
  );
  const portfolioPerformanceComplete =
    unclassifiedFlowCount === 0 && totals.staleValuationCount === 0;

  const portfolioFlows: DatedCashFlow[] = db
    .prepare(`
      SELECT t.kind, t.category, t.occurred_at, t.amount_czk
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND t.amount_czk IS NOT NULL
        AND (
          (
            t.kind IN ('deposit', 'withdrawal')
            AND (
              t.flow_scope = 'external'
              OR (
                t.flow_scope = 'legacy'
                AND t.provider IN ('kraken', 'investown', 'mintos')
              )
            )
          )
          OR (
            t.kind = 'income'
            AND t.category = 'card_cashback'
            AND t.flow_scope = 'external'
          )
        )
      ORDER BY t.occurred_at ASC
    `)
    .all()
    .map((row) => ({
      date: new Date(String(row.occurred_at)),
      amount:
        String(row.kind) === "deposit"
          ? -Math.abs(num(row.amount_czk))
          : String(row.kind) === "withdrawal"
            ? Math.abs(num(row.amount_czk))
            : -num(row.amount_czk),
    }));

  if (totals.currentValueCzk > 0) {
    portfolioFlows.push({ date: now, amount: totals.currentValueCzk });
  }

  const netContributedCzk = totals.depositsCzk - totals.withdrawalsCzk;
  const performanceExternalCapitalCzk =
    netContributedCzk + totals.externalRewardsCzk;
  const estimatedProfitCzk = portfolioPerformanceComplete
    ? totals.currentValueCzk - performanceExternalCapitalCzk
    : null;

  return {
    accounts: accountRows,
    totals: {
      currentValueCzk: totals.currentValueCzk,
      depositsCzk: totals.depositsCzk,
      withdrawalsCzk: totals.withdrawalsCzk,
      externalRewardsCzk: totals.externalRewardsCzk,
      realizedPnlCzk,
      unrealizedPnlCzk,
      netContributedCzk,
      performanceExternalCapitalCzk,
      estimatedProfitCzk,
      simpleReturnPct:
        portfolioPerformanceComplete &&
        estimatedProfitCzk !== null &&
        performanceExternalCapitalCzk > 0
          ? (estimatedProfitCzk / performanceExternalCapitalCzk) * 100
          : null,
      xirrPct: portfolioPerformanceComplete
        ? (() => {
            const value = solveXirr(portfolioFlows);
            return value === null ? null : value * 100;
          })()
        : null,
      externalFlowCount: portfolioFlows.length
        ? Math.max(0, portfolioFlows.length - 1)
        : 0,
      performanceStatus: portfolioPerformanceComplete ? "complete" : "partial",
      unclassifiedFlowCount,
      knownUnclassifiedFlowCzk,
      staleValuationCount: totals.staleValuationCount,
      unlinkedWalletTransferCount,
      unlinkedWalletBookValueOutCzk,
    },
  };
}


export function getInsightsData() {
  const dashboard = getDashboardData();
  const cashFlow = getCashFlowData(6);
  const performance = getPerformanceData();
  const db = getDb();

  const holdings = [...dashboard.holdings].sort(
    (a, b) => b.valueCzk - a.valueCzk,
  );
  const investableTotal = holdings.reduce((sum, item) => sum + item.valueCzk, 0);
  const largestHolding = holdings[0] ?? null;
  const topThreeValue = holdings
    .slice(0, 3)
    .reduce((sum, item) => sum + item.valueCzk, 0);

  const providerTotals = new Map<string, number>();
  for (const account of dashboard.accounts) {
    providerTotals.set(
      account.provider,
      (providerTotals.get(account.provider) ?? 0) + account.valueCzk,
    );
  }
  const providerRanking = [...providerTotals.entries()]
    .map(([provider, valueCzk]) => ({
      provider,
      valueCzk,
      sharePct:
        dashboard.summary.netWorthCzk > 0
          ? (valueCzk / dashboard.summary.netWorthCzk) * 100
          : 0,
    }))
    .sort((a, b) => b.valueCzk - a.valueCzk);

  const assetClassRanking = dashboard.allocation.map((item) => ({
    ...item,
    sharePct:
      investableTotal > 0 ? (item.valueCzk / investableTotal) * 100 : 0,
  }));

  const transactionCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM transactions")
    .get();
  const snapshotCountRow = db.prepare("SELECT COUNT(*) AS count FROM snapshots").get();

  const lastThreeMonths = cashFlow.months.slice(-3);
  const lastThreeGross = lastThreeMonths.reduce(
    (sum, item) =>
      sum +
      item.incomeCzk +
      item.giftsCzk +
      item.interestCzk +
      item.cashbackCzk,
    0,
  );
  const lastThreeNet = lastThreeMonths.reduce(
    (sum, item) => sum + item.netCzk,
    0,
  );
  const recentSavingsRate =
    lastThreeGross > 0 ? (lastThreeNet / lastThreeGross) * 100 : null;

  const warnings: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    title: string;
    detail: string;
  }> = [];

  for (const connection of dashboard.connections) {
    if (connection.status === "error") {
      warnings.push({
        id: "connection-" + connection.provider,
        severity: "error",
        title: connection.label + " sync error",
        detail: connection.lastError || "Provider reported a synchronization error.",
      });
    }
  }

  for (const account of dashboard.accounts) {
    if (
      account.reconciliationStatus === "warning" &&
      Math.abs(account.reconciliationDifferenceCzk) > 0.01
    ) {
      warnings.push({
        id: "reconciliation-" + account.id,
        severity: "warning",
        title: "Nevysvětlená hodnota: " + account.name,
        detail:
          "Provider total se liší od známých pozic a hotovosti o " +
          Math.abs(account.reconciliationDifferenceCzk).toLocaleString("cs-CZ", {
            maximumFractionDigits: 0,
          }) +
          " Kč. FinanceOS rozdíl zachovává jako nezařazenou hodnotu místo hádání jeho původu.",
      });
    }
  }

  if (largestHolding && investableTotal > 0) {
    const share = (largestHolding.valueCzk / investableTotal) * 100;
    if (share >= 25) {
      warnings.push({
        id: "largest-holding",
        severity: "warning",
        title: "Velká koncentrace v jedné pozici",
        detail:
          largestHolding.symbol +
          " tvoří " +
          share.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) +
          " % aktuálně naceněných investičních pozic.",
      });
    }
  }

  if (performance.totals.performanceStatus === "partial") {
    warnings.push({
      id: "portfolio-performance-partial",
      severity: "warning",
      title: "Performance obsahuje neklasifikované cash flow",
      detail:
        "FinanceOS eviduje " +
        performance.totals.unclassifiedFlowCount +
        " investiční cash-flow záznamů, u kterých není bezpečně známé, zda jsou externí nebo interní. Celkový zisk a XIRR proto zůstávají prázdné.",
    });
  }

  for (const account of performance.accounts) {
    if (account.performanceStatus === "partial") {
      warnings.push({
        id: "flows-" + account.id,
        severity: "warning",
        title: "Neúplná performance historie: " + account.name,
        detail:
          "Účet má " +
          account.unclassifiedFlowCount +
          " nevyřešených cash-flow záznamů. FinanceOS proto nevydává odhad zisku ani XIRR za přesný.",
      });
    } else if (account.currentValueCzk > 0 && account.externalFlowCount === 0) {
      warnings.push({
        id: "flows-" + account.id,
        severity: "info",
        title: "Neúplná performance historie: " + account.name,
        detail:
          "FinanceOS zatím nevidí žádný vklad ani výběr, takže XIRR a zisk z cash-flow nelze spolehlivě vyhodnotit.",
      });
    }
  }

  if (
    dashboard.connections.length === 0 &&
    !dashboard.accounts.some(
      (a) => a.provider === "mintos" || a.provider === "investown",
    )
  ) {
    warnings.push({
      id: "no-connections",
      severity: "info",
      title: "Žádný live provider",
      detail:
        "Připoj Trading 212 nebo Kraken, případně importuj Mintos nebo Investown, aby dashboard začal používat reálná investiční data.",
    });
  }

  return {
    largestHolding:
      largestHolding && investableTotal > 0
        ? {
            ...largestHolding,
            sharePct: (largestHolding.valueCzk / investableTotal) * 100,
          }
        : null,
    topThreeSharePct:
      investableTotal > 0 ? (topThreeValue / investableTotal) * 100 : 0,
    providerRanking,
    assetClassRanking,
    recentSavingsRate,
    transactionCount: num(transactionCountRow?.count),
    snapshotCount: num(snapshotCountRow?.count),
    connectionCount: dashboard.connections.length,
    warnings,
  };
}



export function getAccountDetail(accountIdInput: string) {
  const db = getDb();
  const accountId = accountIdInput.trim();

  const account = db
    .prepare(`
      SELECT
        id, provider, external_id, name, type, currency,
        cash_value_czk, invested_value_czk, total_value_czk,
        realized_pnl_czk, unrealized_pnl_czk,
        realized_pnl_status, unrealized_pnl_status,
        unclassified_value_czk, reconciliation_difference,
        reconciliation_status, raw_json, updated_at
      FROM accounts
      WHERE id = ?
      LIMIT 1
    `)
    .get(accountId);

  if (!account) return null;

  const provider = String(account.provider);
  const freshness = accountDataFreshness(account);
  const performance = getPerformanceData().accounts.find(
    (item) => item.id === accountId,
  ) ?? null;

  const holdings = db
    .prepare(`
      SELECT
        h.id, h.asset_id, h.quantity, h.average_price, h.current_price,
        h.currency, h.market_value, h.market_value_czk,
        h.unrealized_pnl, h.unrealized_pnl_czk,
        a.symbol, a.name, a.asset_class
      FROM holdings h
      JOIN assets a ON a.id = h.asset_id
      WHERE h.account_id = ?
      ORDER BY h.market_value_czk DESC, a.symbol ASC
    `)
    .all(accountId)
    .map((row) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      symbol: String(row.symbol),
      name: String(row.name),
      assetClass: String(row.asset_class),
      quantity: num(row.quantity),
      averagePrice:
        row.average_price === null ? null : num(row.average_price),
      currentPrice:
        row.current_price === null ? null : num(row.current_price),
      currency: String(row.currency),
      marketValue: num(row.market_value),
      marketValueCzk: num(row.market_value_czk),
      unrealizedPnl:
        row.unrealized_pnl === null ? null : num(row.unrealized_pnl),
      unrealizedPnlCzk:
        row.unrealized_pnl_czk === null
          ? null
          : num(row.unrealized_pnl_czk),
    }));

  const transactions = db
    .prepare(`
      SELECT
        t.id, t.provider, t.external_id, t.kind, t.occurred_at,
        t.currency, t.amount, t.amount_czk, t.quantity, t.price, t.fee,
        t.note, t.category, t.source_label, t.flow_scope,
        t.transfer_value_czk,
        COALESCE(a.symbol, '') AS symbol,
        COALESCE(a.name, '') AS asset_name
      FROM transactions t
      LEFT JOIN assets a ON a.id = t.asset_id
      WHERE t.account_id = ?
      ORDER BY t.occurred_at DESC
      LIMIT 1000
    `)
    .all(accountId)
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      externalId: String(row.external_id),
      kind: String(row.kind),
      occurredAt: String(row.occurred_at),
      currency: String(row.currency),
      amount: num(row.amount),
      amountCzk: row.amount_czk === null ? null : num(row.amount_czk),
      quantity: row.quantity === null ? null : num(row.quantity),
      price: row.price === null ? null : num(row.price),
      fee: row.fee === null ? null : num(row.fee),
      note: row.note ? String(row.note) : null,
      category: row.category ? String(row.category) : null,
      sourceLabel: row.source_label ? String(row.source_label) : null,
      flowScope: String(row.flow_scope || "legacy"),
      transferValueCzk:
        row.transfer_value_czk === null || row.transfer_value_czk === undefined
          ? null
          : num(row.transfer_value_czk),
      accountName: String(account.name),
      symbol: String(row.symbol || ""),
      assetName: String(row.asset_name || ""),
    }));

  const transactionStats = db
    .prepare(`
      SELECT
        COUNT(*) AS count,
        MIN(occurred_at) AS first_at,
        MAX(occurred_at) AS last_at
      FROM transactions
      WHERE account_id = ?
    `)
    .get(accountId);

  const snapshotStats = db
    .prepare(`
      SELECT
        COUNT(*) AS count,
        MIN(recorded_at) AS first_at,
        MAX(recorded_at) AS last_at,
        SUM(CASE WHEN source = 'provider' THEN 1 ELSE 0 END) AS provider_count,
        SUM(CASE WHEN source = 'reconstructed' AND quality = 'reconstructed' THEN 1 ELSE 0 END) AS reconstructed_count,
        SUM(CASE WHEN quality = 'partial' THEN 1 ELSE 0 END) AS partial_count
      FROM snapshots
      WHERE account_id = ?
    `)
    .get(accountId);

  const kindRows = db
    .prepare(`
      SELECT kind, COUNT(*) AS count
      FROM transactions
      WHERE account_id = ?
      GROUP BY kind
      ORDER BY count DESC, kind ASC
    `)
    .all(accountId)
    .map((row) => ({
      kind: String(row.kind),
      count: num(row.count),
    }));

  const snapshotRows = db
    .prepare(`
      SELECT
        recorded_at, total_value_czk, cash_value_czk, invested_value_czk,
        source, quality
      FROM snapshots
      WHERE account_id = ?
      ORDER BY recorded_at ASC
    `)
    .all(accountId);

  const flowRows = db
    .prepare(`
      SELECT
        substr(occurred_at, 1, 10) AS day,
        kind, category, flow_scope, amount_czk, transfer_value_czk
      FROM transactions
      WHERE account_id = ?
        AND (
          (
            amount_czk IS NOT NULL
            AND (
              (
                kind IN ('deposit', 'withdrawal')
                AND (
                  flow_scope = 'external'
                  OR (
                    flow_scope = 'legacy'
                    AND provider IN ('kraken', 'investown', 'mintos')
                  )
                )
              )
              OR (
                kind = 'income'
                AND category = 'card_cashback'
                AND flow_scope = 'external'
              )
              OR kind IN ('dividend', 'interest', 'fee')
              OR (
                kind = 'income'
                AND COALESCE(category, '') != 'card_cashback'
              )
            )
          )
          OR (
            kind = 'transfer'
            AND transfer_value_czk IS NOT NULL
          )
        )
      ORDER BY day ASC, occurred_at ASC
    `)
    .all(accountId)
    .map((row) => {
      const kind = String(row.kind);
      const category = String(row.category || "");
      const amount = num(row.amount_czk);
      const transferValue = num(row.transfer_value_czk);
      return {
        date: String(row.day),
        depositCzk: kind === "deposit" ? Math.abs(amount) : 0,
        withdrawalCzk: kind === "withdrawal" ? Math.abs(amount) : 0,
        ownContributionDelta:
          kind === "deposit"
            ? Math.abs(amount)
            : kind === "withdrawal"
              ? -Math.abs(amount)
              : 0,
        rewardDelta:
          kind === "income" && category === "card_cashback"
            ? amount
            : 0,
        investmentIncomeCzk:
          kind === "dividend" ||
          kind === "interest" ||
          (kind === "income" && category !== "card_cashback")
            ? amount
            : 0,
        feesCzk: kind === "fee" ? Math.abs(amount) : 0,
        transferInCzk:
          kind === "transfer" && transferValue > 0 ? transferValue : 0,
        transferOutCzk:
          kind === "transfer" && transferValue < 0
            ? Math.abs(transferValue)
            : 0,
        transferDelta: kind === "transfer" ? transferValue : 0,
      };
    });

  const performanceGapRow = db
    .prepare(`
      SELECT MIN(substr(occurred_at, 1, 10)) AS first_gap
      FROM transactions
      WHERE account_id = ?
        AND flow_scope = 'unclassified'
        AND (
          kind IN ('deposit', 'withdrawal')
          OR (
            kind = 'transfer'
            AND transfer_value_czk IS NULL
          )
        )
    `)
    .get(accountId);
  const firstPerformanceGap = performanceGapRow?.first_gap
    ? String(performanceGapRow.first_gap)
    : null;

  const dailyFlowByDate = new Map<
    string,
    {
      depositsCzk: number;
      withdrawalsCzk: number;
      rewardsCzk: number;
      investmentIncomeCzk: number;
      feesCzk: number;
      transferInCzk: number;
      transferOutCzk: number;
    }
  >();
  for (const flow of flowRows) {
    const current = dailyFlowByDate.get(flow.date) ?? {
      depositsCzk: 0,
      withdrawalsCzk: 0,
      rewardsCzk: 0,
      investmentIncomeCzk: 0,
      feesCzk: 0,
      transferInCzk: 0,
      transferOutCzk: 0,
    };
    current.depositsCzk += flow.depositCzk;
    current.withdrawalsCzk += flow.withdrawalCzk;
    current.rewardsCzk += flow.rewardDelta;
    current.investmentIncomeCzk += flow.investmentIncomeCzk;
    current.feesCzk += flow.feesCzk;
    current.transferInCzk += flow.transferInCzk;
    current.transferOutCzk += flow.transferOutCzk;
    dailyFlowByDate.set(flow.date, current);
  }

  let ownContribution = 0;
  let externalRewards = 0;
  let transferAttribution = 0;
  let flowIndex = 0;
  const chartPoints: PortfolioHistoryPoint[] = [];
  const dailyHistory: Array<{
    date: string;
    valueCzk: number | null;
    cashCzk: number;
    investedCzk: number;
    depositsCzk: number;
    withdrawalsCzk: number;
    rewardsCzk: number;
    investmentIncomeCzk: number;
    feesCzk: number;
    transferInCzk: number;
    transferOutCzk: number;
    contributedCzk: number;
    capitalAttributedCzk: number;
    profitCzk: number | null;
    returnPct: number | null;
    source: string;
    quality: string;
  }> = [];

  for (const row of snapshotRows) {
    const date = String(row.recorded_at).slice(0, 10);
    while (flowIndex < flowRows.length && flowRows[flowIndex].date <= date) {
      const flow = flowRows[flowIndex];
      ownContribution += flow.ownContributionDelta;
      externalRewards += flow.rewardDelta;
      transferAttribution += flow.transferDelta;
      flowIndex += 1;
    }

    const snapshotQuality = String(row.quality || "verified");
    const snapshotComplete = snapshotQuality !== "partial";
    const valuationCovered =
      snapshotComplete &&
      (
        freshness.status === "manual" ||
        freshness.coverageThrough === null ||
        date <= freshness.coverageThrough
      );
    const performanceComplete =
      snapshotComplete &&
      (!firstPerformanceGap || date < firstPerformanceGap);
    const capitalAttributed =
      ownContribution + externalRewards + transferAttribution;
    const metric = historyMetric(
      valuationCovered ? num(row.total_value_czk) : null,
      ownContribution,
      externalRewards,
      capitalAttributed,
      performanceComplete,
    );

    chartPoints.push({
      date,
      total: metric,
      providers: { [provider]: metric },
      coverage: {
        complete: valuationCovered,
        performanceComplete,
        knownProviders: valuationCovered ? [provider] : [],
        missingProviders: valuationCovered ? [] : [provider],
      },
    });

    const dayFlow = dailyFlowByDate.get(date) ?? {
      depositsCzk: 0,
      withdrawalsCzk: 0,
      rewardsCzk: 0,
      investmentIncomeCzk: 0,
      feesCzk: 0,
      transferInCzk: 0,
      transferOutCzk: 0,
    };
    dailyHistory.push({
      date,
      valueCzk: metric.valueCzk,
      cashCzk: num(row.cash_value_czk),
      investedCzk: num(row.invested_value_czk),
      depositsCzk: dayFlow.depositsCzk,
      withdrawalsCzk: dayFlow.withdrawalsCzk,
      rewardsCzk: dayFlow.rewardsCzk,
      investmentIncomeCzk: dayFlow.investmentIncomeCzk,
      feesCzk: dayFlow.feesCzk,
      transferInCzk: dayFlow.transferInCzk,
      transferOutCzk: dayFlow.transferOutCzk,
      contributedCzk: metric.contributedCzk,
      capitalAttributedCzk: metric.capitalAttributedCzk,
      profitCzk: metric.profitCzk,
      returnPct: metric.returnPct,
      source: String(row.source || "provider"),
      quality: String(row.quality || "verified"),
    });
  }

  const completeChartPoints = chartPoints.filter(
    (point) => point.coverage.complete,
  );
  const chartCoverageStatus: "complete" | "partial" | "insufficient" =
    completeChartPoints.length === chartPoints.length && chartPoints.length > 0
      ? "complete"
      : completeChartPoints.length > 0
        ? "partial"
        : "insufficient";

  const raw = parseRawObject(account.raw_json);
  const rawCoverage =
    raw.coverage && typeof raw.coverage === "object"
      ? (raw.coverage as Record<string, unknown>)
      : {};
  const unknownTypes = Array.isArray(raw.unknownTypes)
    ? raw.unknownTypes.map(String)
    : Array.isArray(rawCoverage.unknownTypes)
      ? rawCoverage.unknownTypes.map(String)
      : [];
  const statementRows =
    raw.statementRows === null || raw.statementRows === undefined
      ? null
      : num(raw.statementRows);

  return {
    id: String(account.id),
    provider,
    externalId: String(account.external_id),
    name: String(account.name),
    type: String(account.type),
    currency: String(account.currency),
    cashValueCzk: num(account.cash_value_czk),
    investedValueCzk: num(account.invested_value_czk),
    totalValueCzk: num(account.total_value_czk),
    realizedPnlCzk: pnlValue(
      account.realized_pnl_czk,
      account.realized_pnl_status,
    ),
    unrealizedPnlCzk: pnlValue(
      account.unrealized_pnl_czk,
      account.unrealized_pnl_status,
    ),
    realizedPnlStatus: String(account.realized_pnl_status || "unknown"),
    unrealizedPnlStatus: String(account.unrealized_pnl_status || "unknown"),
    unclassifiedValueCzk: num(account.unclassified_value_czk),
    reconciliationDifferenceCzk: num(account.reconciliation_difference),
    reconciliationStatus: String(account.reconciliation_status || "unknown"),
    updatedAt: String(account.updated_at),
    dataFreshness: freshness,
    performance,
    holdings,
    transactions,
    dailyHistory,
    transactionKinds: kindRows,
    coverage: {
      transactionCount: num(transactionStats?.count),
      firstTransactionAt: transactionStats?.first_at
        ? String(transactionStats.first_at)
        : null,
      lastTransactionAt: transactionStats?.last_at
        ? String(transactionStats.last_at)
        : null,
      snapshotCount: num(snapshotStats?.count),
      providerSnapshotCount: num(snapshotStats?.provider_count),
      reconstructedSnapshotCount: num(snapshotStats?.reconstructed_count),
      partialSnapshotCount: num(snapshotStats?.partial_count),
      firstSnapshotAt: snapshotStats?.first_at
        ? String(snapshotStats.first_at)
        : null,
      lastSnapshotAt: snapshotStats?.last_at
        ? String(snapshotStats.last_at)
        : null,
      holdingCount: holdings.length,
    },
    sourceMetadata: {
      importMode:
        typeof raw.importMode === "string" ? raw.importMode : null,
      balanceMode:
        typeof raw.balanceMode === "string" ? raw.balanceMode : null,
      statementRows,
      lifetimeComplete:
        typeof raw.lifetimeComplete === "boolean"
          ? raw.lifetimeComplete
          : null,
      continuityOk:
        typeof raw.continuityOk === "boolean" ? raw.continuityOk : null,
      costBasisStatus:
        typeof raw.costBasisStatus === "string"
          ? raw.costBasisStatus
          : null,
      unknownTypes,
      historicalReconstruction:
        raw.financeOsHistoricalReconstruction &&
        typeof raw.financeOsHistoricalReconstruction === "object"
          ? (raw.financeOsHistoricalReconstruction as Record<string, unknown>)
          : null,
    },
    chart: {
      providers: [provider],
      points: chartPoints,
      coverage: {
        completePointCount: completeChartPoints.length,
        totalPointCount: chartPoints.length,
        firstCompleteDate: completeChartPoints[0]?.date ?? null,
        latestCompleteDate: completeChartPoints.at(-1)?.date ?? null,
        status: chartCoverageStatus,
      },
    },
  };
}


export function getAssetDetail(symbolInput: string) {
  const db = getDb();
  const symbol = symbolInput.trim().toUpperCase();

  const assets = db
    .prepare(`
      SELECT id, provider, external_id, symbol, name, asset_class, currency, raw_json
      FROM assets
      WHERE UPPER(symbol) = ?
      ORDER BY provider
    `)
    .all(symbol);

  if (!assets.length) return null;

  const assetIds = assets.map((asset) => String(asset.id));
  const placeholders = assetIds.map(() => "?").join(",");

  const holdings = db
    .prepare(`
      SELECT
        h.id,
        h.asset_id,
        h.quantity,
        h.average_price,
        h.current_price,
        h.currency,
        h.market_value,
        h.market_value_czk,
        h.unrealized_pnl,
        h.unrealized_pnl_czk,
        a.provider,
        a.name AS account_name
      FROM holdings h
      JOIN accounts a ON a.id = h.account_id
      WHERE h.asset_id IN (${placeholders})
      ORDER BY h.market_value_czk DESC
    `)
    .all(...assetIds)
    .map((row) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      provider: String(row.provider),
      accountName: String(row.account_name),
      quantity: num(row.quantity),
      averagePrice:
        row.average_price === null ? null : num(row.average_price),
      currentPrice:
        row.current_price === null ? null : num(row.current_price),
      currency: String(row.currency),
      marketValue: num(row.market_value),
      marketValueCzk: num(row.market_value_czk),
      unrealizedPnl:
        row.unrealized_pnl === null ? null : num(row.unrealized_pnl),
      unrealizedPnlCzk:
        row.unrealized_pnl_czk === null
          ? null
          : num(row.unrealized_pnl_czk),
    }));

  const transactions = db
    .prepare(`
      SELECT
        t.id,
        t.provider,
        t.kind,
        t.occurred_at,
        t.currency,
        t.amount,
        t.amount_czk,
        t.quantity,
        t.price,
        t.fee,
        t.note,
        a.name AS account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.asset_id IN (${placeholders})
      ORDER BY t.occurred_at DESC
    `)
    .all(...assetIds)
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      kind: String(row.kind),
      occurredAt: String(row.occurred_at),
      currency: String(row.currency),
      amount: num(row.amount),
      amountCzk: row.amount_czk === null ? null : num(row.amount_czk),
      quantity: row.quantity === null ? null : num(row.quantity),
      price: row.price === null ? null : num(row.price),
      fee: row.fee === null ? null : num(row.fee),
      note: row.note ? String(row.note) : null,
      accountName: String(row.account_name),
    }));

  const summary = transactions.reduce(
    (acc, tx) => {
      const amount = tx.amountCzk;
      if (amount === null) return acc;
      if (tx.kind === "buy") acc.buysCzk += Math.abs(amount);
      if (tx.kind === "sell") acc.sellsCzk += Math.abs(amount);
      if (tx.kind === "dividend") acc.dividendsCzk += Math.max(0, amount);
      if (tx.kind === "interest") acc.interestCzk += Math.max(0, amount);
      if (tx.kind === "fee") acc.feesCzk += Math.abs(amount);
      if (tx.kind === "transfer" && tx.quantity !== null && amount < 0) {
        acc.principalInCzk += Math.abs(amount);
      }
      if (tx.kind === "transfer" && tx.quantity !== null && amount > 0) {
        acc.principalOutCzk += amount;
      }
      return acc;
    },
    {
      buysCzk: 0,
      sellsCzk: 0,
      dividendsCzk: 0,
      interestCzk: 0,
      principalInCzk: 0,
      principalOutCzk: 0,
      feesCzk: 0,
    },
  );

  let metadata: {
    loanName: string | null;
    projectUrl: string | null;
    projectType: string | null;
    investedPrincipal: number | null;
    returnedPrincipal: number | null;
    receivedInterestCzk: number | null;
    reservedOfferCzk: number | null;
    isin: string | null;
    loanCount: number | null;
    totalInvested: number | null;
    totalReturned: number | null;
    receivedInterest: number | null;
    currentPrincipal: number | null;
    bond: boolean | null;
  } | null = null;

  const firstRaw = assets[0].raw_json ? String(assets[0].raw_json) : "";
  if (firstRaw) {
    try {
      const parsed = JSON.parse(firstRaw) as Record<string, unknown>;
      metadata = {
        loanName:
          typeof parsed.loanName === "string" && parsed.loanName
            ? parsed.loanName
            : null,
        projectUrl:
          typeof parsed.projectUrl === "string" && parsed.projectUrl
            ? parsed.projectUrl
            : null,
        projectType:
          typeof parsed.projectType === "string" && parsed.projectType
            ? parsed.projectType
            : null,
        investedPrincipal:
          parsed.investedPrincipal === null ||
          parsed.investedPrincipal === undefined
            ? null
            : num(parsed.investedPrincipal),
        returnedPrincipal:
          parsed.returnedPrincipal === null ||
          parsed.returnedPrincipal === undefined
            ? null
            : num(parsed.returnedPrincipal),
        receivedInterestCzk:
          parsed.receivedInterestCzk === null ||
          parsed.receivedInterestCzk === undefined
            ? null
            : num(parsed.receivedInterestCzk),
        reservedOfferCzk:
          parsed.reservedOfferCzk === null ||
          parsed.reservedOfferCzk === undefined
            ? null
            : num(parsed.reservedOfferCzk),
        isin:
          typeof parsed.isin === "string" && parsed.isin
            ? parsed.isin
            : null,
        loanCount:
          parsed.loanCount === null || parsed.loanCount === undefined
            ? null
            : num(parsed.loanCount),
        totalInvested:
          parsed.totalInvested === null || parsed.totalInvested === undefined
            ? null
            : num(parsed.totalInvested),
        totalReturned:
          parsed.totalReturned === null || parsed.totalReturned === undefined
            ? null
            : num(parsed.totalReturned),
        receivedInterest:
          parsed.receivedInterest === null || parsed.receivedInterest === undefined
            ? null
            : num(parsed.receivedInterest),
        currentPrincipal:
          parsed.currentPrincipal === null || parsed.currentPrincipal === undefined
            ? null
            : num(parsed.currentPrincipal),
        bond:
          typeof parsed.bond === "boolean" ? parsed.bond : null,
      };
    } catch {
      metadata = null;
    }
  }

  const currentValueCzk = holdings.reduce(
    (sum, holding) => sum + holding.marketValueCzk,
    0,
  );
  const unrealizedPnlCzk = holdings.reduce(
    (sum, holding) => sum + (holding.unrealizedPnlCzk ?? 0),
    0,
  );

  return {
    symbol,
    name: String(assets[0].name),
    assetClass: String(assets[0].asset_class),
    providers: assets.map((asset) => String(asset.provider)),
    currencies: Array.from(new Set(assets.map((asset) => String(asset.currency)))),
    currentValueCzk,
    unrealizedPnlCzk,
    holdings,
    transactions,
    metadata,
    summary: {
      ...summary,
      netTradeCashFlowCzk: summary.sellsCzk - summary.buysCzk,
    },
  };
}


export function getHistoryData() {
  const db = getDb();

  const snapshotRows = getCombinedSnapshotSeries(db);

  const flowRows = db
    .prepare(`
      SELECT
        substr(t.occurred_at, 1, 10) AS day,
        t.kind,
        t.category,
        SUM(
          CASE
            WHEN t.kind IN ('deposit', 'withdrawal') THEN ABS(t.amount_czk)
            ELSE t.amount_czk
          END
        ) AS amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND t.amount_czk IS NOT NULL
        AND (
          (
            t.kind IN ('deposit', 'withdrawal')
            AND (
              t.flow_scope = 'external'
              OR (
                t.flow_scope = 'legacy'
                AND t.provider IN ('kraken', 'investown', 'mintos')
              )
            )
          )
          OR (
            t.kind = 'income'
            AND t.category = 'card_cashback'
            AND t.flow_scope = 'external'
          )
        )
      GROUP BY day, t.kind, t.category
      ORDER BY day ASC
    `)
    .all();

  const flowByDay = new Map<
    string,
    {
      depositsCzk: number;
      withdrawalsCzk: number;
      cardSpendCzk: number;
      cardRefundsCzk: number;
      externalRewardsCzk: number;
    }
  >();

  for (const row of flowRows) {
    const day = String(row.day);
    const current = flowByDay.get(day) ?? {
      depositsCzk: 0,
      withdrawalsCzk: 0,
      cardSpendCzk: 0,
      cardRefundsCzk: 0,
      externalRewardsCzk: 0,
    };
    const kind = String(row.kind);
    const category = String(row.category || "");
    if (kind === "deposit" && category.startsWith("card_refund:")) {
      current.cardRefundsCzk += num(row.amount);
    } else if (kind === "deposit") {
      current.depositsCzk += num(row.amount);
    } else if (kind === "withdrawal" && category.startsWith("card_spend:")) {
      current.cardSpendCzk += num(row.amount);
    } else if (kind === "withdrawal") {
      current.withdrawalsCzk += num(row.amount);
    } else if (kind === "income" && category === "card_cashback") {
      current.externalRewardsCzk += num(row.amount);
    }
    flowByDay.set(day, current);
  }

  let cumulative = 0;
  let cumulativeExternalRewards = 0;
  const contributionSeries = [...flowByDay.entries()].map(([date, flow]) => {
    const netOwnerFlow =
      flow.depositsCzk -
      flow.withdrawalsCzk -
      flow.cardSpendCzk +
      flow.cardRefundsCzk;
    cumulative += netOwnerFlow;
    cumulativeExternalRewards += flow.externalRewardsCzk;
    return {
      date,
      depositsCzk: flow.depositsCzk,
      withdrawalsCzk: flow.withdrawalsCzk,
      cardSpendCzk: flow.cardSpendCzk,
      cardRefundsCzk: flow.cardRefundsCzk,
      externalRewardsCzk: flow.externalRewardsCzk,
      netFlowCzk: netOwnerFlow,
      capitalForPnlCzk: netOwnerFlow + flow.externalRewardsCzk,
      cumulativeNetContributedCzk: cumulative,
      cumulativeExternalRewardsCzk: cumulativeExternalRewards,
      cumulativeCapitalForPnlCzk: cumulative + cumulativeExternalRewards,
    };
  });

  const capitalFlowMonths = new Map<
    string,
    {
      month: string;
      depositsCzk: number;
      withdrawalsCzk: number;
      cardSpendCzk: number;
      cardRefundsCzk: number;
      externalRewardsCzk: number;
    }
  >();

  for (const item of contributionSeries) {
    const month = item.date.slice(0, 7);
    const current = capitalFlowMonths.get(month) ?? {
      month,
      depositsCzk: 0,
      withdrawalsCzk: 0,
      cardSpendCzk: 0,
      cardRefundsCzk: 0,
      externalRewardsCzk: 0,
    };
    current.depositsCzk += item.depositsCzk;
    current.withdrawalsCzk += item.withdrawalsCzk;
    current.cardSpendCzk += item.cardSpendCzk;
    current.cardRefundsCzk += item.cardRefundsCzk;
    current.externalRewardsCzk += item.externalRewardsCzk;
    capitalFlowMonths.set(month, current);
  }

  const monthlyCapitalFlows = [...capitalFlowMonths.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({
      ...item,
      netContributedCzk:
        item.depositsCzk -
        item.withdrawalsCzk -
        item.cardSpendCzk +
        item.cardRefundsCzk,
      netCardSpendCzk: item.cardSpendCzk - item.cardRefundsCzk,
      capitalForPnlCzk:
        item.depositsCzk -
        item.withdrawalsCzk -
        item.cardSpendCzk +
        item.cardRefundsCzk +
        item.externalRewardsCzk,
    }));

  const coverage = db
    .prepare(`
      SELECT
        a.id,
        a.provider,
        a.name,
        a.type,
        COALESCE(t.transaction_count, 0) AS transaction_count,
        t.oldest_transaction,
        t.newest_transaction,
        COALESCE(s.snapshot_count, 0) AS snapshot_count,
        s.first_snapshot,
        s.last_snapshot
      FROM accounts a
      LEFT JOIN (
        SELECT
          account_id,
          COUNT(*) AS transaction_count,
          MIN(occurred_at) AS oldest_transaction,
          MAX(occurred_at) AS newest_transaction
        FROM transactions
        GROUP BY account_id
      ) t ON t.account_id = a.id
      LEFT JOIN (
        SELECT
          account_id,
          COUNT(*) AS snapshot_count,
          MIN(recorded_at) AS first_snapshot,
          MAX(recorded_at) AS last_snapshot
        FROM snapshots
        GROUP BY account_id
      ) s ON s.account_id = a.id
      ORDER BY a.name ASC
    `)
    .all()
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      name: String(row.name),
      type: String(row.type),
      transactionCount: num(row.transaction_count),
      oldestTransaction: row.oldest_transaction
        ? String(row.oldest_transaction)
        : null,
      newestTransaction: row.newest_transaction
        ? String(row.newest_transaction)
        : null,
      snapshotCount: num(row.snapshot_count),
      firstSnapshot: row.first_snapshot ? String(row.first_snapshot) : null,
      lastSnapshot: row.last_snapshot ? String(row.last_snapshot) : null,
    }));

  const oldestKnownTransaction = coverage
    .map((item) => item.oldestTransaction)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;

  const firstSnapshot = snapshotRows[0]?.date ?? null;
  const latestSnapshot = snapshotRows.at(-1)?.date ?? null;

  const depositsCzk = contributionSeries.reduce(
    (sum, item) => sum + item.depositsCzk,
    0,
  );
  const withdrawalsCzk = contributionSeries.reduce(
    (sum, item) => sum + item.withdrawalsCzk,
    0,
  );
  const cardSpendCzk = contributionSeries.reduce(
    (sum, item) => sum + item.cardSpendCzk,
    0,
  );
  const cardRefundsCzk = contributionSeries.reduce(
    (sum, item) => sum + item.cardRefundsCzk,
    0,
  );
  const externalRewardsCzk = contributionSeries.reduce(
    (sum, item) => sum + item.externalRewardsCzk,
    0,
  );

  const unresolvedHistory = db
    .prepare(`
      SELECT
        SUM(
          CASE
            WHEN t.kind IN ('deposit', 'withdrawal') THEN 1
            ELSE 0
          END
        ) AS cash_count,
        SUM(
          CASE
            WHEN t.kind IN ('deposit', 'withdrawal')
              AND t.amount_czk IS NOT NULL
            THEN ABS(t.amount_czk)
            ELSE 0
          END
        ) AS cash_value_czk,
        SUM(CASE WHEN t.kind = 'transfer' THEN 1 ELSE 0 END) AS transfer_count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type IN ('brokerage', 'crypto', 'p2p')
        AND t.flow_scope = 'unclassified'
        AND t.kind IN ('deposit', 'withdrawal', 'transfer')
    `)
    .get();

  const interactiveChart = getPortfolioHistoryChartData(db);

  return {
    snapshots: snapshotRows,
    contributions: contributionSeries,
    monthlyCapitalFlows,
    chart: interactiveChart,
    coverage,
    summary: {
      oldestKnownTransaction,
      firstSnapshot,
      latestSnapshot,
      depositsCzk,
      withdrawalsCzk,
      cardSpendCzk,
      cardRefundsCzk,
      netCardSpendCzk: cardSpendCzk - cardRefundsCzk,
      externalRewardsCzk,
      netContributedCzk:
        depositsCzk -
        withdrawalsCzk -
        cardSpendCzk +
        cardRefundsCzk,
      capitalForPnlCzk:
        depositsCzk -
        withdrawalsCzk -
        cardSpendCzk +
        cardRefundsCzk +
        externalRewardsCzk,
      unresolvedCashFlowCount: num(unresolvedHistory?.cash_count),
      unresolvedCashFlowCzk: num(unresolvedHistory?.cash_value_czk),
      unresolvedWalletTransferCount: num(unresolvedHistory?.transfer_count),
    },
  };
}
