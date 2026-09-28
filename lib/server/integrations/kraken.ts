import crypto from "node:crypto";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  assetId,
  getConnectionSecret,
  recordSnapshot,
  replaceHoldings,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";
import type { TransactionKind } from "@/lib/domain";
import { getDb } from "@/lib/server/db";

type JsonObject = Record<string, unknown>;

export interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

let nonceCounter = 0;
let assetPairsCache:
  | { fetchedAt: number; pairs: Record<string, JsonObject> }
  | null = null;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function nextNonce(): string {
  const now = Date.now() * 1000;
  nonceCounter = Math.max(nonceCounter + 1, now);
  return String(nonceCounter);
}

function sign(path: string, body: URLSearchParams, secret: string): string {
  const encoded = body.toString();
  const nonce = body.get("nonce") ?? "";
  const hash = crypto
    .createHash("sha256")
    .update(nonce + encoded)
    .digest();
  const message = Buffer.concat([Buffer.from(path, "utf8"), hash]);
  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(message)
    .digest("base64");
}

async function privateRequest<T>(
  path: string,
  credentials: KrakenCredentials,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const body = new URLSearchParams();
  body.set("nonce", nextNonce());

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }

  const response = await fetch(`https://api.kraken.com${path}`, {
    method: "POST",
    headers: {
      "API-Key": credentials.apiKey,
      "API-Sign": sign(path, body, credentials.apiSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const json = (await response.json()) as {
    error?: unknown[];
    result?: T;
  };

  if (!response.ok) {
    throw new Error(`Kraken request failed with HTTP ${response.status}.`);
  }

  const errors = Array.isArray(json.error) ? json.error.map(String).filter(Boolean) : [];
  if (errors.length) {
    throw new Error(`Kraken: ${errors.join("; ")}`);
  }

  return json.result as T;
}

async function publicRequest<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.kraken.com${path}`, {
    cache: "no-store",
  });
  const json = (await response.json()) as { error?: unknown[]; result?: T };
  const errors = Array.isArray(json.error) ? json.error.map(String).filter(Boolean) : [];
  if (!response.ok || errors.length) {
    throw new Error(
      errors.length
        ? `Kraken: ${errors.join("; ")}`
        : `Kraken public request failed with HTTP ${response.status}.`,
    );
  }
  return json.result as T;
}

function stripBalanceSuffix(asset: string): string {
  return asset.split(".")[0];
}

function normalizeAssetCode(asset: string): string {
  const base = stripBalanceSuffix(asset).toUpperCase();
  if (base === "XXBT" || base === "XBT") return "BTC";
  if (base === "XETH") return "ETH";
  if (base === "ZEUR") return "EUR";
  if (base === "ZUSD") return "USD";
  if (base === "ZGBP") return "GBP";
  if (base === "ZJPY") return "JPY";
  if (/^[XZ][A-Z]{3}$/.test(base)) return base.slice(1);
  return base;
}

function isFiat(asset: string) {
  return ["CZK", "EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD"].includes(
    normalizeAssetCode(asset),
  );
}

async function getAssetPairs(): Promise<Record<string, JsonObject>> {
  if (assetPairsCache && Date.now() - assetPairsCache.fetchedAt < 60 * 60 * 1000) {
    return assetPairsCache.pairs;
  }

  const pairs = await publicRequest<Record<string, JsonObject>>(
    "/0/public/AssetPairs",
  );
  assetPairsCache = { fetchedAt: Date.now(), pairs };
  return pairs;
}

function pairForAsset(
  rawAsset: string,
  pairs: Record<string, JsonObject>,
): { requestPair: string; quote: string; base: string } | null {
  const target = normalizeAssetCode(rawAsset);

  for (const quote of ["EUR", "USD"]) {
    for (const [key, value] of Object.entries(pairs)) {
      const pair = asObject(value);
      const baseCode = normalizeAssetCode(stringValue(pair.base));
      const quoteCode = normalizeAssetCode(stringValue(pair.quote));
      if (baseCode !== target || quoteCode !== quote) continue;

      const requestPair =
        stringValue(pair.altname) ||
        stringValue(pair.wsname) ||
        key;
      return { requestPair, quote, base: baseCode };
    }
  }

  return null;
}

async function priceAssetInCzk(
  rawAsset: string,
  quantity: number,
  pairs: Record<string, JsonObject>,
): Promise<{ price: number | null; valueCzk: number; quote: string | null }> {
  const normalized = normalizeAssetCode(rawAsset);

  if (isFiat(normalized)) {
    return {
      price: 1,
      valueCzk: await toCzk(quantity, normalized),
      quote: normalized,
    };
  }

  const pair = pairForAsset(rawAsset, pairs);
  if (!pair) {
    return { price: null, valueCzk: 0, quote: null };
  }

  const tickerResult = await publicRequest<Record<string, JsonObject>>(
    `/0/public/Ticker?pair=${encodeURIComponent(pair.requestPair)}`,
  );
  const ticker = Object.values(tickerResult)[0];
  const close = Array.isArray(ticker?.c) ? ticker.c : [];
  const price = numberValue(close[0], 0);
  const quoteValue = quantity * price;

  return {
    price,
    valueCzk: await toCzk(quoteValue, pair.quote),
    quote: pair.quote,
  };
}

export async function validateKraken(credentials: KrakenCredentials) {
  if (!credentials.apiKey.trim() || !credentials.apiSecret.trim()) {
    throw new Error("Kraken API key and private key are required.");
  }

  const keyInfo = await privateRequest<JsonObject>(
    "/0/private/GetApiKeyInfo",
    credentials,
  );
  const permissions = Array.isArray(keyInfo.permissions)
    ? keyInfo.permissions.map(String)
    : [];

  const required = ["query-funds", "query-closed-trades", "query-ledger"];
  const missing = required.filter((permission) => !permissions.includes(permission));
  if (missing.length) {
    throw new Error(
      `Kraken API key is missing required read-only permissions: ${missing.join(", ")}.`,
    );
  }

  const allowed = new Set([
    "query-funds",
    "query-open-trades",
    "query-closed-trades",
    "query-ledger",
    "export-data",
  ]);
  const unsafe = permissions.filter((permission) => !allowed.has(permission));
  if (unsafe.length) {
    throw new Error(
      `Kraken API key has permissions FinanceOS does not accept: ${unsafe.join(", ")}. Create a dedicated read-only key.`,
    );
  }

  await privateRequest("/0/private/Balance", credentials);
  await privateRequest("/0/private/TradesHistory", credentials, { ofs: 0 });
  await privateRequest("/0/private/Ledgers", credentials, { ofs: 0 });
}

function pageAlreadyImported(
  providerPrefix: "trade" | "ledger",
  entries: Array<[string, JsonObject]>,
): boolean {
  if (!entries.length) return false;
  const statement = getDb().prepare(
    "SELECT 1 FROM transactions WHERE provider = 'kraken' AND external_id = ?",
  );
  return entries.every(([id]) =>
    Boolean(statement.get(`${providerPrefix}:${id}`)),
  );
}

async function fetchAllTrades(credentials: KrakenCredentials) {
  const all: Array<[string, JsonObject]> = [];
  let offset = 0;

  while (true) {
    const result = await privateRequest<JsonObject>(
      "/0/private/TradesHistory",
      credentials,
      { ofs: offset },
    );
    const trades = asObject(result.trades);
    const entries = Object.entries(trades).map(
      ([id, value]) => [id, asObject(value)] as [string, JsonObject],
    );

    if (pageAlreadyImported("trade", entries)) break;
    all.push(...entries);

    const count = numberValue(result.count, all.length);
    offset += entries.length;
    if (!entries.length || offset >= count) break;
  }

  return all;
}

async function fetchAllLedgers(credentials: KrakenCredentials) {
  const all: Array<[string, JsonObject]> = [];
  let offset = 0;

  while (true) {
    const result = await privateRequest<JsonObject>(
      "/0/private/Ledgers",
      credentials,
      { ofs: offset, type: "all" },
    );
    const ledger = asObject(result.ledger);
    const entries = Object.entries(ledger).map(
      ([id, value]) => [id, asObject(value)] as [string, JsonObject],
    );

    if (pageAlreadyImported("ledger", entries)) break;
    all.push(...entries);

    const count = numberValue(result.count, all.length);
    offset += entries.length;
    if (!entries.length || offset >= count) break;
  }

  return all;
}

function ledgerKind(type: string): TransactionKind {
  switch (type) {
    case "deposit":
      return "deposit";
    case "withdrawal":
      return "withdrawal";
    case "transfer":
      return "transfer";
    case "dividend":
      return "dividend";
    case "staking":
    case "credit":
      return "interest";
    default:
      return "adjustment";
  }
}

export async function syncKraken() {
  const connection = getConnectionSecret<KrakenCredentials>("kraken");
  if (!connection) throw new Error("Kraken is not connected.");

  const { credentials } = connection;
  const [balances, pairs, trades, ledgers] = await Promise.all([
    privateRequest<Record<string, string>>("/0/private/Balance", credentials),
    getAssetPairs(),
    fetchAllTrades(credentials),
    fetchAllLedgers(credentials),
  ]);

  const accountExternalId = "spot";
  let cashValueCzk = 0;
  let investedValueCzk = 0;
  const preparedHoldings: Array<{
    rawAsset: string;
    normalized: string;
    quantity: number;
    currentPrice: number | null;
    quote: string;
    valueCzk: number;
  }> = [];

  for (const [rawAsset, rawQuantity] of Object.entries(balances)) {
    const quantity = numberValue(rawQuantity, 0);
    if (!quantity) continue;

    const normalized = normalizeAssetCode(rawAsset);
    const priced = await priceAssetInCzk(rawAsset, quantity, pairs);
    if (isFiat(normalized)) cashValueCzk += priced.valueCzk;
    else investedValueCzk += priced.valueCzk;

    preparedHoldings.push({
      rawAsset,
      normalized,
      quantity,
      currentPrice: priced.price,
      quote: priced.quote || normalized,
      valueCzk: priced.valueCzk,
    });
  }

  const totalValueCzk = cashValueCzk + investedValueCzk;
  const accountIdValue = upsertAccount({
    provider: "kraken",
    externalId: accountExternalId,
    name: "Kraken",
    type: "crypto",
    currency: "CZK",
    cashValue: cashValueCzk,
    investedValue: investedValueCzk,
    totalValue: totalValueCzk,
    realizedPnl: 0,
    unrealizedPnl: 0,
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: { balances },
  });

  const holdings = [];
  for (const item of preparedHoldings) {
    const assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: item.rawAsset,
      symbol: item.normalized,
      name: item.normalized,
      assetClass: isFiat(item.normalized) ? "cash" : "crypto",
      currency: item.quote,
      raw: { rawAsset: item.rawAsset },
    });

    holdings.push({
      accountId: accountIdValue,
      assetId: assetIdValue,
      quantity: item.quantity,
      averagePrice: null,
      currentPrice: item.currentPrice,
      currency: item.quote,
      marketValue: item.valueCzk,
      marketValueCzk: item.valueCzk,
      unrealizedPnl: null,
      unrealizedPnlCzk: null,
      raw: { rawAsset: item.rawAsset },
    });
  }
  replaceHoldings(accountIdValue, holdings);

  for (const [tradeId, trade] of trades) {
    const pairKey = stringValue(trade.pair);
    const pairMeta =
      pairs[pairKey] ||
      Object.values(pairs).find(
        (candidate) =>
          stringValue(candidate.altname) === pairKey ||
          stringValue(candidate.wsname) === pairKey,
      ) ||
      {};
    const baseRaw = stringValue(pairMeta.base, pairKey);
    const quoteRaw = stringValue(pairMeta.quote, "USD");
    const base = normalizeAssetCode(baseRaw);
    const quote = normalizeAssetCode(quoteRaw);
    const kind = stringValue(trade.type).toLowerCase() === "sell" ? "sell" : "buy";
    const cost = numberValue(trade.cost, 0);
    const signedCost = kind === "buy" ? -Math.abs(cost) : Math.abs(cost);
    const volume = numberValue(trade.vol, 0);
    const occurredAt = new Date(numberValue(trade.time) * 1000).toISOString();

    let assetIdValue = assetId("kraken", baseRaw);
    assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: baseRaw,
      symbol: base,
      name: base,
      assetClass: "crypto",
      currency: quote,
      raw: pairMeta,
    });

    upsertTransaction({
      provider: "kraken",
      accountId: accountIdValue,
      externalId: `trade:${tradeId}`,
      kind,
      occurredAt,
      currency: quote,
      amount: signedCost,
      amountCzk: await maybeToCzk(signedCost, quote, occurredAt),
      assetId: assetIdValue,
      quantity: volume,
      price: numberValue(trade.price, volume ? cost / volume : 0),
      fee: numberValue(trade.fee, 0),
      note: pairKey,
      raw: trade,
    });
  }

  for (const [ledgerId, ledger] of ledgers) {
    const type = stringValue(ledger.type).toLowerCase();
    if (type === "trade") continue;

    const rawAsset = stringValue(ledger.asset, "UNKNOWN");
    const currency = normalizeAssetCode(rawAsset);
    const amount = numberValue(ledger.amount, 0);
    const occurredAt = new Date(numberValue(ledger.time) * 1000).toISOString();

    let amountCzk: number | null = null;
    if (isFiat(currency)) {
      amountCzk = await maybeToCzk(amount, currency, occurredAt);
    } else {
      // Do not value historical crypto ledger movements using today's crypto price.
      // A dedicated historical market-price engine will fill these values later.
      amountCzk = null;
    }

    const assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: rawAsset,
      symbol: currency,
      name: currency,
      assetClass: isFiat(currency) ? "cash" : "crypto",
      currency,
      raw: { rawAsset },
    });

    upsertTransaction({
      provider: "kraken",
      accountId: accountIdValue,
      externalId: `ledger:${ledgerId}`,
      kind: ledgerKind(type),
      occurredAt,
      currency,
      amount,
      amountCzk,
      assetId: assetIdValue,
      fee: numberValue(ledger.fee, 0),
      note: [type, stringValue(ledger.subtype)].filter(Boolean).join(" · "),
      raw: ledger,
    });
  }

  recordSnapshot(accountIdValue);

  return {
    accountId: accountIdValue,
    holdings: holdings.length,
    trades: trades.length,
    ledgers: ledgers.length,
  };
}
