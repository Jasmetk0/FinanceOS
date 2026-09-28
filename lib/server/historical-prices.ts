import { getDb } from "@/lib/server/db";
import { maybeToCzk } from "@/lib/server/fx";

export interface HistoricalPriceRow {
  date: string;
  close: number;
  currency?: string;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function listPriceImportAssets() {
  return getDb()
    .prepare(
      "SELECT id, provider, external_id, symbol, name, asset_class, currency FROM assets ORDER BY symbol ASC, provider ASC",
    )
    .all()
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      externalId: String(row.external_id),
      symbol: String(row.symbol),
      name: String(row.name),
      assetClass: String(row.asset_class),
      currency: String(row.currency),
    }));
}

export async function importHistoricalPrices(input: {
  assetId: string;
  defaultCurrency?: string;
  source?: string;
  rows: HistoricalPriceRow[];
}) {
  const assetId = input.assetId.trim();
  if (!assetId) throw new Error("Asset is required.");
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("No historical price rows were provided.");
  }
  if (input.rows.length > 25_000) {
    throw new Error("A single price import is limited to 25,000 rows.");
  }

  const db = getDb();
  const asset = db
    .prepare("SELECT id, symbol, currency FROM assets WHERE id = ?")
    .get(assetId);

  if (!asset) throw new Error("Selected asset does not exist.");

  const defaultCurrency = String(
    input.defaultCurrency || asset.currency || "USD",
  )
    .trim()
    .toUpperCase();
  const source = String(input.source || "CSV import").trim() || "CSV import";
  const importedAt = new Date().toISOString();

  const statement = db.prepare(
    "INSERT INTO asset_prices(asset_id, price_date, close, currency, close_czk, source, imported_at) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, price_date) DO UPDATE SET close = excluded.close, currency = excluded.currency, close_czk = excluded.close_czk, source = excluded.source, imported_at = excluded.imported_at",
  );

  let imported = 0;
  let skipped = 0;

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of input.rows) {
      const date = new Date(row.date);
      const close = Number(row.close);
      const currency = String(row.currency || defaultCurrency)
        .trim()
        .toUpperCase();

      if (
        Number.isNaN(date.getTime()) ||
        !Number.isFinite(close) ||
        close <= 0 ||
        !currency
      ) {
        skipped += 1;
        continue;
      }

      const priceDate = date.toISOString().slice(0, 10);
      const closeCzk = await maybeToCzk(close, currency, priceDate);

      statement.run(
        assetId,
        priceDate,
        close,
        currency,
        closeCzk,
        source,
        importedAt,
      );
      imported += 1;
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    assetId,
    symbol: String(asset.symbol),
    imported,
    skipped,
    totalRows: input.rows.length,
  };
}

export function getPriceCoverage() {
  return getDb()
    .prepare(
      "SELECT a.id, a.provider, a.symbol, a.name, a.asset_class, COUNT(p.id) AS price_count, MIN(p.price_date) AS first_price, MAX(p.price_date) AS last_price, SUM(CASE WHEN p.close_czk IS NULL THEN 1 ELSE 0 END) AS missing_czk FROM assets a LEFT JOIN asset_prices p ON p.asset_id = a.id GROUP BY a.id, a.provider, a.symbol, a.name, a.asset_class HAVING price_count > 0 ORDER BY a.symbol ASC, a.provider ASC",
    )
    .all()
    .map((row) => ({
      assetId: String(row.id),
      provider: String(row.provider),
      symbol: String(row.symbol),
      name: String(row.name),
      assetClass: String(row.asset_class),
      priceCount: num(row.price_count),
      firstPrice: row.first_price ? String(row.first_price) : null,
      lastPrice: row.last_price ? String(row.last_price) : null,
      missingCzk: num(row.missing_czk),
    }));
}

function quantityDelta(kind: string, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity === 0) return 0;

  if (kind === "buy") return Math.abs(quantity);
  if (kind === "sell") return -Math.abs(quantity);

  // Kraken non-trade ledger rows persist signed asset-unit quantities.
  if (
    [
      "deposit",
      "withdrawal",
      "interest",
      "transfer",
      "adjustment",
    ].includes(kind)
  ) {
    return quantity;
  }

  return 0;
}

export function reconstructPricedHoldingsHistory() {
  const db = getDb();

  const priceDates = db
    .prepare(
      "SELECT DISTINCT price_date FROM asset_prices WHERE close_czk IS NOT NULL ORDER BY price_date ASC",
    )
    .all()
    .map((row) => String(row.price_date));

  if (!priceDates.length) {
    return {
      series: [] as Array<{
        date: string;
        valueCzk: number;
        pricedAssets: number;
      }>,
      assetCoverage: getPriceCoverage(),
    };
  }

  const assets = db
    .prepare(
      "SELECT DISTINCT a.id FROM assets a JOIN asset_prices p ON p.asset_id = a.id WHERE p.close_czk IS NOT NULL",
    )
    .all()
    .map((row) => String(row.id));

  const eventsByAsset = new Map<
    string,
    Array<{ date: string; delta: number }>
  >();

  for (const assetId of assets) {
    const events = db
      .prepare(
        "SELECT kind, occurred_at, quantity FROM transactions WHERE asset_id = ? AND quantity IS NOT NULL ORDER BY occurred_at ASC",
      )
      .all(assetId)
      .map((row) => ({
        date: String(row.occurred_at).slice(0, 10),
        delta: quantityDelta(String(row.kind), num(row.quantity)),
      }))
      .filter((event) => event.delta !== 0);

    eventsByAsset.set(assetId, events);
  }

  const priceByAssetDate = new Map<string, Map<string, number>>();
  for (const assetId of assets) {
    const rows = db
      .prepare(
        "SELECT price_date, close_czk FROM asset_prices WHERE asset_id = ? AND close_czk IS NOT NULL ORDER BY price_date ASC",
      )
      .all(assetId);

    priceByAssetDate.set(
      assetId,
      new Map(
        rows.map((row) => [
          String(row.price_date),
          num(row.close_czk),
        ]),
      ),
    );
  }

  const quantities = new Map<string, number>();
  const eventIndexes = new Map<string, number>();
  const lastPrices = new Map<string, number>();
  const series: Array<{
    date: string;
    valueCzk: number;
    pricedAssets: number;
  }> = [];

  for (const date of priceDates) {
    let total = 0;
    let pricedAssets = 0;

    for (const assetId of assets) {
      const events = eventsByAsset.get(assetId) ?? [];
      let index = eventIndexes.get(assetId) ?? 0;
      let quantity = quantities.get(assetId) ?? 0;

      while (index < events.length && events[index].date <= date) {
        quantity += events[index].delta;
        index += 1;
      }

      quantities.set(assetId, quantity);
      eventIndexes.set(assetId, index);

      const exactPrice = priceByAssetDate.get(assetId)?.get(date);
      if (exactPrice !== undefined) {
        lastPrices.set(assetId, exactPrice);
      }

      const price = lastPrices.get(assetId);
      if (
        price !== undefined &&
        Number.isFinite(price) &&
        Math.abs(quantity) > 1e-12
      ) {
        total += quantity * price;
        pricedAssets += 1;
      }
    }

    series.push({
      date,
      valueCzk: total,
      pricedAssets,
    });
  }

  return {
    series,
    assetCoverage: getPriceCoverage(),
  };
}
