import { getDb } from "@/lib/server/db";
import {
  eligibleTradeMarker,
  exchangeDate,
  parseYahooDailyChart,
  yahooTickerForAsset,
} from "@/lib/shared/position-price-chart.mjs";

const API_SOURCE = "Yahoo Finance · daily close (unofficial)";
const SUCCESS_TTL_MS = 18 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 60 * 1000;
const PENDING_TTL_MS = 90 * 1000;

export interface PositionPricePoint {
  date: string;
  close: number;
}
export interface PositionTradeMarker {
  id: string;
  date: string;
  occurredAt: string;
  kind: "buy" | "sell";
  quantity: number | null;
  price: number | null;
  priceCurrency: string;
  account: string;
  provider: string;
}
export interface PositionPriceChartData {
  assetId: string;
  asOfDate: string;
  symbol: string;
  assetClass: string;
  provider: string;
  currency: string;
  ticker: string | null;
  prices: PositionPricePoint[];
  trades: PositionTradeMarker[];
  source: string;
  firstDate: string | null;
  lastDate: string | null;
  lastImportAt: string | null;
  warning: string | null;
  alternatives: Array<{ id: string; provider: string; currency: string; label: string }>;
}

type AssetRow = {
  id: string;
  provider: string;
  external_id: string;
  symbol: string;
  listing_symbol: string | null;
  asset_class: string;
  currency: string;
  name: string;
  held_value: number;
  held_quote_currency: string | null;
};
type PriceDBRow = {
  price_date: string;
  close: number;
  currency: string;
  source: string;
  imported_at: string;
};

async function refreshHistoricalPrices(asset: AssetRow, ticker: string, quoteCurrency: string) {
  const db = getDb();
  const stateKey = "yahoo_daily:" + asset.id + ":" + quoteCurrency;
  const previous = db.prepare(
    "SELECT value FROM provider_sync_state WHERE provider = 'market_prices' AND key = ?",
  ).get(stateKey);
  const last = String(previous?.value || "");
  const [lastStatus, lastAt] = last.split("|");
  const timestamp = Date.parse(lastAt || "");
  const ttl = lastStatus === "ok" ? SUCCESS_TTL_MS
    : lastStatus === "pending" ? PENDING_TTL_MS : FAILURE_TTL_MS;
  if (Number.isFinite(timestamp) && Date.now() - timestamp < ttl) {
    if (lastStatus === "failed") return "Poslední aktualizace cen neuspěla; další pokus proběhne automaticky později";
    if (lastStatus === "pending") return "Cenová historie se právě načítá v jiném okně";
    return null;
  }
  if (process.env.FINANCEOS_EXTERNAL_PRICE_FETCH === "off") {
    return "Externí cenová data jsou v tomto prostředí vypnutá (FINANCEOS_EXTERNAL_PRICE_FETCH=off)";
  }

  // Record attempt first: simultaneous tabs must not stampede the source.
  const attemptAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO provider_sync_state(provider, key, value, updated_at) VALUES ('market_prices', ?, ?, ?) " +
    "ON CONFLICT(provider, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(stateKey, "pending|" + attemptAt, attemptAt);

  try {
    // The provider API authenticates trades, not historical market quotes.
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(ticker) + "?range=10y&interval=1d";
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FinanceOS/0.1 personal portfolio chart" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Historické ceny nejsou dostupné (HTTP " + response.status + ").");
    const payload = await response.json() as {
      chart?: { result?: unknown[]; error?: { description?: string } };
    };
    const result = payload.chart?.result?.[0];
    if (!result) {
      throw new Error(payload.chart?.error?.description || "Historické ceny nebyly nalezeny.");
    }
    const prices = parseYahooDailyChart(result, quoteCurrency, ticker) as PositionPricePoint[];
    const timezone = String((result as { meta?: { exchangeTimezoneName?: string } }).meta?.exchangeTimezoneName || "UTC");
    if (!prices.length) throw new Error("Zdroj vrátil prázdnou cenovou historii.");

    // CSV remains authoritative over the unofficial API. Prices with CZK
    // conversions from manual import are never overwritten.
    const insert = db.prepare(
      "INSERT INTO asset_prices(asset_id, price_date, close, currency, close_czk, source, imported_at) " +
      "VALUES (?, ?, ?, ?, NULL, ?, ?) " +
      "ON CONFLICT(asset_id, price_date) DO UPDATE SET " +
      "close = excluded.close, currency = excluded.currency, source = excluded.source, imported_at = excluded.imported_at " +
      "WHERE asset_prices.source = ?",
    );
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const price of prices) {
        insert.run(asset.id, price.date, price.close, quoteCurrency, API_SOURCE, now, API_SOURCE);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.prepare(
      "INSERT INTO provider_sync_state(provider, key, value, updated_at) VALUES ('market_prices', ?, ?, ?) " +
      "ON CONFLICT(provider, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run("exchange_timezone:" + asset.id + ":" + quoteCurrency, timezone, now);
    db.prepare(
      "UPDATE provider_sync_state SET value = ?, updated_at = ? WHERE provider = 'market_prices' AND key = ?",
    ).run("ok|" + now, now, stateKey);
    return null;
  } catch (error) {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE provider_sync_state SET value = ?, updated_at = ? WHERE provider = 'market_prices' AND key = ?",
    ).run("failed|" + now, now, stateKey);
    return error instanceof Error ? error.message : "Načtení cen se nezdařilo.";
  }
}

