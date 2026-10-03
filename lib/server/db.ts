import { DatabaseSync } from "node:sqlite";
import {
  classifyInvestownKind,
  investownIncomeCategory,
  investownInterestBucket,
  isPerformanceExternalRewardCategory,
} from "@/lib/investown-semantics.mjs";
import { getDatabasePath } from "@/lib/server/paths";
import {
  canonicalCryptoIdentity,
  canonicalSecurityIdentity,
} from "@/lib/shared/finance-normalization.mjs";

const globalDb = globalThis as typeof globalThis & {
  __financeOsDb?: DatabaseSync;
};

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => String(row.name) === column);
}


function parseJsonObject(value: unknown): Record<string, unknown> {
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

function backfillLegacyFlowScopes(db: DatabaseSync) {
  // Old exports predate explicit flow_scope. Bring them in line with the
  // provider semantics used by current sync/import code instead of silently
  // excluding them from performance analytics.
  db.exec(`
    UPDATE transactions
    SET
      flow_scope = CASE
        WHEN kind = 'deposit' THEN 'unclassified'
        WHEN kind = 'withdrawal' THEN 'external'
        WHEN kind = 'transfer' THEN 'internal'
        ELSE 'not_applicable'
      END,
      category = CASE
        WHEN category IS NOT NULL AND category != '' THEN category
        WHEN kind = 'deposit' THEN 'cash_in_unclassified'
        WHEN kind = 'withdrawal' THEN 'cash_out_external'
        WHEN kind = 'transfer' THEN 'internal_transfer'
        ELSE category
      END
    WHERE provider = 'trading212'
      AND flow_scope = 'legacy';

    UPDATE transactions
    SET flow_scope = CASE
      WHEN kind IN ('deposit', 'withdrawal') THEN 'external'
      WHEN kind = 'transfer' THEN 'internal'
      ELSE 'not_applicable'
    END
    WHERE provider = 'investown'
      AND flow_scope = 'legacy';

    UPDATE transactions
    SET flow_scope = 'not_applicable'
    WHERE provider = 'kraken'
      AND flow_scope = 'legacy'
      AND kind IN ('buy', 'sell', 'dividend', 'interest', 'fee', 'adjustment');

    UPDATE transactions
    SET flow_scope = 'not_applicable'
    WHERE provider = 'manual'
      AND flow_scope = 'legacy';
  `);
}

export function repairTrading212CashSemantics(db: DatabaseSync) {
  // PR #16 initially classified legacy T212 deposits as external and generic
  // withdrawals as unclassified. The 212 Card audit showed that the public
  // endpoint mixes real deposits with cashback, while card purchases surface
  // as withdrawals. Revisit only coarse rows that have not been enriched by
  // the richer CSV export.
  db.exec(`
    UPDATE transactions
    SET
      flow_scope = 'unclassified',
      category = 'cash_in_unclassified'
    WHERE provider = 'trading212'
      AND kind = 'deposit'
      AND category = 'external_deposit'
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%';

    UPDATE transactions
    SET
      flow_scope = 'external',
      category = 'cash_out_external'
    WHERE provider = 'trading212'
      AND kind = 'withdrawal'
      AND category = 'cash_out_unclassified'
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%';

    UPDATE transactions
    SET
      flow_scope = 'unclassified',
      category = 'cash_in_unclassified'
    WHERE provider = 'trading212'
      AND kind = 'deposit'
      AND flow_scope = 'external'
      AND COALESCE(category, '') = ''
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%';

    UPDATE transactions
    SET
      flow_scope = 'external',
      category = 'cash_out_external'
    WHERE provider = 'trading212'
      AND kind = 'withdrawal'
      AND flow_scope = 'unclassified'
      AND COALESCE(category, '') = ''
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%';
  `);

  // The superficial API also represents manual FX conversion as a DEPOSIT
  // and WITHDRAW at the exact same timestamp in different currencies, often
  // with a fee row beside them. That is an internal value-preserving movement,
  // not money entering/leaving the portfolio.
  const conversionRows = db
    .prepare(`
      SELECT DISTINCT
        a.account_id,
        a.occurred_at,
        a.amount_czk AS deposit_czk,
        b.amount_czk AS withdrawal_czk
      FROM transactions a
      JOIN transactions b
        ON b.provider = a.provider
       AND b.account_id = a.account_id
       AND b.occurred_at = a.occurred_at
      WHERE a.provider = 'trading212'
        AND a.kind = 'deposit'
        AND b.kind = 'withdrawal'
        AND UPPER(a.currency) != UPPER(b.currency)
        AND a.amount_czk IS NOT NULL
        AND b.amount_czk IS NOT NULL
        AND COALESCE(a.raw_json, '') NOT LIKE '%financeOsCardExport%'
        AND COALESCE(b.raw_json, '') NOT LIKE '%financeOsCardExport%'
    `)
    .all();

  const markConversion = db.prepare(`
    UPDATE transactions
    SET
      kind = 'transfer',
      flow_scope = 'internal',
      category = 'currency_conversion',
      counterparty_ref = ?
    WHERE provider = 'trading212'
      AND account_id = ?
      AND occurred_at = ?
      AND kind IN ('deposit', 'withdrawal')
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%'
  `);

  for (const row of conversionRows) {
    const depositCzk = Math.abs(Number(row.deposit_czk));
    const withdrawalCzk = Math.abs(Number(row.withdrawal_czk));
    const tolerance = Math.max(
      5,
      Math.max(depositCzk, withdrawalCzk) * 0.02,
    );
    if (
      !Number.isFinite(depositCzk) ||
      !Number.isFinite(withdrawalCzk) ||
      Math.abs(depositCzk - withdrawalCzk) > tolerance
    ) {
      continue;
    }

    const accountId = String(row.account_id);
    const occurredAt = String(row.occurred_at);
    markConversion.run("fx:" + occurredAt, accountId, occurredAt);
  }

  // Trading 212's coarse history currently exposes both ordinary account
  // deposits and 212 Card cashback as type=DEPOSIT. When the richer export API
  // is rate-limited, this used to leave every deposit unresolved and made the
  // entire contribution history unusable.
  //
  // The card feed has a strong provider-generated signature: cashback is paid
  // daily in small amounts shortly after midnight and, on many days, equals
  // 1.5% of the previous UTC day's card withdrawals. We only activate this
  // fallback after observing that signature repeatedly on the same account.
  // Once established, nightly small DEPOSIT rows are reward capital; the
  // remaining coarse DEPOSIT rows are ordinary external deposits.
  const unresolvedDeposits = db
    .prepare(`
      SELECT id, account_id, occurred_at, amount_czk, raw_json
      FROM transactions
      WHERE provider = 'trading212'
        AND kind = 'deposit'
        AND flow_scope = 'unclassified'
        AND amount_czk IS NOT NULL
        AND amount_czk > 0
        AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%'
      ORDER BY occurred_at ASC
    `)
    .all();

  const withdrawals = db
    .prepare(`
      SELECT account_id, occurred_at, amount_czk
      FROM transactions
      WHERE provider = 'trading212'
        AND kind = 'withdrawal'
        AND flow_scope = 'external'
        AND amount_czk IS NOT NULL
      ORDER BY occurred_at ASC
    `)
    .all();

  const accountIds = new Set(
    unresolvedDeposits.map((row) => String(row.account_id)),
  );

  const utcDate = (iso: string) => {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  };

  const previousUtcDate = (date: string) => {
    const parsed = new Date(date + "T00:00:00.000Z");
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return parsed.toISOString().slice(0, 10);
  };

  const markCashback = db.prepare(`
    UPDATE transactions
    SET
      kind = 'income',
      flow_scope = 'external',
      category = 'card_cashback',
      source_label = 'Trading 212 card cashback · inferred'
    WHERE id = ?
  `);

  const markDeposit = db.prepare(`
    UPDATE transactions
    SET
      flow_scope = 'external',
      category = 'external_deposit',
      source_label = COALESCE(NULLIF(source_label, ''), 'Trading 212 deposit')
    WHERE id = ?
  `);

  const markCardSpend = db.prepare(`
    UPDATE transactions
    SET
      category = 'card_spend:inferred',
      source_label = 'Trading 212 card · inferred'
    WHERE provider = 'trading212'
      AND account_id = ?
      AND kind = 'withdrawal'
      AND flow_scope = 'external'
      AND substr(occurred_at, 1, 10) = ?
      AND COALESCE(category, '') NOT LIKE 'card_spend:%'
      AND COALESCE(raw_json, '') NOT LIKE '%financeOsCardExport%'
  `);

  for (const accountId of accountIds) {
    const accountDeposits = unresolvedDeposits.filter(
      (row) => String(row.account_id) === accountId,
    );
    const withdrawalByDate = new Map<string, number>();

    for (const row of withdrawals) {
      if (String(row.account_id) !== accountId) continue;
      const date = utcDate(String(row.occurred_at));
      if (!date) continue;
      withdrawalByDate.set(
        date,
        (withdrawalByDate.get(date) ?? 0) +
          Math.abs(Number(row.amount_czk) || 0),
      );
    }

    const candidatesByDate = new Map<string, typeof accountDeposits>();
    for (const row of accountDeposits) {
      const parsed = new Date(String(row.occurred_at));
      const amount = Number(row.amount_czk);
      if (
        Number.isNaN(parsed.getTime()) ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 100
      ) {
        continue;
      }

      const hour = parsed.getUTCHours();
      if (hour !== 1 && hour !== 2) continue;
      const date = parsed.toISOString().slice(0, 10);
      const rows = candidatesByDate.get(date) ?? [];
      rows.push(row);
      candidatesByDate.set(date, rows);
    }

    const matchedDates: string[] = [];
    for (const [date, rows] of candidatesByDate) {
      const previousWithdrawals =
        withdrawalByDate.get(previousUtcDate(date)) ?? 0;
      if (previousWithdrawals <= 0) continue;

      const cashback = rows.reduce(
        (sum, row) => sum + Number(row.amount_czk || 0),
        0,
      );
      const expected = Math.round(previousWithdrawals * 0.015 * 100) / 100;
      if (Math.abs(cashback - expected) <= 0.05) {
        matchedDates.push(date);
      }
    }

    // Require repeated exact daily-rate matches before inferring anything.
    if (matchedDates.length < 3) continue;
    matchedDates.sort();
    const firstCardDate = matchedDates[0];

    // An exact 1.5% next-day cashback match proves that the preceding day's
    // aggregate external outflow was card-eligible spend. Mark only those
    // proven days as personal card expense; unmatched withdrawals remain
    // ordinary external outflows until the rich merchant export resolves them.
    for (const cashbackDate of matchedDates) {
      markCardSpend.run(accountId, previousUtcDate(cashbackDate));
    }

    const matchedDateSet = new Set(matchedDates);
    const cashbackIds = new Set<string>();
    const ambiguousCardEraIds = new Set<string>();

    for (const [date, rows] of candidatesByDate) {
      if (matchedDateSet.has(date)) {
        for (const row of rows) {
          cashbackIds.add(String(row.id));
          markCashback.run(String(row.id));
        }
        continue;
      }

      // After card cashback is proven to exist on the account, unmatched
      // small nightly cash-ins are not safe to call either cashback or an
      // ordinary bank deposit. Keep them unresolved until the rich export
      // or another exact provider-history signature identifies them.
      if (date >= firstCardDate) {
        for (const row of rows) {
          ambiguousCardEraIds.add(String(row.id));
        }
      }
    }

    for (const row of accountDeposits) {
      const id = String(row.id);
      if (cashbackIds.has(id) || ambiguousCardEraIds.has(id)) continue;
      markDeposit.run(id);
    }
  }

  const cardEvidence = db
    .prepare(`
      SELECT 1
      FROM transactions
      WHERE provider = 'trading212'
        AND (
          category = 'card_cashback'
          OR category LIKE 'card_spend:%'
          OR category LIKE 'card_refund:%'
          OR category = 'card_fee'
        )
      LIMIT 1
    `)
    .get();

  if (cardEvidence) {
    const accounts = db
      .prepare(`
        SELECT
          id,
          cash_value,
          cash_value_czk,
          unclassified_value,
          unclassified_value_czk,
          raw_json
        FROM accounts
        WHERE provider = 'trading212'
          AND type = 'brokerage'
          AND unclassified_value_czk > 0
      `)
      .all();

    const reconcile = db.prepare(`
      UPDATE accounts
      SET
        cash_value = ?,
        cash_value_czk = ?,
        unclassified_value = 0,
        unclassified_value_czk = 0,
        reconciliation_difference = 0,
        reconciliation_status = 'reconciled',
        raw_json = ?
      WHERE id = ?
    `);

    for (const row of accounts) {
      const spendingPot = Number(row.unclassified_value) || 0;
      const spendingPotCzk = Number(row.unclassified_value_czk) || 0;
      const raw = parseJsonObject(row.raw_json);
      const oldReconciliation = parseJsonObject(
        raw.financeOsReconciliation,
      );

      reconcile.run(
        (Number(row.cash_value) || 0) + spendingPot,
        (Number(row.cash_value_czk) || 0) + spendingPotCzk,
        JSON.stringify({
          ...raw,
          financeOsReconciliation: {
            ...oldReconciliation,
            spendingPot: {
              value: spendingPot,
              valueCzk: spendingPotCzk,
              source: "provider_total_residual",
              confidence: "confirmed_by_card_cashback_signature",
            },
            unclassifiedValue: 0,
          },
        }),
        String(row.id),
      );
    }
  }
}

function repairInvestownClassificationAudit(db: DatabaseSync) {
  const accounts = db
    .prepare(
      "SELECT id, raw_json FROM accounts WHERE provider = 'investown'",
    )
    .all();
  const rows = db.prepare(`
    SELECT id, kind, category, flow_scope, raw_json
    FROM transactions
    WHERE account_id = ?
    ORDER BY occurred_at ASC, external_id ASC
  `);
  const updateTransaction = db.prepare(
    "UPDATE transactions SET kind = ?, category = ?, flow_scope = ?, raw_json = ? WHERE id = ?",
  );
  const updateAccount = db.prepare(
    "UPDATE accounts SET raw_json = ? WHERE id = ?",
  );

  for (const account of accounts) {
    const accountRaw = parseJsonObject(account.raw_json);
    if (accountRaw.importMode !== "investown-native") continue;

    const typeCounts = new Map<string, number>();
    const unknownTypes = new Set<string>();

    for (const row of rows.all(String(account.id))) {
      const raw = parseJsonObject(row.raw_json);
      const type =
        typeof raw.type === "string" && raw.type.trim()
          ? raw.type.trim()
          : String(row.category || "Unknown");
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

      // Use the current production classifier for the audit. Older FinanceOS
      // builds could flag provider wording such as "Smluvní pokuta z prodlení"
      // as unknown even though the transaction itself was safely recognized.
      const classified = classifyInvestownKind({
        type,
        description:
          typeof raw.description === "string" ? raw.description : undefined,
        projectType:
          typeof raw.projectType === "string" ? raw.projectType : undefined,
      });

      const requiresPortfolioRebuild =
        String(row.kind) === "adjustment" && classified === "transfer";

      if (classified === "adjustment" || requiresPortfolioRebuild) {
        // A newly learned principal/secondary-market movement cannot be safely
        // repaired by changing one transaction row: holdings and historical
        // principal snapshots must be rebuilt from the statement too. Keep it
        // visibly unclassified until the next Investown re-import does that
        // atomically.
        unknownTypes.add(type);
        if (
          String(row.kind) !== "adjustment" ||
          String(row.flow_scope) !== "unclassified"
        ) {
          updateTransaction.run(
            "adjustment",
            type,
            "unclassified",
            JSON.stringify({
              ...raw,
              financeOsClassification: "adjustment",
            }),
            String(row.id),
          );
        }
        continue;
      }

      // Non-principal semantics can be repaired safely in place because the
      // statement amount is already reflected in wallet/value history.
      if (String(row.kind) === "adjustment") {
        const repairedCategory =
          classified === "income"
            ? investownIncomeCategory({
                type,
                description:
                  typeof raw.description === "string"
                    ? raw.description
                    : undefined,
                projectType:
                  typeof raw.projectType === "string"
                    ? raw.projectType
                    : undefined,
              })
            : type;
        const repairedScope =
          classified === "deposit" || classified === "withdrawal"
            ? "external"
            : classified === "transfer"
              ? "internal"
              : "not_applicable";

        updateTransaction.run(
          classified,
          repairedCategory,
          repairedScope,
          JSON.stringify({
            ...raw,
            financeOsClassification: classified,
          }),
          String(row.id),
        );
      }
    }

    const accountingComplete = unknownTypes.size === 0;
    updateAccount.run(
      JSON.stringify({
        ...accountRaw,
        typeCounts: Object.fromEntries(
          [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
        unknownTypes: [...unknownTypes].sort(),
        accountingComplete,
      }),
      String(account.id),
    );
  }
}

function repairInvestownProjectIncomeBreakdown(db: DatabaseSync) {
  const accounts = db
    .prepare(
      "SELECT id, raw_json FROM accounts WHERE provider = 'investown'",
    )
    .all();
  const incomeRows = db.prepare(`
    SELECT asset_id, amount_czk, category, raw_json
    FROM transactions
    WHERE account_id = ?
      AND kind = 'interest'
      AND amount_czk IS NOT NULL
      AND asset_id IS NOT NULL
  `);
  const holdingRows = db.prepare(
    "SELECT id, asset_id, raw_json FROM holdings WHERE account_id = ?",
  );
  const assetRow = db.prepare(
    "SELECT raw_json FROM assets WHERE id = ? LIMIT 1",
  );
  const updateHolding = db.prepare(
    "UPDATE holdings SET raw_json = ? WHERE id = ?",
  );
  const updateAsset = db.prepare(
    "UPDATE assets SET raw_json = ? WHERE id = ?",
  );

  for (const account of accounts) {
    const accountRaw = parseJsonObject(account.raw_json);
    if (accountRaw.importMode !== "investown-native") continue;

    const byAsset = new Map<
      string,
      {
        ordinaryYieldCzk: number;
        bonusYieldCzk: number;
        penaltyYieldCzk: number;
        otherYieldCzk: number;
        receivedInterestCzk: number;
      }
    >();

    for (const row of incomeRows.all(String(account.id))) {
      const id = String(row.asset_id || "");
      if (!id) continue;
      const raw = parseJsonObject(row.raw_json);
      const type =
        typeof raw.type === "string" && raw.type.trim()
          ? raw.type
          : String(row.category || "");
      const amount = Number(row.amount_czk) || 0;
      const bucket = investownInterestBucket(type);
      const current = byAsset.get(id) ?? {
        ordinaryYieldCzk: 0,
        bonusYieldCzk: 0,
        penaltyYieldCzk: 0,
        otherYieldCzk: 0,
        receivedInterestCzk: 0,
      };

      current.receivedInterestCzk += amount;
      if (bucket === "ordinary") current.ordinaryYieldCzk += amount;
      else if (bucket === "bonus") current.bonusYieldCzk += amount;
      else if (bucket === "penalty") current.penaltyYieldCzk += amount;
      else current.otherYieldCzk += amount;
      byAsset.set(id, current);
    }

    for (const holding of holdingRows.all(String(account.id))) {
      const id = String(holding.asset_id || "");
      const breakdown = byAsset.get(id) ?? {
        ordinaryYieldCzk: 0,
        bonusYieldCzk: 0,
        penaltyYieldCzk: 0,
        otherYieldCzk: 0,
        receivedInterestCzk: 0,
      };
      const holdingRaw = parseJsonObject(holding.raw_json);
      updateHolding.run(
        JSON.stringify({
          ...holdingRaw,
          ...breakdown,
        }),
        String(holding.id),
      );

      const asset = assetRow.get(id);
      if (asset) {
        const raw = parseJsonObject(asset.raw_json);
        updateAsset.run(
          JSON.stringify({
            ...raw,
            ...breakdown,
          }),
          id,
        );
      }
    }
  }
}

function backfillAccountCoverage(db: DatabaseSync) {
  const investownRows = db
    .prepare(
      "SELECT id, raw_json, realized_pnl_status, unrealized_pnl_status " +
        "FROM accounts WHERE provider = 'investown'",
    )
    .all();

  const update = db.prepare(
    "UPDATE accounts SET realized_pnl_status = ?, unrealized_pnl_status = ?, " +
      "reconciliation_status = ?, reconciliation_difference = ? WHERE id = ?",
  );
  const unknownTypeCount = db.prepare(
    "SELECT COUNT(*) AS count FROM transactions " +
      "WHERE account_id = ? AND kind = 'adjustment'",
  );

  for (const row of investownRows) {
    const raw = parseJsonObject(row.raw_json);
    const isCompleteNativeStatement =
      raw.importMode === "investown-native" &&
      raw.balanceMode === "derived-from-full-statement";

    if (!isCompleteNativeStatement) continue;

    const unresolvedTypes =
      Number(unknownTypeCount.get(String(row.id))?.count) || 0;
    const accountingComplete = unresolvedTypes === 0;
    const realized = accountingComplete
      ? "available"
      : "partial";
    const unrealized =
      String(row.unrealized_pnl_status || "unknown") === "unknown"
        ? "not_applicable"
        : String(row.unrealized_pnl_status);

    update.run(
      realized,
      unrealized,
      accountingComplete ? "reconciled" : "warning",
      0,
      String(row.id),
    );
  }
}

function repairInvestownRealizedPnl(db: DatabaseSync) {
  const accounts = db
    .prepare(
      "SELECT id, currency, raw_json FROM accounts WHERE provider = 'investown'",
    )
    .all();

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'interest' THEN amount_czk ELSE 0 END), 0) AS interest_czk,
      COALESCE(SUM(
        CASE
          WHEN kind = 'income'
            AND COALESCE(category, '') NOT IN (
              'card_cashback',
              'external_reward',
              'referral_reward',
              'campaign_reward'
            )
          THEN amount_czk
          ELSE 0
        END
      ), 0) AS investment_income_czk,
      COALESCE(SUM(
        CASE
          WHEN kind = 'income'
            AND COALESCE(category, '') IN (
              'card_cashback',
              'external_reward',
              'referral_reward',
              'campaign_reward'
            )
          THEN amount_czk
          ELSE 0
        END
      ), 0) AS external_rewards_czk,
      COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_czk ELSE 0 END), 0) AS income_czk,
      COALESCE(SUM(CASE WHEN kind = 'fee' THEN ABS(amount_czk) ELSE 0 END), 0) AS fees_czk
    FROM transactions
    WHERE account_id = ?
      AND amount_czk IS NOT NULL
  `);
  const update = db.prepare(
    "UPDATE accounts SET realized_pnl = ?, realized_pnl_czk = ?, raw_json = ? WHERE id = ?",
  );

  for (const account of accounts) {
    const raw = parseJsonObject(account.raw_json);
    if (raw.importMode !== "investown-native") continue;
    if (String(account.currency || "").toUpperCase() !== "CZK") continue;

    const row = totals.get(String(account.id));
    const interestCzk = Number(row?.interest_czk) || 0;
    const investmentIncomeCzk = Number(row?.investment_income_czk) || 0;
    const externalRewardsCzk = Number(row?.external_rewards_czk) || 0;
    const incomeCzk = Number(row?.income_czk) || 0;
    const feesCzk = Number(row?.fees_czk) || 0;
    const investmentPnlCzk =
      interestCzk + investmentIncomeCzk - feesCzk;
    const totalGainCzk = investmentPnlCzk + externalRewardsCzk;

    update.run(
      investmentPnlCzk,
      investmentPnlCzk,
      JSON.stringify({
        ...raw,
        derivedInterest: interestCzk,
        derivedOtherInvestmentIncome: investmentIncomeCzk,
        derivedExternalRewards: externalRewardsCzk,
        derivedOtherIncome: incomeCzk,
        derivedFees: feesCzk,
        derivedInvestmentPnl: investmentPnlCzk,
        derivedTotalGain: totalGainCzk,
        derivedRealizedPnl: investmentPnlCzk,
      }),
      String(account.id),
    );
  }
}

function repairInvestownSnapshotPerformance(db: DatabaseSync) {
  const accounts = db
    .prepare(
      "SELECT id, raw_json FROM accounts WHERE provider = 'investown'",
    )
    .all();

  const transactionRows = db.prepare(`
    SELECT occurred_at, kind, category, amount_czk, raw_json
    FROM transactions
    WHERE account_id = ?
      AND amount_czk IS NOT NULL
      AND kind IN ('interest', 'income', 'fee')
    ORDER BY occurred_at ASC
  `);
  const snapshotRows = db.prepare(`
    SELECT recorded_at, raw_json
    FROM snapshots
    WHERE account_id = ?
    ORDER BY recorded_at ASC
  `);
  const updateSnapshot = db.prepare(
    "UPDATE snapshots SET raw_json = ? " +
      "WHERE account_id = ? AND recorded_at = ?",
  );

  for (const account of accounts) {
    const accountRaw = parseJsonObject(account.raw_json);
    if (accountRaw.importMode !== "investown-native") continue;

    const flows = transactionRows
      .all(String(account.id))
      .map((row) => {
        const raw = parseJsonObject(row.raw_json);
        const sourceDate =
          typeof raw.sourceDate === "string" ? raw.sourceDate : "";
        const localMatch = sourceDate.match(/^(\d{4}-\d{2}-\d{2})/);
        return {
          date:
            localMatch?.[1] ||
            String(row.occurred_at || "").slice(0, 10),
          occurredAt: String(row.occurred_at || ""),
          kind: String(row.kind || ""),
          category: String(row.category || ""),
          amountCzk: Number(row.amount_czk) || 0,
        };
      })
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.occurredAt.localeCompare(right.occurredAt),
      );

    let index = 0;
    let interestCzk = 0;
    let investmentIncomeCzk = 0;
    let externalRewardsCzk = 0;
    let feesCzk = 0;

    for (const snapshot of snapshotRows.all(String(account.id))) {
      const date = String(snapshot.recorded_at || "").slice(0, 10);
      while (index < flows.length && flows[index].date <= date) {
        const flow = flows[index];
        if (flow.kind === "interest") {
          interestCzk += flow.amountCzk;
        } else if (flow.kind === "income") {
          if (isPerformanceExternalRewardCategory(flow.category)) {
            externalRewardsCzk += flow.amountCzk;
          } else {
            investmentIncomeCzk += flow.amountCzk;
          }
        } else if (flow.kind === "fee") {
          feesCzk += Math.abs(flow.amountCzk);
        }
        index += 1;
      }

      const investmentPnlCzk =
        interestCzk + investmentIncomeCzk - feesCzk;
      const totalGainCzk = investmentPnlCzk + externalRewardsCzk;
      const raw = parseJsonObject(snapshot.raw_json);
      const previousHistory =
        raw.financeOsInvestownHistory &&
        typeof raw.financeOsInvestownHistory === "object" &&
        !Array.isArray(raw.financeOsInvestownHistory)
          ? (raw.financeOsInvestownHistory as Record<string, unknown>)
          : {};

      updateSnapshot.run(
        JSON.stringify({
          ...raw,
          financeOsInvestownHistory: {
            ...previousHistory,
            realizedPnlCzk: investmentPnlCzk,
            investmentPnlCzk,
            externalRewardsCzk,
            totalGainCzk,
            interestCzk,
            otherIncomeCzk:
              investmentIncomeCzk + externalRewardsCzk,
            feesCzk,
          },
        }),
        String(account.id),
        String(snapshot.recorded_at),
      );
    }
  }
}

function backfillCanonicalAssets(db: DatabaseSync) {
  const rows = db
    .prepare(
      "SELECT id, provider, external_id, symbol, asset_class, isin, raw_json " +
        "FROM assets WHERE provider IN ('trading212', 'kraken')",
    )
    .all();

  const update = db.prepare(
    "UPDATE assets SET symbol = ?, canonical_key = ?, isin = ?, listing_symbol = ? WHERE id = ?",
  );

  for (const row of rows) {
    const provider = String(row.provider);
    const raw = parseJsonObject(row.raw_json);

    if (provider === "trading212") {
      const rawIsin =
        typeof raw.isin === "string" && raw.isin
          ? raw.isin
          : row.isin
            ? String(row.isin)
            : "";
      const shortName =
        typeof raw.shortName === "string" ? raw.shortName : "";
      const identity = canonicalSecurityIdentity(
        String(row.external_id),
        rawIsin,
        shortName,
      );
      update.run(
        identity.canonicalSymbol,
        identity.canonicalKey,
        identity.isin,
        identity.listingSymbol,
        String(row.id),
      );
      continue;
    }

    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol) continue;
    const identity = canonicalCryptoIdentity(
      symbol,
      String(row.external_id || symbol),
    );
    update.run(
      identity.canonicalSymbol,
      String(row.asset_class) === "cash"
        ? "currency:" + identity.canonicalSymbol
        : identity.canonicalKey,
      null,
      identity.listingSymbol,
      String(row.id),
    );
  }
}

export function repairStoredData(db: DatabaseSync) {
  backfillLegacyFlowScopes(db);
  repairTrading212CashSemantics(db);
  repairInvestownClassificationAudit(db);
  repairInvestownProjectIncomeBreakdown(db);
  backfillAccountCoverage(db);
  repairInvestownRealizedPnl(db);
  repairInvestownSnapshotPerformance(db);
  backfillCanonicalAssets(db);
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      provider TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'live',
      credentials_enc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      cash_value REAL NOT NULL DEFAULT 0,
      invested_value REAL NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      realized_pnl_status TEXT NOT NULL DEFAULT 'unknown',
      unrealized_pnl_status TEXT NOT NULL DEFAULT 'unknown',
      cash_value_czk REAL NOT NULL DEFAULT 0,
      invested_value_czk REAL NOT NULL DEFAULT 0,
      total_value_czk REAL NOT NULL DEFAULT 0,
      realized_pnl_czk REAL NOT NULL DEFAULT 0,
      unrealized_pnl_czk REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      currency TEXT NOT NULL,
      canonical_key TEXT,
      isin TEXT,
      listing_symbol TEXT,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      quantity REAL NOT NULL DEFAULT 0,
      average_price REAL,
      current_price REAL,
      currency TEXT NOT NULL,
      market_value REAL NOT NULL DEFAULT 0,
      market_value_czk REAL NOT NULL DEFAULT 0,
      unrealized_pnl REAL,
      unrealized_pnl_czk REAL,
      updated_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(account_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      amount_czk REAL,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      quantity REAL,
      price REAL,
      fee REAL,
      note TEXT,
      category TEXT,
      source_label TEXT,
      flow_scope TEXT NOT NULL DEFAULT 'legacy',
      counterparty_ref TEXT,
      transfer_value_czk REAL,
      raw_json TEXT,
      UNIQUE(provider, external_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recorded_at TEXT NOT NULL,
      total_value_czk REAL NOT NULL,
      cash_value_czk REAL NOT NULL,
      invested_value_czk REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'provider',
      quality TEXT NOT NULL DEFAULT 'verified',
      raw_json TEXT,
      UNIQUE(account_id, recorded_at)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_occurred
      ON transactions(occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_transactions_account_occurred
      ON transactions(account_id, occurred_at ASC);

    CREATE INDEX IF NOT EXISTS idx_holdings_account
      ON holdings(account_id);

    CREATE INDEX IF NOT EXISTS idx_snapshots_recorded
      ON snapshots(recorded_at ASC);

    CREATE INDEX IF NOT EXISTS idx_snapshots_account_recorded
      ON snapshots(account_id, recorded_at ASC);

    CREATE TABLE IF NOT EXISTS plan_targets (
      asset_class TEXT PRIMARY KEY,
      target_pct REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_journal (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      title TEXT NOT NULL,
      thesis TEXT NOT NULL,
      created_at TEXT NOT NULL,
      review_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_investment_journal_created
      ON investment_journal(created_at DESC);

    CREATE TABLE IF NOT EXISTS asset_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      price_date TEXT NOT NULL,
      close REAL NOT NULL,
      currency TEXT NOT NULL,
      close_czk REAL,
      source TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(asset_id, price_date)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_prices_asset_date
      ON asset_prices(asset_id, price_date ASC);

    CREATE TABLE IF NOT EXISTS provider_sync_state (
      provider TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(provider, key)
    );

    CREATE TABLE IF NOT EXISTS provider_sync_locks (
      provider TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (!hasColumn(db, "accounts", "realized_pnl_status")) {
    db.exec("ALTER TABLE accounts ADD COLUMN realized_pnl_status TEXT NOT NULL DEFAULT 'unknown';");
  }
  if (!hasColumn(db, "accounts", "unrealized_pnl_status")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unrealized_pnl_status TEXT NOT NULL DEFAULT 'unknown';");
  }
  if (!hasColumn(db, "assets", "canonical_key")) {
    db.exec("ALTER TABLE assets ADD COLUMN canonical_key TEXT;");
  }
  if (!hasColumn(db, "assets", "isin")) {
    db.exec("ALTER TABLE assets ADD COLUMN isin TEXT;");
  }
  if (!hasColumn(db, "assets", "listing_symbol")) {
    db.exec("ALTER TABLE assets ADD COLUMN listing_symbol TEXT;");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_assets_canonical_key ON assets(canonical_key);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_assets_isin ON assets(isin);");

  if (!hasColumn(db, "accounts", "unclassified_value")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unclassified_value REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "unclassified_value_czk")) {
    db.exec("ALTER TABLE accounts ADD COLUMN unclassified_value_czk REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "reconciliation_difference")) {
    db.exec("ALTER TABLE accounts ADD COLUMN reconciliation_difference REAL NOT NULL DEFAULT 0;");
  }
  if (!hasColumn(db, "accounts", "reconciliation_status")) {
    db.exec(
      "ALTER TABLE accounts ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'unknown';",
    );
  }

  if (!hasColumn(db, "transactions", "category")) {
    db.exec("ALTER TABLE transactions ADD COLUMN category TEXT;");
  }
  if (!hasColumn(db, "transactions", "source_label")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_label TEXT;");
  }
  if (!hasColumn(db, "transactions", "flow_scope")) {
    db.exec(
      "ALTER TABLE transactions ADD COLUMN flow_scope TEXT NOT NULL DEFAULT 'legacy';",
    );
  }
  if (!hasColumn(db, "transactions", "counterparty_ref")) {
    db.exec("ALTER TABLE transactions ADD COLUMN counterparty_ref TEXT;");
  }
  if (!hasColumn(db, "transactions", "transfer_value_czk")) {
    db.exec("ALTER TABLE transactions ADD COLUMN transfer_value_czk REAL;");
  }

  if (!hasColumn(db, "snapshots", "source")) {
    db.exec(
      "ALTER TABLE snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'provider';",
    );
  }
  if (!hasColumn(db, "snapshots", "quality")) {
    db.exec(
      "ALTER TABLE snapshots ADD COLUMN quality TEXT NOT NULL DEFAULT 'verified';",
    );
  }
  if (!hasColumn(db, "snapshots", "raw_json")) {
    db.exec("ALTER TABLE snapshots ADD COLUMN raw_json TEXT;");
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_transactions_account_kind_scope " +
      "ON transactions(account_id, kind, flow_scope, occurred_at ASC);",
  );

  repairStoredData(db);
}

export function getDb(): DatabaseSync {
  if (!globalDb.__financeOsDb) {
    const db = new DatabaseSync(getDatabasePath());
    initialize(db);
    globalDb.__financeOsDb = db;
  }

  return globalDb.__financeOsDb;
}
