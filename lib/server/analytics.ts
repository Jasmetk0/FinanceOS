import { getDb } from "@/lib/server/db";
import { listConnections } from "@/lib/server/repository";

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getDashboardData() {
  const db = getDb();

  const totals =
    db.prepare(`
      SELECT
        COALESCE(SUM(total_value_czk), 0) AS net_worth,
        COALESCE(SUM(invested_value_czk), 0) AS invested,
        COALESCE(SUM(unrealized_pnl_czk), 0) AS unrealized_pnl,
        COALESCE(SUM(cash_value_czk), 0) AS cash
      FROM accounts
    `).get() ?? {};

  const accounts = db
    .prepare(`
      SELECT id, provider, name, type, currency, total_value_czk, updated_at
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
      updatedAt: String(row.updated_at),
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
      accountName: String(row.account_name),
      symbol: String(row.symbol || ""),
    }));

  const snapshotRows = db
    .prepare(`
      SELECT recorded_at, SUM(total_value_czk) AS total
      FROM snapshots
      GROUP BY recorded_at
      ORDER BY recorded_at ASC
      LIMIT 730
    `)
    .all();

  const portfolioSeries = snapshotRows.map((row) => ({
    date: String(row.recorded_at),
    valueCzk: num(row.total),
  }));

  const allocationMap = new Map<string, number>();
  for (const holding of holdings) {
    allocationMap.set(
      holding.assetClass,
      (allocationMap.get(holding.assetClass) ?? 0) + holding.valueCzk,
    );
  }

  const allocation = [...allocationMap.entries()]
    .map(([label, valueCzk]) => ({ label, valueCzk }))
    .sort((a, b) => b.valueCzk - a.valueCzk);

  return {
    summary: {
      netWorthCzk: num(totals.net_worth),
      investedCzk: num(totals.invested),
      unrealizedPnlCzk: num(totals.unrealized_pnl),
      cashCzk: num(totals.cash),
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
        realized_pnl_czk, unrealized_pnl_czk, updated_at
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
  netCzk: number;
  savingsRate: number | null;
}

export function getCashFlowData(months = 18) {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT kind, occurred_at, amount_czk, category, source_label
      FROM transactions
      WHERE provider = 'manual'
        AND amount_czk IS NOT NULL
        AND kind IN ('income', 'gift', 'expense', 'interest', 'fee')
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
        netCzk: 0,
        savingsRate: null,
      };

    const kind = String(row.kind);
    const amount = num(row.amount_czk);

    if (kind === "income") item.incomeCzk += Math.max(0, amount);
    if (kind === "gift") item.giftsCzk += Math.max(0, amount);
    if (kind === "interest") item.interestCzk += Math.max(0, amount);
    if (kind === "expense" || kind === "fee") {
      item.expensesCzk += Math.abs(amount);
    }

    byMonth.set(month, item);
  }

  const allMonths = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-Math.max(1, months))
    .map((item) => {
      const grossIncome = item.incomeCzk + item.giftsCzk + item.interestCzk;
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
      acc.netCzk += item.netCzk;
      return acc;
    },
    {
      incomeCzk: 0,
      giftsCzk: 0,
      expensesCzk: 0,
      interestCzk: 0,
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
      WHERE provider = 'manual'
        AND amount_czk IS NOT NULL
        AND kind IN ('income', 'gift', 'expense', 'interest', 'fee')
      GROUP BY category, kind
      ORDER BY total DESC
    `)
    .all()
    .map((row) => ({
      category: String(row.category),
      kind: String(row.kind),
      totalCzk: num(row.total),
    }));

  const sourceRows = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(source_label, ''), 'Unspecified') AS source,
        SUM(CASE
          WHEN kind IN ('income', 'gift', 'interest') THEN ABS(amount_czk)
          ELSE 0
        END) AS total
      FROM transactions
      WHERE provider = 'manual'
        AND amount_czk IS NOT NULL
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
    totals.incomeCzk + totals.giftsCzk + totals.interestCzk;

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