export async function getPositionPriceChart(
  symbolInput: string,
  preferredAssetId?: string,
): Promise<PositionPriceChartData | null> {
  const db = getDb();
  const symbol = symbolInput.trim().toUpperCase();
  const assets = db.prepare(
    "SELECT a.id, a.provider, a.external_id, a.symbol, a.listing_symbol, " +
    "a.asset_class, a.currency, a.name, " +
    "COALESCE((SELECT SUM(h.market_value_czk) FROM holdings h WHERE h.asset_id = a.id), 0) AS held_value, " +
    "(SELECT h.currency FROM holdings h WHERE h.asset_id = a.id ORDER BY h.market_value_czk DESC LIMIT 1) AS held_quote_currency " +
    "FROM assets a WHERE UPPER(a.symbol) = ? AND a.asset_class IN ('stock', 'etf', 'crypto', 'other') " +
    "ORDER BY held_value DESC, a.provider ASC, a.id ASC",
  ).all(symbol) as AssetRow[];
  if (!assets.length) return null;

  const asset = assets.find((row) => row.id === preferredAssetId) || assets[0];
  const preferredQuote = asset.asset_class === "crypto"
    ? (asset.held_quote_currency || asset.currency)
    : asset.currency;
  const ticker = yahooTickerForAsset({
    symbol: asset.symbol,
    provider: asset.provider,
    externalId: asset.external_id,
    listingSymbol: asset.listing_symbol,
    assetClass: asset.asset_class,
    currency: preferredQuote,
  }) as string | null;
  // A digital asset has its own denomination (e.g. BTC). Price is a
  // separate quote pair (BTC-USD or BTC-EUR), never in 'BTC per BTC'.
  const quoteCurrency = asset.asset_class === "crypto" && ticker
    ? ticker.slice(ticker.lastIndexOf("-") + 1)
    : asset.currency;

  const warning = ticker ? await refreshHistoricalPrices(asset, ticker, quoteCurrency) : null;
  const pricesFromDb = db.prepare(
    "SELECT price_date, close, currency, source, imported_at " +
    "FROM asset_prices WHERE asset_id = ? ORDER BY price_date ASC",
  ).all(asset.id) as PriceDBRow[];
  const compatible = pricesFromDb.filter((row) =>
    String(row.currency).toUpperCase() === quoteCurrency.toUpperCase() &&
    Number.isFinite(row.close) && row.close > 0,
  );
  const prices = compatible.map((row) => ({
    date: String(row.price_date), close: Number(row.close),
  }));
  const storedTimezone = db.prepare(
    "SELECT value FROM provider_sync_state WHERE provider = 'market_prices' AND key = ?",
  ).get("exchange_timezone:" + asset.id + ":" + quoteCurrency);
  const exchangeTimezone = String(storedTimezone?.value || "UTC");
    const tradesFromDb = db.prepare(
    "SELECT t.id, t.kind, t.occurred_at, t.quantity, t.price, t.currency, " +
    "a.name AS account_name, t.provider " +
    "FROM transactions t JOIN accounts a ON a.id = t.account_id " +
    "WHERE t.asset_id = ? AND t.kind IN ('buy', 'sell') " +
    "ORDER BY t.occurred_at DESC, t.id DESC LIMIT 5000",
  ).all(asset.id);
  const trades: PositionTradeMarker[] = tradesFromDb
    .filter((row) => eligibleTradeMarker({kind:row.kind, occurredAt:row.occurred_at}))
    .map((row) => ({
      id: String(row.id),
      date: exchangeDate(String(row.occurred_at), exchangeTimezone),
      occurredAt: String(row.occurred_at),
      kind: String(row.kind) as "buy" | "sell",
      quantity: row.quantity === null ? null : Number(row.quantity),
      price: row.price === null || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0
        ? null : Number(row.price),
      account: String(row.account_name),
      provider: String(row.provider),
      // T212 execution price is in the instrument currency even when the
      // wallet cash flow uses a different settlement currency.
      priceCurrency: String(row.provider) === "trading212" ? quoteCurrency : String(row.currency),
    }))
    .filter(eligibleTradeMarker)
    .reverse();
  return {
    assetId: asset.id,
    asOfDate: new Date().toISOString().slice(0, 10),
    symbol: asset.symbol,
    assetClass: asset.asset_class,
    provider: asset.provider,
    currency: quoteCurrency,
    ticker,
    prices,
    trades,
    source: [...new Set(compatible.map((row) => row.source))].join(" · "),
    firstDate: prices[0]?.date || null,
    lastDate: prices.at(-1)?.date || null,
    lastImportAt: compatible.at(-1)?.imported_at || null,
    warning,
    alternatives: assets.map((row) => ({
      id: row.id,
      provider: row.provider,
      currency: row.currency,
      label: row.name + " · " + row.provider + " · " + row.currency,
    })),
  };
}
