import { getDb } from "@/lib/server/db";
import { maybeToCzk } from "@/lib/server/fx";

type JsonObject = Record<string, unknown>;

interface PriceAsset {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  isin: string | null;
  listingSymbol: string | null;
  firstTradeDate: string;
  heldNow: boolean;
}

interface YahooQuote {
  symbol?: string;
  quoteType?: string;
}

interface YahooChartResult {
  meta?: { currency?: string; symbol?: string };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{ close?: Array<number | null> }>;
  };
  events?: {
    splits?: Record<
      string,
      {
        date?: number;
        numerator?: number;
        denominator?: number;
        splitRatio?: string;
      }
    >;
  };
}

interface PriceFetchResult {
  assetId: string;
  resolvedSymbol: string | null;
  imported: number;
  error: string | null;
}

export interface Trading212DailyHistoryResult {
  firstDate: string | null;
  lastDate: string | null;
  assetsTotal: number;
  assetsAttempted: number;
  assetsResolved: number;
  assetsPending: number;
  pricesImported: number;
  snapshotsWritten: number;
  reconstructedDays: number;
  partialDays: number;
  openingCashResidualCzk: number | null;
  quantityMismatchCount: number;
  unresolvedAssets: string[];
}

const PROVIDER = "trading212";
const PRICE_SOURCE_PREFIX = "yahoo:";
const MAX_PRICE_ASSETS_PER_SYNC = 40;
const FETCH_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 15_000;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJson(value: unknown): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object"
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function addDays(date: string, days: number) {
  const parsed = new Date(date + "T12:00:00.000Z");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function unixSeconds(date: string) {
  return Math.floor(new Date(date + "T00:00:00.000Z").getTime() / 1000);
}

function stateKey(prefix: string, assetId: string) {
  return "daily_history:" + prefix + ":" + assetId;
}

function getState(key: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT value FROM provider_sync_state WHERE provider = ? AND key = ?",
    )
    .get(PROVIDER, key);
  return row?.value === null || row?.value === undefined
    ? null
    : String(row.value);
}

