import { getDb } from "@/lib/server/db";

export const PLAN_CLASSES = [
  "etf",
  "stock",
  "crypto",
  "p2p",
  "cash",
  "other",
] as const;

export type PlanAssetClass = (typeof PLAN_CLASSES)[number];

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentAllocation(): Record<PlanAssetClass, number> {
  const db = getDb();
  const result: Record<PlanAssetClass, number> = {
    etf: 0,
    stock: 0,
    crypto: 0,
    p2p: 0,
    cash: 0,
    other: 0,
  };

  const holdingRows = db
    .prepare(`
      SELECT a.asset_class, SUM(h.market_value_czk) AS total
      FROM holdings h
      JOIN assets a ON a.id = h.asset_id
      GROUP BY a.asset_class
    `)
    .all();

  for (const row of holdingRows) {
    const raw = String(row.asset_class).toLowerCase();
    const key: PlanAssetClass =
      raw === "etf" ||
      raw === "stock" ||
      raw === "crypto" ||
      raw === "p2p" ||
      raw === "cash" ||
      raw === "other"
        ? raw
        : "other";
    result[key] += num(row.total);
  }

  // Brokerage cash is not represented by holdings, while Kraken fiat is.
  const brokerageCash = db
    .prepare(`
      SELECT COALESCE(SUM(cash_value_czk), 0) AS total
      FROM accounts
      WHERE type = 'brokerage'
    `)
    .get();
  result.cash += num(brokerageCash?.total);

  // P2P project holdings (Investown) are already counted above. Add only
  // the residual account value that is not represented by any holdings; this
  // also keeps balance-only providers such as Mintos fully represented.
  const p2pAccounts = db
    .prepare(`
      SELECT id, total_value_czk
      FROM accounts
      WHERE type = 'p2p'
    `)
    .all();

  for (const account of p2pAccounts) {
    const represented = db
      .prepare(`
        SELECT COALESCE(SUM(h.market_value_czk), 0) AS total
        FROM holdings h
        WHERE h.account_id = ?
      `)
      .get(String(account.id));

    result.p2p += Math.max(
      0,
      num(account.total_value_czk) - num(represented?.total),
    );
  }

  const standaloneCash = db
    .prepare(`
      SELECT COALESCE(SUM(total_value_czk), 0) AS total
      FROM accounts
      WHERE type = 'cash'
        AND NOT (provider = 'manual' AND external_id = 'main')
    `)
    .get();
  result.cash += Math.max(0, num(standaloneCash?.total));

  const manualAssets = db
    .prepare(`
      SELECT COALESCE(SUM(total_value_czk), 0) AS total
      FROM accounts
      WHERE provider = 'manual'
        AND type = 'asset'
        AND external_id LIKE 'balance:%'
    `)
    .get();
  result.other += Math.max(0, num(manualAssets?.total));

  return result;
}

function getMonthlyContribution(): number {
  const row = getDb()
    .prepare("SELECT value FROM plan_settings WHERE key = 'monthly_contribution_czk'")
    .get();
  return Math.max(0, num(row?.value));
}

export function savePlan(input: {
  targets: Record<string, unknown>;
  monthlyContributionCzk: number;
}) {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const monthlyContributionCzk = Number(input.monthlyContributionCzk);

  if (
    !Number.isFinite(monthlyContributionCzk) ||
    monthlyContributionCzk < 0 ||
    monthlyContributionCzk > 100_000_000
  ) {
    throw new Error("Monthly contribution must be a valid non-negative amount.");
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const targetStatement = db.prepare(`
      INSERT INTO plan_targets(asset_class, target_pct, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(asset_class) DO UPDATE SET
        target_pct = excluded.target_pct,
        updated_at = excluded.updated_at
    `);

    for (const assetClass of PLAN_CLASSES) {
      const value = Number(input.targets?.[assetClass] ?? 0);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(
          `Target for ${assetClass} must be between 0 and 100 percent.`,
        );
      }
      targetStatement.run(assetClass, value, timestamp);
    }

    db.prepare(`
      INSERT INTO plan_settings(key, value, updated_at)
      VALUES('monthly_contribution_czk', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(String(monthlyContributionCzk), timestamp);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function getPlanData() {
  const db = getDb();
  const current = currentAllocation();
  const targetRows = db
    .prepare("SELECT asset_class, target_pct FROM plan_targets")
    .all();

  const targets: Record<PlanAssetClass, number> = {
    etf: 0,
    stock: 0,
    crypto: 0,
    p2p: 0,
    cash: 0,
    other: 0,
  };

  for (const row of targetRows) {
    const key = String(row.asset_class) as PlanAssetClass;
    if (PLAN_CLASSES.includes(key)) {
      targets[key] = num(row.target_pct);
    }
  }

  const monthlyContributionCzk = getMonthlyContribution();
  const totalValueCzk = PLAN_CLASSES.reduce(
    (sum, key) => sum + current[key],
    0,
  );
  const targetSumPct = PLAN_CLASSES.reduce(
    (sum, key) => sum + targets[key],
    0,
  );
  const active = Math.abs(targetSumPct - 100) <= 0.05;

  const rows = PLAN_CLASSES.map((assetClass) => {
    const currentValueCzk = current[assetClass];
    const currentPct =
      totalValueCzk > 0 ? (currentValueCzk / totalValueCzk) * 100 : 0;
    const targetPct = targets[assetClass];

    return {
      assetClass,
      currentValueCzk,
      currentPct,
      targetPct,
      driftPct: currentPct - targetPct,
      targetValueNowCzk: active
        ? (totalValueCzk * targetPct) / 100
        : null,
    };
  });

  let contributionPlan = rows.map((row) => ({
    assetClass: row.assetClass,
    amountCzk: 0,
  }));

  if (active && monthlyContributionCzk > 0) {
    const futureTotal = totalValueCzk + monthlyContributionCzk;
    const gaps = rows.map((row) => ({
      assetClass: row.assetClass,
      gapCzk: Math.max(
        0,
        (futureTotal * row.targetPct) / 100 - row.currentValueCzk,
      ),
    }));
    const totalGap = gaps.reduce((sum, item) => sum + item.gapCzk, 0);

    if (totalGap > 0) {
      contributionPlan = gaps.map((item) => ({
        assetClass: item.assetClass,
        amountCzk:
          monthlyContributionCzk * (item.gapCzk / totalGap),
      }));
    }
  }

  return {
    active,
    targetSumPct,
    monthlyContributionCzk,
    totalValueCzk,
    rows,
    contributionPlan,
  };
}
