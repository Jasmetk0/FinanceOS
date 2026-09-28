import type { ProviderId, TransactionKind } from "@/lib/domain";
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
import { getDb } from "@/lib/server/db";

type JsonObject = Record<string, unknown>;

export interface Trading212Credentials {
  apiKey: string;
  apiSecret: string;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function stringValue(obj: JsonObject, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function numberValue(obj: JsonObject, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function mapAssetClass(type: string): string {
  const normalized = type.toUpperCase();
  if (normalized === "ETF") return "etf";
  if (normalized === "STOCK") return "stock";
  if (normalized.includes("CRYPTO")) return "crypto";
  return "other";
}

function baseUrl(environment: string) {
  return environment === "demo"
    ? "https://demo.trading212.com/api/v0"
    : "https://live.trading212.com/api/v0";
}

function authHeader(credentials: Trading212Credentials) {
  return `Basic ${Buffer.from(
    `${credentials.apiKey}:${credentials.apiSecret}`,
    "utf8",
  ).toString("base64")}`;
}

async function request<T>(
  environment: string,
  credentials: Trading212Credentials,
  path: string,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : path.startsWith("/api/v0/")
      ? `${environment === "demo" ? "https://demo.trading212.com" : "https://live.trading212.com"}${path}`
      : `${baseUrl(environment)}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(credentials),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Trading 212 request failed (${response.status}): ${detail || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPaginated(
  environment: string,
  credentials: Trading212Credentials,
  initialPath: string,
  stopWhenKnownPrefix?: string,
): Promise<JsonObject[]> {
  const all: JsonObject[] = [];
  let path: string | null = initialPath;
  let page = 0;

  while (path) {
    if (page > 0) {
      // History endpoints are currently limited to 6 requests/minute.
      await sleep(10_500);
    }

    const result: { items?: unknown[]; nextPagePath?: string | null } =
      await request<{ items?: unknown[]; nextPagePath?: string | null }>(
        environment,
        credentials,
        path,
      );
    const items: JsonObject[] = Array.isArray(result.items)
      ? result.items.map((item: unknown) => asObject(item))
      : [];

    if (stopWhenKnownPrefix && items.length > 0) {
      const ids: string[] = items.map((item: JsonObject) =>
        `${stopWhenKnownPrefix}:${stringValue(item, ["id", "reference", "referenceId", "transactionId"])}`,
      );
      const known = ids.filter((id: string) =>
        getDb()
          .prepare("SELECT 1 FROM transactions WHERE provider = 'trading212' AND external_id = ?")
          .get(id),
      );
      if (known.length === ids.length) break;
    }

    all.push(...items);
    path = typeof result.nextPagePath === "string" && result.nextPagePath
      ? result.nextPagePath
      : null;
    page += 1;
  }

  return all;
}

export async function validateTrading212(
  environment: string,
  credentials: Trading212Credentials,
) {
  if (!credentials.apiKey.trim() || !credentials.apiSecret.trim()) {
    throw new Error("Trading 212 API key and secret are required.");
  }

  await request(
    environment,
    credentials,
    "/equity/account/summary",
  );
}

export async function syncTrading212() {
  const connection = getConnectionSecret<Trading212Credentials>("trading212");
  if (!connection) throw new Error("Trading 212 is not connected.");

  const { credentials, environment } = connection;

  const [summaryRaw, positionsRaw] = await Promise.all([
    request<JsonObject>(environment, credentials, "/equity/account/summary"),
    request<unknown[]>(environment, credentials, "/equity/positions"),
  ]);

  const summary = asObject(summaryRaw);
  const cash = asObject(summary.cash);
  const investments = asObject(summary.investments);
  const currency = stringValue(summary, ["currency"], "CZK").toUpperCase();
  const externalAccountId = stringValue(summary, ["id"], "primary");

  const cashValue = numberValue(cash, ["availableToTrade"], 0)
    + numberValue(cash, ["inPies"], 0)
    + numberValue(cash, ["reservedForOrders"], 0);
  const investedValue = numberValue(investments, ["totalCost"], 0);
  const totalValue = numberValue(summary, ["totalValue"], 0);
  const realizedPnl = numberValue(investments, ["realizedProfitLoss"], 0);
  const unrealizedPnl = numberValue(investments, ["unrealizedProfitLoss"], 0);

  const fx = (value: number) => toCzk(value, currency);
  const [
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk,
    unrealizedPnlCzk,
  ] = await Promise.all([
    fx(cashValue),
    fx(investedValue),
    fx(totalValue),
    fx(realizedPnl),
    fx(unrealizedPnl),
  ]);

  const accountIdValue = upsertAccount({
    provider: "trading212",
    externalId: externalAccountId,
    name: environment === "demo" ? "Trading 212 Demo" : "Trading 212",
    type: "brokerage",
    currency,
    cashValue,
    investedValue,
    totalValue,
    realizedPnl,
    unrealizedPnl,
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk,
    unrealizedPnlCzk,
    raw: summary,
  });

  const holdings = [];
  for (const rawPosition of Array.isArray(positionsRaw) ? positionsRaw : []) {
    const position = asObject(rawPosition);
    const instrument = asObject(position.instrument);
    const ticker = stringValue(instrument, ["ticker"], stringValue(position, ["ticker"]));
    if (!ticker) continue;

    const instrumentCurrency = stringValue(
      instrument,
      ["currency", "currencyCode"],
      currency,
    ).toUpperCase();
    const quantity = numberValue(position, ["quantity"]);
    const averagePrice = numberValue(position, ["averagePricePaid"], 0);
    const currentPrice = numberValue(position, ["currentPrice"], 0);
    const marketValue = quantity * currentPrice;
    const cost = quantity * averagePrice;
    const pnl = marketValue - cost;
    const [marketValueCzk, pnlCzk] = await Promise.all([
      toCzk(marketValue, instrumentCurrency),
      toCzk(pnl, instrumentCurrency),
    ]);

    const assetIdValue = upsertAsset({
      provider: "trading212",
      externalId: ticker,
      symbol: ticker.replace(/_[A-Z]+_EQ$/i, ""),
      name: stringValue(instrument, ["name", "shortName"], ticker),
      assetClass: mapAssetClass(stringValue(instrument, ["type"], "OTHER")),
      currency: instrumentCurrency,
      raw: instrument,
    });

    holdings.push({
      accountId: accountIdValue,
      assetId: assetIdValue,
      quantity,
      averagePrice,
      currentPrice,
      currency: instrumentCurrency,
      marketValue,
      marketValueCzk,
      unrealizedPnl: pnl,
      unrealizedPnlCzk: pnlCzk,
      raw: position,
    });
  }
  replaceHoldings(accountIdValue, holdings);

  const [orders, dividends, cashTransactions] = await Promise.all([
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/orders?limit=50",
      "order",
    ),
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/dividends?limit=50",
      "dividend",
    ),
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/transactions?limit=50",
      "cash",
    ),
  ]);

  for (const order of orders) {
    const id = stringValue(order, ["id"], cryptoLike(order));
    const externalId = `order:${id}`;
    const side = stringValue(order, ["side"]).toUpperCase();
    const status = stringValue(order, ["status"]).toUpperCase();
    if (status && !["FILLED", "PARTIALLY_FILLED"].includes(status)) continue;

    const instrument = asObject(order.instrument);
    const ticker = stringValue(order, ["ticker"], stringValue(instrument, ["ticker"]));
    const orderCurrency = stringValue(order, ["currency"], currency).toUpperCase();
    const quantity = numberValue(order, ["filledQuantity", "quantity"]);
    const filledValue = numberValue(order, ["filledValue", "value"]);
    const price = quantity ? Math.abs(filledValue / quantity) : numberValue(order, ["price"]);
    const occurredAt = stringValue(
      order,
      ["filledAt", "executedAt", "dateExecuted", "createdAt"],
      new Date().toISOString(),
    );
    let assetIdValue: string | null = null;

    if (ticker) {
      assetIdValue = assetId("trading212", ticker);
      const exists = getDb().prepare("SELECT id FROM assets WHERE id = ?").get(assetIdValue);
      if (!exists) {
        assetIdValue = upsertAsset({
          provider: "trading212",
          externalId: ticker,
          symbol: ticker.replace(/_[A-Z]+_EQ$/i, ""),
          name: stringValue(instrument, ["name"], ticker),
          assetClass: "other",
          currency: orderCurrency,
          raw: instrument,
        });
      }
    }

    const signedAmount =
      side === "BUY" ? -Math.abs(filledValue) : Math.abs(filledValue);

    upsertTransaction({
      provider: "trading212",
      accountId: accountIdValue,
      externalId,
      kind: side === "SELL" ? "sell" : "buy",
      occurredAt,
      currency: orderCurrency,
      amount: signedAmount,
      amountCzk: await maybeToCzk(signedAmount, orderCurrency),
      assetId: assetIdValue,
      quantity,
      price,
      fee: numberValue(order, ["fee", "fxFee"], 0),
      raw: order,
    });
  }

  for (const dividend of dividends) {
    const id = stringValue(
      dividend,
      ["id", "reference", "referenceId"],
      cryptoLike(dividend),
    );
    const ticker = stringValue(dividend, ["ticker"]);
    const dividendCurrency = stringValue(
      dividend,
      ["currency", "currencyCode"],
      currency,
    ).toUpperCase();
    const amount = numberValue(
      dividend,
      ["amount", "netAmount", "amountInAccountCurrency", "grossAmount"],
      0,
    );
    const occurredAt = stringValue(
      dividend,
      ["paidOn", "paidAt", "date", "createdAt"],
      new Date().toISOString(),
    );

    let assetIdValue: string | null = null;
    if (ticker) {
      assetIdValue = assetId("trading212", ticker);
    }

    upsertTransaction({
      provider: "trading212",
      accountId: accountIdValue,
      externalId: `dividend:${id}`,
      kind: "dividend",
      occurredAt,
      currency: dividendCurrency,
      amount,
      amountCzk: await maybeToCzk(amount, dividendCurrency),
      assetId: assetIdValue,
      note: ticker ? `Dividend · ${ticker}` : "Dividend",
      raw: dividend,
    });
  }

  for (const transaction of cashTransactions) {
    const id = stringValue(
      transaction,
      ["id", "reference", "referenceId", "transactionId"],
      cryptoLike(transaction),
    );
    const type = stringValue(transaction, ["type", "transactionType"], "adjustment")
      .toLowerCase();
    const txCurrency = stringValue(
      transaction,
      ["currency", "currencyCode"],
      currency,
    ).toUpperCase();
    const amount = numberValue(
      transaction,
      ["amount", "amountInAccountCurrency", "value"],
      0,
    );
    const occurredAt = stringValue(
      transaction,
      ["dateTime", "date", "createdAt", "timestamp"],
      new Date().toISOString(),
    );

    upsertTransaction({
      provider: "trading212",
      accountId: accountIdValue,
      externalId: `cash:${id}`,
      kind: mapCashKind(type),
      occurredAt,
      currency: txCurrency,
      amount,
      amountCzk: await maybeToCzk(amount, txCurrency),
      note: stringValue(transaction, ["reference", "description"], type),
      raw: transaction,
    });
  }

  recordSnapshot(accountIdValue);

  return {
    accountId: accountIdValue,
    holdings: holdings.length,
    orders: orders.length,
    dividends: dividends.length,
    cashTransactions: cashTransactions.length,
  };
}

function mapCashKind(type: string): TransactionKind {
  if (type.includes("deposit")) return "deposit";
  if (type.includes("withdraw")) return "withdrawal";
  if (type.includes("interest")) return "interest";
  if (type.includes("fee")) return "fee";
  if (type.includes("transfer")) return "transfer";
  return "adjustment";
}

function cryptoLike(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url").slice(0, 64);
}

export const TRADING212_PROVIDER: ProviderId = "trading212";