function setState(key: string, value: string) {
  getDb()
    .prepare(`
      INSERT INTO provider_sync_state(provider, key, value, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(provider, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(PROVIDER, key, value, new Date().toISOString());
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FinanceOS/1.0 (local personal portfolio tracker)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function yahooCurrency(value: string) {
  const raw = value.trim();
  if (raw === "GBp" || raw.toUpperCase() === "GBX") return "GBX";
  return raw.toUpperCase();
}

async function probeYahooSymbol(symbol: string): Promise<{
  symbol: string;
  currency: string;
} | null> {
  if (!symbol) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - 7 * 24 * 60 * 60;
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?period1=" +
    from +
    "&period2=" +
    (now + 24 * 60 * 60) +
    "&interval=1d&events=splits";
  try {
    const payload = await fetchJson<{
      chart?: { result?: YahooChartResult[] | null };
    }>(url);
    const result = payload.chart?.result?.[0];
    if (!result?.meta?.symbol) return null;
    return {
      symbol: String(result.meta.symbol),
      currency: yahooCurrency(String(result.meta.currency || "")),
    };
  } catch {
    return null;
  }
}

async function resolveYahooSymbol(asset: PriceAsset): Promise<string | null> {
  const key = stateKey("yahoo_symbol", asset.id);
  const cached = getState(key);
  if (cached) {
    const parsed = safeJson(cached);
    if (typeof parsed.symbol === "string" && parsed.symbol) {
      return parsed.symbol;
    }
    if (parsed.unresolved === true) return null;
  }

  if (
    asset.currency === "USD" &&
    /^[A-Z0-9.^-]{1,16}$/i.test(asset.symbol)
  ) {
    const direct = await probeYahooSymbol(asset.symbol);
    if (direct) {
      setState(
        key,
        JSON.stringify({
          symbol: direct.symbol,
          currency: direct.currency,
          resolvedBy: "direct-symbol",
        }),
      );
      return direct.symbol;
    }
  }

  const queries = [asset.isin, asset.symbol, asset.name].filter(
    (value): value is string => Boolean(value && value.trim()),
  );

  for (const query of queries) {
    try {
      const url =
        "https://query1.finance.yahoo.com/v1/finance/search?q=" +
        encodeURIComponent(query) +
        "&quotesCount=10&newsCount=0&listsCount=0";
      const payload = await fetchJson<{ quotes?: YahooQuote[] }>(url);
      const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
      const candidates = quotes
        .filter((quote) => {
          const type = String(quote.quoteType || "").toUpperCase();
          return Boolean(quote.symbol) && ["EQUITY", "ETF"].includes(type);
        })
        .sort((left, right) => {
          const leftExact =
            String(left.symbol || "").toUpperCase() === asset.symbol.toUpperCase()
              ? 1
              : 0;
          const rightExact =
            String(right.symbol || "").toUpperCase() === asset.symbol.toUpperCase()
              ? 1
              : 0;
          return rightExact - leftExact;
        });

      for (const candidate of candidates.slice(0, 3)) {
        const probed = await probeYahooSymbol(String(candidate.symbol || ""));
        if (!probed) continue;
        setState(
          key,
          JSON.stringify({
            symbol: probed.symbol,
            currency: probed.currency,
            resolvedBy:
              query === asset.isin
                ? "isin-search"
                : query === asset.symbol
                  ? "symbol-search"
                  : "name-search",
          }),
        );
        return probed.symbol;
      }
    } catch {
      // Try the next identity candidate.
    }
  }

  setState(
    key,
    JSON.stringify({
      unresolved: true,
      attemptedAt: new Date().toISOString(),
    }),
  );
  return null;
}

function splitRatio(event: {
  numerator?: number;
  denominator?: number;
  splitRatio?: string;
}) {
  const numerator = Number(event.numerator);
  const denominator = Number(event.denominator);
  if (
    Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    numerator > 0 &&
    denominator > 0
  ) {
    return numerator / denominator;
  }

  const raw = String(event.splitRatio || "");
  const match = raw.match(/^\s*([\d.]+)\s*[:/]\s*([\d.]+)\s*$/);
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[2]);
  return Number.isFinite(left) &&
    Number.isFinite(right) &&
    left > 0 &&
    right > 0
    ? left / right
    : null;
}

async function fetchAssetPrices(
  asset: PriceAsset,
  startDate: string,
): Promise<PriceFetchResult> {
  const symbol = await resolveYahooSymbol(asset);
  if (!symbol) {
    return {
      assetId: asset.id,
      resolvedSymbol: null,
      imported: 0,
      error: "price symbol unresolved",
    };
  }

  const db = getDb();
  const existing = db
    .prepare(`
      SELECT MAX(price_date) AS last_date
      FROM asset_prices
      WHERE asset_id = ?
    `)
    .get(asset.id);
  const existingLast = existing?.last_date ? String(existing.last_date) : null;
  const today = new Date().toISOString().slice(0, 10);
  const fetchFrom =
    existingLast && existingLast >= startDate
      ? addDays(existingLast, -7)
      : addDays(startDate, -7);

  if (existingLast && existingLast >= addDays(today, -1)) {
    return {
      assetId: asset.id,
      resolvedSymbol: symbol,
      imported: 0,
      error: null,
    };
  }

  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?period1=" +
      unixSeconds(fetchFrom) +
      "&period2=" +
      unixSeconds(addDays(today, 2)) +
      "&interval=1d&events=splits";
    const payload = await fetchJson<{
      chart?: { result?: YahooChartResult[] | null };
    }>(url);
    const result = payload.chart?.result?.[0];
    if (!result) throw new Error("empty price response");

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const currency = yahooCurrency(String(result.meta?.currency || asset.currency));
    const importedAt = new Date().toISOString();
    const prepared: Array<{
      date: string;
      close: number;
      closeCzk: number | null;
    }> = [];

    for (let index = 0; index < timestamps.length; index += 1) {
      const close = Number(closes[index]);
      if (!Number.isFinite(close) || close <= 0) continue;
      const date = new Date(timestamps[index] * 1000)
        .toISOString()
        .slice(0, 10);
      const closeCzk = await maybeToCzk(close, currency, date);
      prepared.push({ date, close, closeCzk });
    }

    const splits = Object.values(result.events?.splits ?? {})
      .map((event) => {
        const ratio = splitRatio(event);
        const dateValue = Number(event.date);
        if (!ratio || !Number.isFinite(dateValue)) return null;
        return {
          date: new Date(dateValue * 1000).toISOString().slice(0, 10),
          ratio,
        };
      })
      .filter(
        (item): item is { date: string; ratio: number } => item !== null,
      );

    const previousSplits = safeJson(getState(stateKey("splits", asset.id)));
    const mergedSplits = new Map<string, number>();
    if (Array.isArray(previousSplits.items)) {
      for (const item of previousSplits.items) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (
          typeof row.date === "string" &&
          Number.isFinite(Number(row.ratio))
        ) {
          mergedSplits.set(row.date, Number(row.ratio));
        }
      }
    }
    for (const item of splits) mergedSplits.set(item.date, item.ratio);
    setState(
      stateKey("splits", asset.id),
      JSON.stringify({
        items: [...mergedSplits]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, ratio]) => ({ date, ratio })),
      }),
    );

    const insert = db.prepare(`
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

    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const row of prepared) {
        insert.run(
          asset.id,
          row.date,
          row.close,
          currency,
          row.closeCzk,
          PRICE_SOURCE_PREFIX + symbol,
          importedAt,
        );
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }

    return {
      assetId: asset.id,
      resolvedSymbol: symbol,
      imported: prepared.length,
      error: null,
    };
  } catch (error) {
    return {
      assetId: asset.id,
      resolvedSymbol: symbol,
      imported: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapLimited<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(limit, values.length)) },
      () => worker(),
    ),
  );
  return results;
}

