import { getDb, repairStoredData } from "@/lib/server/db";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row => Boolean(item) && typeof item === "object",
      )
    : [];
}

function value(row: Row, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null;
}

export function restoreExport(input: unknown) {
  if (!input || typeof input !== "object") {
    throw new Error("Backup must be a JSON object.");
  }

  const backup = input as Record<string, unknown>;
  const version = Number(backup.version);
  if (![1, 2].includes(version)) {
    throw new Error("Unsupported FinanceOS backup version.");
  }

  const accounts = rows(backup.accounts);
  const assets = rows(backup.assets);
  const holdings = rows(backup.holdings);
  const transactions = rows(backup.transactions);
  const snapshots = rows(backup.snapshots);
  const assetPrices = rows(backup.assetPrices);
  const planTargets = rows(backup.planTargets);
  const planSettings = rows(backup.planSettings);
  const investmentJournal = rows(backup.investmentJournal);

  if (
    accounts.length > 1000 ||
    assets.length > 100_000 ||
    holdings.length > 100_000 ||
    transactions.length > 500_000 ||
    snapshots.length > 500_000 ||
    assetPrices.length > 2_000_000 ||
    planTargets.length > 100 ||
    planSettings.length > 100 ||
    investmentJournal.length > 10_000
  ) {
    throw new Error("Backup exceeds FinanceOS safety limits.");
  }

  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");

  try {
    const accountStatement = db.prepare(`
      INSERT INTO accounts(
        id, provider, external_id, name, type, currency,
        cash_value, invested_value, total_value, realized_pnl, unrealized_pnl,
        realized_pnl_status, unrealized_pnl_status,
        cash_value_czk, invested_value_czk, total_value_czk,
        realized_pnl_czk, unrealized_pnl_czk,
        unclassified_value, unclassified_value_czk,
        reconciliation_difference, reconciliation_status,
        updated_at, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        external_id = excluded.external_id,
        name = excluded.name,
        type = excluded.type,
        currency = excluded.currency,
        cash_value = excluded.cash_value,
        invested_value = excluded.invested_value,
        total_value = excluded.total_value,
        realized_pnl = excluded.realized_pnl,
        unrealized_pnl = excluded.unrealized_pnl,
        realized_pnl_status = excluded.realized_pnl_status,
        unrealized_pnl_status = excluded.unrealized_pnl_status,
        cash_value_czk = excluded.cash_value_czk,
        invested_value_czk = excluded.invested_value_czk,
        total_value_czk = excluded.total_value_czk,
        realized_pnl_czk = excluded.realized_pnl_czk,
        unrealized_pnl_czk = excluded.unrealized_pnl_czk,
        unclassified_value = excluded.unclassified_value,
        unclassified_value_czk = excluded.unclassified_value_czk,
        reconciliation_difference = excluded.reconciliation_difference,
        reconciliation_status = excluded.reconciliation_status,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `);

    for (const row of accounts) {
      if (!value(row, "id") || !value(row, "provider")) continue;
      accountStatement.run(
        value(row, "id"),
        value(row, "provider"),
        value(row, "external_id"),
        value(row, "name"),
        value(row, "type"),
        value(row, "currency"),
        value(row, "cash_value"),
        value(row, "invested_value"),
        value(row, "total_value"),
        value(row, "realized_pnl"),
        value(row, "unrealized_pnl"),
        value(row, "realized_pnl_status") ?? "unknown",
        value(row, "unrealized_pnl_status") ?? "unknown",
        value(row, "cash_value_czk"),
        value(row, "invested_value_czk"),
        value(row, "total_value_czk"),
        value(row, "realized_pnl_czk"),
        value(row, "unrealized_pnl_czk"),
        value(row, "unclassified_value") ?? 0,
        value(row, "unclassified_value_czk") ?? 0,
        value(row, "reconciliation_difference") ?? 0,
        value(row, "reconciliation_status") ?? "unknown",
        value(row, "updated_at"),
        value(row, "raw_json"),
      );
    }

    const assetStatement = db.prepare(`
      INSERT INTO assets(
        id, provider, external_id, symbol, name, asset_class, currency,
        canonical_key, isin, listing_symbol, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        external_id = excluded.external_id,
        symbol = excluded.symbol,
        name = excluded.name,
        asset_class = excluded.asset_class,
        currency = excluded.currency,
        canonical_key = excluded.canonical_key,
        isin = excluded.isin,
        listing_symbol = excluded.listing_symbol,
        raw_json = excluded.raw_json
    `);

    for (const row of assets) {
      if (!value(row, "id") || !value(row, "provider")) continue;
      assetStatement.run(
        value(row, "id"),
        value(row, "provider"),
        value(row, "external_id"),
        value(row, "symbol"),
        value(row, "name"),
        value(row, "asset_class"),
        value(row, "currency"),
        value(row, "canonical_key"),
        value(row, "isin"),
        value(row, "listing_symbol") ?? value(row, "symbol"),
        value(row, "raw_json"),
      );
    }

    const holdingStatement = db.prepare(`
      INSERT INTO holdings(
        id, account_id, asset_id, quantity, average_price, current_price,
        currency, market_value, market_value_czk, unrealized_pnl,
        unrealized_pnl_czk, updated_at, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        asset_id = excluded.asset_id,
        quantity = excluded.quantity,
        average_price = excluded.average_price,
        current_price = excluded.current_price,
        currency = excluded.currency,
        market_value = excluded.market_value,
        market_value_czk = excluded.market_value_czk,
        unrealized_pnl = excluded.unrealized_pnl,
        unrealized_pnl_czk = excluded.unrealized_pnl_czk,
        updated_at = excluded.updated_at,
        raw_json = excluded.raw_json
    `);

    for (const row of holdings) {
      if (!value(row, "id") || !value(row, "account_id") || !value(row, "asset_id")) {
        continue;
      }
      holdingStatement.run(
        value(row, "id"),
        value(row, "account_id"),
        value(row, "asset_id"),
        value(row, "quantity"),
        value(row, "average_price"),
        value(row, "current_price"),
        value(row, "currency"),
        value(row, "market_value"),
        value(row, "market_value_czk"),
        value(row, "unrealized_pnl"),
        value(row, "unrealized_pnl_czk"),
        value(row, "updated_at"),
        value(row, "raw_json"),
      );
    }

    const transactionStatement = db.prepare(`
      INSERT INTO transactions(
        id, provider, account_id, external_id, kind, occurred_at, currency,
        amount, amount_czk, asset_id, quantity, price, fee, note,
        category, source_label, flow_scope, counterparty_ref,
        transfer_value_czk, raw_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        account_id = excluded.account_id,
        external_id = excluded.external_id,
        kind = excluded.kind,
        occurred_at = excluded.occurred_at,
        currency = excluded.currency,
        amount = excluded.amount,
        amount_czk = excluded.amount_czk,
        asset_id = excluded.asset_id,
        quantity = excluded.quantity,
        price = excluded.price,
        fee = excluded.fee,
        note = excluded.note,
        category = excluded.category,
        source_label = excluded.source_label,
        flow_scope = excluded.flow_scope,
        counterparty_ref = excluded.counterparty_ref,
        transfer_value_czk = excluded.transfer_value_czk,
        raw_json = excluded.raw_json
    `);

    for (const row of transactions) {
      if (!value(row, "id") || !value(row, "provider") || !value(row, "account_id")) {
        continue;
      }
      transactionStatement.run(
        value(row, "id"),
        value(row, "provider"),
        value(row, "account_id"),
        value(row, "external_id"),
        value(row, "kind"),
        value(row, "occurred_at"),
        value(row, "currency"),
        value(row, "amount"),
        value(row, "amount_czk"),
        value(row, "asset_id"),
        value(row, "quantity"),
        value(row, "price"),
        value(row, "fee"),
        value(row, "note"),
        value(row, "category"),
        value(row, "source_label"),
        value(row, "flow_scope") ?? "legacy",
        value(row, "counterparty_ref"),
        value(row, "transfer_value_czk"),
        value(row, "raw_json"),
      );
    }

    const snapshotStatement = db.prepare(`
      INSERT INTO snapshots(
        account_id, recorded_at, total_value_czk, cash_value_czk, invested_value_czk
      )
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(account_id, recorded_at) DO UPDATE SET
        total_value_czk = excluded.total_value_czk,
        cash_value_czk = excluded.cash_value_czk,
        invested_value_czk = excluded.invested_value_czk
    `);

    for (const row of snapshots) {
      if (!value(row, "account_id") || !value(row, "recorded_at")) continue;
      snapshotStatement.run(
        value(row, "account_id"),
        value(row, "recorded_at"),
        value(row, "total_value_czk"),
        value(row, "cash_value_czk"),
        value(row, "invested_value_czk"),
      );
    }

    const assetPriceStatement = db.prepare(`
      INSERT INTO asset_prices(
        asset_id, price_date, close, currency, close_czk, source, imported_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, price_date) DO UPDATE SET
        close = excluded.close,
        currency = excluded.currency,
        close_czk = excluded.close_czk,
        source = excluded.source,
        imported_at = excluded.imported_at
    `);

    for (const row of assetPrices) {
      if (!value(row, "asset_id") || !value(row, "price_date")) continue;
      assetPriceStatement.run(
        value(row, "asset_id"),
        value(row, "price_date"),
        value(row, "close"),
        value(row, "currency"),
        value(row, "close_czk"),
        value(row, "source"),
        value(row, "imported_at"),
      );
    }

    const planTargetStatement = db.prepare(`
      INSERT INTO plan_targets(asset_class, target_pct, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(asset_class) DO UPDATE SET
        target_pct = excluded.target_pct,
        updated_at = excluded.updated_at
    `);

    for (const row of planTargets) {
      if (!value(row, "asset_class")) continue;
      planTargetStatement.run(
        value(row, "asset_class"),
        value(row, "target_pct"),
        value(row, "updated_at"),
      );
    }

    const planSettingStatement = db.prepare(`
      INSERT INTO plan_settings(key, value, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    for (const row of planSettings) {
      if (!value(row, "key")) continue;
      planSettingStatement.run(
        value(row, "key"),
        value(row, "value"),
        value(row, "updated_at"),
      );
    }

    const journalStatement = db.prepare(`
      INSERT INTO investment_journal(
        id, symbol, title, thesis, created_at, review_at, status
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        symbol = excluded.symbol,
        title = excluded.title,
        thesis = excluded.thesis,
        created_at = excluded.created_at,
        review_at = excluded.review_at,
        status = excluded.status
    `);

    for (const row of investmentJournal) {
      if (!value(row, "id") || !value(row, "title")) continue;
      journalStatement.run(
        value(row, "id"),
        value(row, "symbol"),
        value(row, "title"),
        value(row, "thesis"),
        value(row, "created_at"),
        value(row, "review_at"),
        value(row, "status"),
      );
    }

    repairStoredData(db);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    accounts: accounts.length,
    assets: assets.length,
    holdings: holdings.length,
    transactions: transactions.length,
    snapshots: snapshots.length,
    assetPrices: assetPrices.length,
    planTargets: planTargets.length,
    planSettings: planSettings.length,
    investmentJournal: investmentJournal.length,
  };
}