function quantityDelta(kind: string, quantity: number) {
  if (!Number.isFinite(quantity) || quantity === 0) return 0;
  if (kind === "buy") return Math.abs(quantity);
  if (kind === "sell") return -Math.abs(quantity);
  if (kind === "transfer" || kind === "adjustment") return quantity;
  return 0;
}

function approximatelyEqual(left: number, right: number) {
  const tolerance = Math.max(
    1e-8,
    Math.abs(left) * 1e-6,
    Math.abs(right) * 1e-6,
  );
  return Math.abs(left - right) <= tolerance;
}

function listCalendarDays(first: string, last: string) {
  const days: string[] = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

export async function syncTrading212DailyHistory(
  accountId: string,
): Promise<Trading212DailyHistoryResult> {
  const db = getDb();
  const account = db
    .prepare(`
      SELECT id, cash_value_czk, total_value_czk, raw_json
      FROM accounts
      WHERE id = ? AND provider = 'trading212'
      LIMIT 1
    `)
    .get(accountId);
  if (!account) throw new Error("Trading 212 account not found.");

  const transactionRange = db
    .prepare(`
      SELECT MIN(substr(occurred_at, 1, 10)) AS first_date,
             MAX(substr(occurred_at, 1, 10)) AS last_date
      FROM transactions
      WHERE account_id = ?
        AND provider = 'trading212'
        AND COALESCE(raw_json, '') NOT LIKE '%"enrichmentOnly":true%'
    `)
    .get(accountId);
  const firstDate = transactionRange?.first_date
    ? String(transactionRange.first_date)
    : null;
  const today = new Date().toISOString().slice(0, 10);

  if (!firstDate) {
    return {
      firstDate: null,
      lastDate: null,
      assetsTotal: 0,
      assetsAttempted: 0,
      assetsResolved: 0,
      assetsPending: 0,
      pricesImported: 0,
      snapshotsWritten: 0,
      reconstructedDays: 0,
      partialDays: 0,
      openingCashResidualCzk: null,
      quantityMismatchCount: 0,
      unresolvedAssets: [],
    };
  }

  const assetRows = db
    .prepare(`
      SELECT
        a.id, a.symbol, a.name, a.currency, a.isin, a.listing_symbol,
        MIN(substr(t.occurred_at, 1, 10)) AS first_trade_date,
        CASE WHEN h.id IS NULL THEN 0 ELSE 1 END AS held_now
      FROM transactions t
      JOIN assets a ON a.id = t.asset_id
      LEFT JOIN holdings h
        ON h.account_id = t.account_id
       AND h.asset_id = t.asset_id
       AND ABS(h.quantity) > 1e-12
      WHERE t.account_id = ?
        AND t.provider = 'trading212'
        AND t.quantity IS NOT NULL
        AND t.kind IN ('buy', 'sell', 'transfer', 'adjustment')
      GROUP BY
        a.id, a.symbol, a.name, a.currency, a.isin, a.listing_symbol,
        held_now
      ORDER BY held_now DESC, first_trade_date ASC, a.symbol ASC
    `)
    .all(accountId);

  const assets: PriceAsset[] = assetRows.map((row) => ({
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    currency: String(row.currency).toUpperCase(),
    isin: row.isin ? String(row.isin) : null,
    listingSymbol: row.listing_symbol ? String(row.listing_symbol) : null,
    firstTradeDate: String(row.first_trade_date),
    heldNow: num(row.held_now) > 0,
  }));

  const needsPriceRefresh = assets.filter((asset) => {
    const coverage = db
      .prepare(`
        SELECT MIN(price_date) AS first_date, MAX(price_date) AS last_date
        FROM asset_prices
        WHERE asset_id = ?
          AND close_czk IS NOT NULL
      `)
      .get(asset.id);
    const first = coverage?.first_date ? String(coverage.first_date) : null;
    const last = coverage?.last_date ? String(coverage.last_date) : null;
    return (
      !first ||
      first > asset.firstTradeDate ||
      !last ||
      last < addDays(today, -1)
    );
  });

  const attempted = needsPriceRefresh.slice(0, MAX_PRICE_ASSETS_PER_SYNC);
  const priceResults = await mapLimited(
    attempted,
    FETCH_CONCURRENCY,
    (asset) => fetchAssetPrices(asset, asset.firstTradeDate),
  );
  const pricesImported = priceResults.reduce(
    (sum, item) => sum + item.imported,
    0,
  );

  const unresolvedAssets = assets
    .filter((asset) => {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS count FROM asset_prices WHERE asset_id = ? AND close_czk IS NOT NULL",
        )
        .get(asset.id);
      return num(row?.count) === 0;
    })
    .map((asset) => asset.symbol);
  const resolvedAssets = assets.length - unresolvedAssets.length;

  const quantityRows = db
    .prepare(`
      SELECT
        asset_id, kind, substr(occurred_at, 1, 10) AS day, quantity
      FROM transactions
      WHERE account_id = ?
        AND provider = 'trading212'
        AND asset_id IS NOT NULL
        AND quantity IS NOT NULL
        AND kind IN ('buy', 'sell', 'transfer', 'adjustment')
      ORDER BY occurred_at ASC
    `)
    .all(accountId);

  const quantityEvents = new Map<
    string,
    Array<{ date: string; delta: number }>
  >();
  for (const row of quantityRows) {
    const assetId = String(row.asset_id);
    const delta = quantityDelta(String(row.kind), num(row.quantity));
    if (delta === 0) continue;
    const items = quantityEvents.get(assetId) ?? [];
    items.push({ date: String(row.day), delta });
    quantityEvents.set(assetId, items);
  }

  const splitsByAsset = new Map<
    string,
    Array<{ date: string; ratio: number }>
  >();
  for (const asset of assets) {
    const parsed = safeJson(getState(stateKey("splits", asset.id)));
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    splitsByAsset.set(
      asset.id,
      items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const ratio = Number(row.ratio);
          return typeof row.date === "string" &&
            Number.isFinite(ratio) &&
            ratio > 0
            ? { date: row.date, ratio }
            : null;
        })
        .filter(
          (item): item is { date: string; ratio: number } => item !== null,
        )
        .sort((left, right) => left.date.localeCompare(right.date)),
    );
  }

  const calendarDays = listCalendarDays(firstDate, today);
  const finalQuantities = new Map<string, number>();
  for (const asset of assets) {
    let quantity = 0;
    let eventIndex = 0;
    let splitIndex = 0;
    const events = quantityEvents.get(asset.id) ?? [];
    const splits = splitsByAsset.get(asset.id) ?? [];
    for (const date of calendarDays) {
      while (splitIndex < splits.length && splits[splitIndex].date === date) {
        quantity *= splits[splitIndex].ratio;
        splitIndex += 1;
      }
      while (eventIndex < events.length && events[eventIndex].date === date) {
        quantity += events[eventIndex].delta;
        eventIndex += 1;
      }
    }
    finalQuantities.set(asset.id, quantity);
  }

  const holdingRows = db
    .prepare(`
      SELECT asset_id, quantity
      FROM holdings
      WHERE account_id = ?
    `)
    .all(accountId);
  const holdingByAsset = new Map(
    holdingRows.map((row) => [String(row.asset_id), num(row.quantity)]),
  );
  const quantityMismatchAssets = new Set<string>();
  for (const asset of assets) {
    const reconstructed = finalQuantities.get(asset.id) ?? 0;
    const current = holdingByAsset.get(asset.id) ?? 0;
    if (!approximatelyEqual(reconstructed, current)) {
      quantityMismatchAssets.add(asset.id);
    }
  }

  const priceRows = db
    .prepare(`
      SELECT asset_id, price_date, close_czk
      FROM asset_prices
      WHERE asset_id IN (
        SELECT DISTINCT asset_id
        FROM transactions
        WHERE account_id = ?
          AND provider = 'trading212'
          AND asset_id IS NOT NULL
      )
        AND close_czk IS NOT NULL
      ORDER BY price_date ASC
    `)
    .all(accountId);
  const pricesByDate = new Map<
    string,
    Array<{ assetId: string; closeCzk: number }>
  >();
  for (const row of priceRows) {
    const date = String(row.price_date);
    const items = pricesByDate.get(date) ?? [];
    items.push({
      assetId: String(row.asset_id),
      closeCzk: num(row.close_czk),
    });
    pricesByDate.set(date, items);
  }

  const cashRows = db
    .prepare(`
      SELECT substr(occurred_at, 1, 10) AS day, amount_czk
      FROM transactions
      WHERE account_id = ?
        AND provider = 'trading212'
        AND amount_czk IS NOT NULL
        AND COALESCE(raw_json, '') NOT LIKE '%"enrichmentOnly":true%'
      ORDER BY occurred_at ASC
    `)
    .all(accountId);
  const cashByDate = new Map<string, number>();
  let totalCashImpact = 0;
  for (const row of cashRows) {
    const amount = num(row.amount_czk);
    const date = String(row.day);
    totalCashImpact += amount;
    cashByDate.set(date, (cashByDate.get(date) ?? 0) + amount);
  }
  const currentCashCzk = num(account.cash_value_czk);
  const openingCashResidualCzk = currentCashCzk - totalCashImpact;
  const cashResidualTolerance = Math.max(
    100,
    Math.abs(num(account.total_value_czk)) * 0.002,
  );
  const cashHistoryComplete =
    Math.abs(openingCashResidualCzk) <= cashResidualTolerance;

  db.prepare(
    "DELETE FROM snapshots WHERE account_id = ? AND source = 'reconstructed'",
  ).run(accountId);

  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots(
      account_id, recorded_at, total_value_czk, cash_value_czk,
      invested_value_czk, source, quality, raw_json
    )
    VALUES(?, ?, ?, ?, ?, 'reconstructed', ?, ?)
    ON CONFLICT(account_id, recorded_at) DO UPDATE SET
      total_value_czk = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.total_value_czk
        ELSE excluded.total_value_czk
      END,
      cash_value_czk = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.cash_value_czk
        ELSE excluded.cash_value_czk
      END,
      invested_value_czk = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.invested_value_czk
        ELSE excluded.invested_value_czk
      END,
      source = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.source
        ELSE excluded.source
      END,
      quality = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.quality
        ELSE excluded.quality
      END,
      raw_json = CASE
        WHEN snapshots.source = 'provider'
        THEN snapshots.raw_json
        ELSE excluded.raw_json
      END
  `);

  const quantity = new Map<string, number>();
  const eventIndexes = new Map<string, number>();
  const splitIndexes = new Map<string, number>();
  const lastPrices = new Map<string, number>();
  let cash = openingCashResidualCzk;
  let snapshotsWritten = 0;
  let reconstructedDays = 0;
  let partialDays = 0;

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const date of calendarDays) {
      cash += cashByDate.get(date) ?? 0;

      for (const asset of assets) {
        let currentQuantity = quantity.get(asset.id) ?? 0;
        const splits = splitsByAsset.get(asset.id) ?? [];
        let splitIndex = splitIndexes.get(asset.id) ?? 0;
        while (
          splitIndex < splits.length &&
          splits[splitIndex].date === date
        ) {
          currentQuantity *= splits[splitIndex].ratio;
          splitIndex += 1;
        }
        splitIndexes.set(asset.id, splitIndex);

        const events = quantityEvents.get(asset.id) ?? [];
        let eventIndex = eventIndexes.get(asset.id) ?? 0;
        while (
          eventIndex < events.length &&
          events[eventIndex].date === date
        ) {
          currentQuantity += events[eventIndex].delta;
          eventIndex += 1;
        }
        eventIndexes.set(asset.id, eventIndex);
        quantity.set(asset.id, currentQuantity);
      }

      for (const price of pricesByDate.get(date) ?? []) {
        lastPrices.set(price.assetId, price.closeCzk);
      }

      let invested = 0;
      const missingPrices: string[] = [];
      const quantityMismatchHeld: string[] = [];

      for (const asset of assets) {
        const held = quantity.get(asset.id) ?? 0;
        if (Math.abs(held) <= 1e-12) continue;
        const price = lastPrices.get(asset.id);
        if (price === undefined || !Number.isFinite(price)) {
          missingPrices.push(asset.symbol);
          continue;
        }
        invested += held * price;
        if (quantityMismatchAssets.has(asset.id)) {
          quantityMismatchHeld.push(asset.symbol);
        }
      }

      const quality =
        missingPrices.length === 0 &&
        quantityMismatchHeld.length === 0 &&
        cashHistoryComplete
          ? "reconstructed"
          : "partial";
      if (quality === "partial") partialDays += 1;
      else reconstructedDays += 1;

      const total = cash + invested;
      insertSnapshot.run(
        accountId,
        date,
        total,
        cash,
        invested,
        quality,
        JSON.stringify({
          source: "daily-history-reconstruction",
          priceSource: "Yahoo Finance chart",
          reconstructedAt: new Date().toISOString(),
          missingPrices,
          quantityMismatchAssets: quantityMismatchHeld,
          openingCashResidualCzk,
          cashHistoryComplete,
        }),
      );
      snapshotsWritten += 1;
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    firstDate,
    lastDate: today,
    assetsTotal: assets.length,
    assetsAttempted: attempted.length,
    assetsResolved: resolvedAssets,
    assetsPending: Math.max(0, needsPriceRefresh.length - attempted.length),
    pricesImported,
    snapshotsWritten,
    reconstructedDays,
    partialDays,
    openingCashResidualCzk,
    cashHistoryComplete,
    quantityMismatchCount: quantityMismatchAssets.size,
    unresolvedAssets,
    methodology: "transactions + daily closes + CNB historical FX",
    priceSource: "Yahoo Finance chart (best-effort external market data)",
  };

  const accountRaw = safeJson(account.raw_json);
  db.prepare("UPDATE accounts SET raw_json = ? WHERE id = ?").run(
    JSON.stringify({
      ...accountRaw,
      financeOsHistoricalReconstruction: metadata,
    }),
    accountId,
  );
  setState("daily_history:last_result", JSON.stringify(metadata));

  return {
    firstDate,
    lastDate: today,
    assetsTotal: assets.length,
    assetsAttempted: attempted.length,
    assetsResolved: resolvedAssets,
    assetsPending: Math.max(0, needsPriceRefresh.length - attempted.length),
    pricesImported,
    snapshotsWritten,
    reconstructedDays,
    partialDays,
    openingCashResidualCzk,
    quantityMismatchCount: quantityMismatchAssets.size,
    unresolvedAssets,
  };
}
