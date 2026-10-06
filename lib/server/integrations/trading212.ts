import type { ProviderId, TransactionKind } from "@/lib/domain";
import { canonicalSecurityIdentity } from "@/lib/shared/finance-normalization.mjs";
import { withProviderSyncLock } from "@/lib/server/provider-sync-lock";
import { maybeToCzk, toCzk } from "@/lib/server/fx";
import {
  getConnectionSecret,
  recordSnapshot,
  replaceHoldings,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";
import {
  getDb,
  repairTrading212CashSemantics,
} from "@/lib/server/db";
import {
  hasTrading212CardEvidence,
  syncTrading212CardHistory,
} from "@/lib/server/trading212-card";
import { syncTrading212DailyHistory } from "@/lib/server/trading212-history";

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

async function requestOptional<T>(
  environment: string,
  credentials: Trading212Credentials,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return {
      ok: true,
      data: await request<T>(environment, credentials, path),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const HISTORY_PAGE_BUDGET = 8;
const HISTORY_BACKFILL_VERSION = "v2";
const HISTORY_DEEP_AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function getHistorySyncState(key: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT value FROM provider_sync_state WHERE provider = 'trading212' AND key = ?",
    )
    .get(key);
  return row?.value === null || row?.value === undefined
    ? null
    : String(row.value);
}

function setHistorySyncState(key: string, value: string) {
  getDb()
    .prepare(`
      INSERT INTO provider_sync_state(provider, key, value, updated_at)
      VALUES('trading212', ?, ?, ?)
      ON CONFLICT(provider, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(key, value, new Date().toISOString());
}

function deleteHistorySyncState(key: string) {
  getDb()
    .prepare(
      "DELETE FROM provider_sync_state WHERE provider = 'trading212' AND key = ?",
    )
    .run(key);
}

function historyExternalKey(prefix: string, item: JsonObject): string {
  const nestedOrder = asObject(item.order);
  const nestedFill = asObject(item.fill);

  const rawId =
    prefix === "order"
      ? stringValue(
          nestedFill,
          ["id", "fillId"],
          stringValue(
            nestedOrder,
            ["fillId", "id"],
            stringValue(item, ["fillId", "id"], cryptoLike(item)),
          ),
        )
      : stringValue(
          item,
          ["id", "reference", "referenceId", "transactionId"],
          cryptoLike(item),
        );

  return `${prefix}:${rawId}`;
}

async function fetchPaginated(
  environment: string,
  credentials: Trading212Credentials,
  initialPath: string,
  stopWhenKnownPrefix?: string,
  historyKey?: string,
): Promise<JsonObject[]> {
  const all: JsonObject[] = [];
  const statePrefix = historyKey
    ? `history_${HISTORY_BACKFILL_VERSION}:${historyKey}`
    : null;
  const completeKey = statePrefix ? statePrefix + ":complete" : null;
  const cursorKey = statePrefix ? statePrefix + ":cursor" : null;
  const fullAuditAtKey = statePrefix ? statePrefix + ":full_audit_at" : null;

  const fullBackfillComplete =
    completeKey !== null && getHistorySyncState(completeKey) === "true";
  const savedCursor = cursorKey ? getHistorySyncState(cursorKey) : null;
  const lastFullAuditRaw = fullAuditAtKey
    ? getHistorySyncState(fullAuditAtKey)
    : null;
  const lastFullAuditMs = lastFullAuditRaw
    ? new Date(lastFullAuditRaw).getTime()
    : Number.NaN;
  const fullAuditDue =
    fullBackfillComplete &&
    (!Number.isFinite(lastFullAuditMs) ||
      Date.now() - lastFullAuditMs >= HISTORY_DEEP_AUDIT_INTERVAL_MS);

  // A saved cursor always means a full traversal is already in progress.
  // Otherwise a brand-new database/backfill or a periodic audit starts from
  // the newest page and walks all the way to account inception.
  const fullScanActive =
    !fullBackfillComplete || fullAuditDue || Boolean(savedCursor);
  let path: string | null =
    fullScanActive && savedCursor ? savedCursor : initialPath;
  let page = 0;

  while (path) {
    if (page > 0) {
      // Historical orders/dividends/transactions are limited to 6 requests/minute.
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

    // The fast known-page stop is safe only during incremental sync. Full
    // traversals deliberately ignore "already known" pages so a historical
    // hole can never remain hidden behind a newer known page.
    if (!fullScanActive && stopWhenKnownPrefix && items.length > 0) {
      const ids: string[] = items.map((item: JsonObject) =>
        historyExternalKey(stopWhenKnownPrefix, item),
      );
      const known = ids.filter((id: string) =>
        getDb()
          .prepare(
            "SELECT 1 FROM transactions WHERE provider = 'trading212' AND external_id = ?",
          )
          .get(id),
      );
      if (known.length === ids.length) break;
    }

    all.push(...items);
    const nextPath =
      typeof result.nextPagePath === "string" && result.nextPagePath
        ? result.nextPagePath
        : null;
    page += 1;

    if (!nextPath) {
      if (fullScanActive && completeKey && cursorKey) {
        setHistorySyncState(completeKey, "true");
        deleteHistorySyncState(cursorKey);
        if (fullAuditAtKey) {
          setHistorySyncState(fullAuditAtKey, new Date().toISOString());
        }
      }
      path = null;
      continue;
    }

    if (fullScanActive && cursorKey && page >= HISTORY_PAGE_BUDGET) {
      setHistorySyncState(cursorKey, nextPath);
      path = null;
      continue;
    }

    path = nextPath;
  }

  return all;
}

export async function validateTrading212(
  environment: string,
  credentials: Trading212Credentials,
) {
  return withProviderSyncLock("trading212", async () => {
    if (!credentials.apiKey.trim() || !credentials.apiSecret.trim()) {
      throw new Error("Trading 212 API key and secret are required.");
    }

    await request(
      environment,
      credentials,
      "/equity/account/summary",
    );
  });
}

export async function syncTrading212() {
  return withProviderSyncLock("trading212", async () => {
  const connection = getConnectionSecret<Trading212Credentials>("trading212");
  if (!connection) throw new Error("Trading 212 is not connected.");

  const { credentials, environment } = connection;

  const [
    summaryRaw,
    positionsRaw,
    instrumentsRaw,
    pendingOrdersResult,
    exchangesResult,
    piesResult,
  ] = await Promise.all([
    request<JsonObject>(environment, credentials, "/equity/account/summary"),
    request<unknown[]>(environment, credentials, "/equity/positions"),
    request<unknown[]>(environment, credentials, "/equity/metadata/instruments"),
    requestOptional<unknown[]>(environment, credentials, "/equity/orders"),
    requestOptional<unknown[]>(environment, credentials, "/equity/metadata/exchanges"),
    requestOptional<unknown[]>(environment, credentials, "/equity/pies"),
  ]);

  const apiReadCoverage = {
    accountSummary: { ok: true, count: 1 },
    positions: {
      ok: true,
      count: Array.isArray(positionsRaw) ? positionsRaw.length : 0,
    },
    instruments: {
      ok: true,
      count: Array.isArray(instrumentsRaw) ? instrumentsRaw.length : 0,
    },
    pendingOrders: pendingOrdersResult.ok
      ? {
          ok: true,
          count: Array.isArray(pendingOrdersResult.data)
            ? pendingOrdersResult.data.length
            : 0,
        }
      : { ok: false, error: pendingOrdersResult.error },
    exchanges: exchangesResult.ok
      ? {
          ok: true,
          count: Array.isArray(exchangesResult.data)
            ? exchangesResult.data.length
            : 0,
        }
      : { ok: false, error: exchangesResult.error },
    pies: piesResult.ok
      ? {
          ok: true,
          count: Array.isArray(piesResult.data) ? piesResult.data.length : 0,
          deprecatedApi: true,
        }
      : { ok: false, error: piesResult.error, deprecatedApi: true },
  };

  const metadataByTicker = new Map<string, JsonObject>();
  for (const rawInstrument of Array.isArray(instrumentsRaw) ? instrumentsRaw : []) {
    const metadata = asObject(rawInstrument);
    const ticker = stringValue(metadata, ["ticker"]);
    if (ticker) metadataByTicker.set(ticker, metadata);
  }

  const summary = asObject(summaryRaw);
  const cash = asObject(summary.cash);
  const investments = asObject(summary.investments);
  const currency = stringValue(summary, ["currency"], "CZK").toUpperCase();
  const externalAccountId = stringValue(summary, ["id"], "primary");

  const availableToTrade = numberValue(cash, ["availableToTrade"], 0);
  const pieCash = numberValue(cash, ["inPies"], 0);
  const reservedCash = numberValue(cash, ["reservedForOrders"], 0);
  const cashValue = availableToTrade + pieCash + reservedCash;
  const providerInvestmentsCurrentValue = numberValue(
    investments,
    ["currentValue"],
    0,
  );
  const investedValue = providerInvestmentsCurrentValue;
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
    realizedPnlStatus: "available",
    unrealizedPnlStatus: "available",
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

    const metadata = metadataByTicker.get(ticker) ?? instrument;
    const instrumentCurrency = stringValue(
      metadata,
      ["currencyCode", "currency"],
      stringValue(instrument, ["currency", "currencyCode"], currency),
    ).toUpperCase();
    const walletImpact = asObject(position.walletImpact);
    const walletCurrency = stringValue(
      walletImpact,
      ["currency"],
      currency,
    ).toUpperCase();

    const quantity = numberValue(position, ["quantity"]);
    const averagePrice = numberValue(position, ["averagePricePaid"], 0);
    const currentPrice = numberValue(position, ["currentPrice"], 0);
    const fallbackMarketValue = quantity * currentPrice;
    const fallbackCost = quantity * averagePrice;
    const marketValue = numberValue(
      walletImpact,
      ["currentValue"],
      fallbackMarketValue,
    );
    const pnl = numberValue(
      walletImpact,
      ["unrealizedProfitLoss"],
      marketValue - fallbackCost,
    );
    const [marketValueCzk, pnlCzk] = await Promise.all([
      toCzk(marketValue, Object.keys(walletImpact).length ? walletCurrency : instrumentCurrency),
      toCzk(pnl, Object.keys(walletImpact).length ? walletCurrency : instrumentCurrency),
    ]);

    const identity = canonicalSecurityIdentity(
      ticker,
      stringValue(metadata, ["isin"]),
      stringValue(metadata, ["shortName"]),
    );
    const assetIdValue = upsertAsset({
      provider: "trading212",
      externalId: ticker,
      symbol: identity.canonicalSymbol,
      name: stringValue(metadata, ["name", "shortName"], identity.canonicalSymbol),
      assetClass: mapAssetClass(stringValue(metadata, ["type"], "OTHER")),
      currency: instrumentCurrency,
      canonicalKey: identity.canonicalKey,
      isin: identity.isin,
      listingSymbol: identity.listingSymbol,
      raw: {
        ...metadata,
        financeOsIdentity: identity,
      },
    });

    holdings.push({
      accountId: accountIdValue,
      assetId: assetIdValue,
      quantity,
      averagePrice,
      currentPrice,
      currency: Object.keys(walletImpact).length ? walletCurrency : instrumentCurrency,
      marketValue,
      marketValueCzk,
      unrealizedPnl: pnl,
      unrealizedPnlCzk: pnlCzk,
      raw: position,
    });
  }
  replaceHoldings(accountIdValue, holdings);

  const positionsMarketValue = holdings.reduce(
    (sum, holding) => sum + holding.marketValue,
    0,
  );
  const positionsMarketValueCzk = holdings.reduce(
    (sum, holding) => sum + holding.marketValueCzk,
    0,
  );
  const unclassifiedValue =
    totalValue - positionsMarketValue - cashValue;
  const unclassifiedValueCzk =
    totalValueCzk - positionsMarketValueCzk - cashValueCzk;
  const tolerance = 0.05;
  const reconciliationStatus =
    Math.abs(unclassifiedValueCzk) <= tolerance ? "reconciled" : "warning";
  const pieIncludedInInvestments =
    Math.abs(
      providerInvestmentsCurrentValue - positionsMarketValue - pieCash,
    ) <= tolerance;

  upsertAccount({
    provider: "trading212",
    externalId: externalAccountId,
    name: environment === "demo" ? "Trading 212 Demo" : "Trading 212",
    type: "brokerage",
    currency,
    cashValue,
    investedValue: positionsMarketValue,
    totalValue,
    realizedPnl,
    unrealizedPnl,
    realizedPnlStatus: "available",
    unrealizedPnlStatus: "available",
    cashValueCzk,
    investedValueCzk: positionsMarketValueCzk,
    totalValueCzk,
    realizedPnlCzk,
    unrealizedPnlCzk,
    unclassifiedValue:
      Math.abs(unclassifiedValue) <= tolerance ? 0 : unclassifiedValue,
    unclassifiedValueCzk:
      Math.abs(unclassifiedValueCzk) <= tolerance ? 0 : unclassifiedValueCzk,
    reconciliationDifference:
      Math.abs(unclassifiedValueCzk) <= tolerance ? 0 : unclassifiedValueCzk,
    reconciliationStatus,
    raw: {
      ...summary,
      financeOsApiReadCoverage: apiReadCoverage,
      financeOsReconciliation: {
        positionsMarketValue,
        knownCash: {
          availableToTrade,
          inPies: pieCash,
          reservedForOrders: reservedCash,
          total: cashValue,
        },
        providerInvestmentsCurrentValue,
        pieIncludedInInvestments,
        unclassifiedValue,
        totalValue,
      },
    },
  });

  const [orders, dividends, cashTransactions] = await Promise.all([
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/orders?limit=50",
      "order",
      "orders",
    ),
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/dividends?limit=50",
      "dividend",
      "dividends",
    ),
    fetchPaginated(
      environment,
      credentials,
      "/equity/history/transactions?limit=50",
      "cash",
      "cash",
    ),
  ]);

  for (const item of orders) {
    const nestedOrder = asObject(item.order);
    const nestedFill = asObject(item.fill);
    const order = Object.keys(nestedOrder).length ? nestedOrder : item;
    const fill = Object.keys(nestedFill).length ? nestedFill : item;
    const walletImpact = asObject(fill.walletImpact);

    const externalId = historyExternalKey("order", item);
    const rawQuantity = numberValue(
      fill,
      ["quantity"],
      numberValue(
        order,
        ["filledQuantity", "quantity", "orderedQuantity"],
        numberValue(item, ["filledQuantity", "orderedQuantity", "quantity"]),
      ),
    );
    const explicitSide = stringValue(order, ["side"], stringValue(item, ["side"])).toUpperCase();
    const side =
      explicitSide ||
      (rawQuantity < 0 ? "SELL" : "BUY");
    const status = stringValue(order, ["status"], stringValue(item, ["status"])).toUpperCase();
    if (status && !["FILLED", "PARTIALLY_FILLED"].includes(status)) continue;

    const instrument = asObject(order.instrument);
    const ticker = stringValue(
      order,
      ["ticker"],
      stringValue(item, ["ticker"], stringValue(instrument, ["ticker"])),
    );
    const metadata = ticker ? metadataByTicker.get(ticker) ?? instrument : instrument;
    const instrumentCurrency = stringValue(
      metadata,
      ["currencyCode", "currency"],
      stringValue(instrument, ["currency"], currency),
    ).toUpperCase();
    const walletCurrency = stringValue(
      walletImpact,
      ["currency"],
      stringValue(order, ["currency"], currency),
    ).toUpperCase();

    const quantity = Math.abs(rawQuantity);
    const price = numberValue(
      fill,
      ["price"],
      numberValue(item, ["fillPrice", "price"], numberValue(order, ["price"])),
    );
    const walletNetValue = numberValue(walletImpact, ["netValue"], Number.NaN);
    const filledValue = numberValue(
      order,
      ["filledValue", "value"],
      numberValue(item, ["filledValue", "value"]),
    );
    const hasWalletValue = Number.isFinite(walletNetValue) && walletNetValue !== 0;
    const absoluteAmount = hasWalletValue
      ? Math.abs(walletNetValue)
      : filledValue
        ? Math.abs(filledValue)
        : Math.abs(quantity * price);
    const amountCurrency = hasWalletValue
      ? walletCurrency
      : filledValue
        ? stringValue(order, ["currency"], currency).toUpperCase()
        : instrumentCurrency;
    const signedAmount =
      side === "SELL" ? Math.abs(absoluteAmount) : -Math.abs(absoluteAmount);

    const occurredAt = stringValue(
      fill,
      ["filledAt"],
      stringValue(
        item,
        ["dateExecuted", "dateModified", "dateCreated", "filledAt", "createdAt"],
        stringValue(order, ["createdAt"], new Date().toISOString()),
      ),
    );

    let assetIdValue: string | null = null;
    if (ticker) {
      const identity = canonicalSecurityIdentity(
        ticker,
        stringValue(metadata, ["isin"]),
        stringValue(metadata, ["shortName"]),
      );
      assetIdValue = upsertAsset({
        provider: "trading212",
        externalId: ticker,
        symbol: identity.canonicalSymbol,
        name: stringValue(metadata, ["name", "shortName"], identity.canonicalSymbol),
        assetClass: mapAssetClass(stringValue(metadata, ["type"], "OTHER")),
        currency: instrumentCurrency,
        canonicalKey: identity.canonicalKey,
        isin: identity.isin,
        listingSymbol: identity.listingSymbol,
        raw: { ...metadata, financeOsIdentity: identity },
      });
    }

    upsertTransaction({
      provider: "trading212",
      accountId: accountIdValue,
      externalId,
      kind: side === "SELL" ? "sell" : "buy",
      occurredAt,
      currency: amountCurrency,
      amount: signedAmount,
      amountCzk: await maybeToCzk(signedAmount, amountCurrency, occurredAt),
      assetId: assetIdValue,
      quantity,
      price,
      fee: 0,
      raw: item,
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
      const metadata = metadataByTicker.get(ticker) ?? {};
      const identity = canonicalSecurityIdentity(
        ticker,
        stringValue(metadata, ["isin"]),
        stringValue(metadata, ["shortName"]),
      );
      assetIdValue = upsertAsset({
        provider: "trading212",
        externalId: ticker,
        symbol: identity.canonicalSymbol,
        name: stringValue(metadata, ["name", "shortName"], identity.canonicalSymbol),
        assetClass: mapAssetClass(stringValue(metadata, ["type"], "OTHER")),
        currency: stringValue(metadata, ["currencyCode", "currency"], dividendCurrency).toUpperCase(),
        canonicalKey: identity.canonicalKey,
        isin: identity.isin,
        listingSymbol: identity.listingSymbol,
        raw: { ...metadata, financeOsIdentity: identity },
      });
    }

    upsertTransaction({
      provider: "trading212",
      accountId: accountIdValue,
      externalId: `dividend:${id}`,
      kind: "dividend",
      occurredAt,
      currency: dividendCurrency,
      amount,
      amountCzk: await maybeToCzk(amount, dividendCurrency, occurredAt),
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
      amountCzk: await maybeToCzk(amount, txCurrency, occurredAt),
      note: stringValue(transaction, ["reference", "description"], type),
      category: mapCashCategory(type),
      flowScope: mapCashFlowScope(type),
      raw: transaction,
    });
  }

  repairTrading212CashSemantics(getDb());

  const cardSync = await syncTrading212CardHistory({
    environment,
    credentials,
    accountId: accountIdValue,
    accountCurrency: currency,
  });

  const cardDetected = hasTrading212CardEvidence();
  if (
    cardDetected &&
    unclassifiedValue >= -tolerance &&
    unclassifiedValueCzk >= -tolerance
  ) {
    const spendingPotValue =
      Math.abs(unclassifiedValue) <= tolerance ? 0 : unclassifiedValue;
    const spendingPotValueCzk =
      Math.abs(unclassifiedValueCzk) <= tolerance ? 0 : unclassifiedValueCzk;
    const reconciledCashValue = cashValue + spendingPotValue;
    const reconciledCashValueCzk = cashValueCzk + spendingPotValueCzk;

    upsertAccount({
      provider: "trading212",
      externalId: externalAccountId,
      name: environment === "demo" ? "Trading 212 Demo" : "Trading 212",
      type: "brokerage",
      currency,
      cashValue: reconciledCashValue,
      investedValue: positionsMarketValue,
      totalValue,
      realizedPnl,
      unrealizedPnl,
      realizedPnlStatus: "available",
      unrealizedPnlStatus: "available",
      cashValueCzk: reconciledCashValueCzk,
      investedValueCzk: positionsMarketValueCzk,
      totalValueCzk,
      realizedPnlCzk,
      unrealizedPnlCzk,
      unclassifiedValue: 0,
      unclassifiedValueCzk: 0,
      reconciliationDifference: 0,
      reconciliationStatus: "reconciled",
      raw: {
        ...summary,
        financeOsApiReadCoverage: apiReadCoverage,
        financeOsReconciliation: {
          positionsMarketValue,
          knownCash: {
            availableToTrade,
            inPies: pieCash,
            reservedForOrders: reservedCash,
            total: cashValue,
          },
          providerInvestmentsCurrentValue,
          pieIncludedInInvestments,
          spendingPot: {
            value: spendingPotValue,
            valueCzk: spendingPotValueCzk,
            source: "provider_total_residual",
            confidence: "confirmed_by_card_history",
          },
          unclassifiedValue: 0,
          totalValue,
        },
      },
    });

    // Older builds stored the same Spending Pot as an extra account, which
    // double-counts it because Trading 212 totalValue already includes it.
    getDb()
      .prepare(
        "DELETE FROM accounts WHERE provider = 'trading212' " +
          "AND external_id = 'spending-pot:manual'",
      )
      .run();
  }

  recordSnapshot(accountIdValue);

  let dailyHistory:
    | Awaited<ReturnType<typeof syncTrading212DailyHistory>>
    | { error: string };
  try {
    dailyHistory = await syncTrading212DailyHistory(accountIdValue);
  } catch (error) {
    // Historical market-data reconstruction is best-effort and must never
    // turn a successful provider sync into a failed live-account sync.
    dailyHistory = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    accountId: accountIdValue,
    holdings: holdings.length,
    orders: orders.length,
    dividends: dividends.length,
    cashTransactions: cashTransactions.length,
    apiReadCoverage,
    cardSync,
    cardDetected,
    historyBackfill: {
      ordersComplete:
        getHistorySyncState("history_complete:orders") === "true",
      dividendsComplete:
        getHistorySyncState("history_complete:dividends") === "true",
      cashComplete:
        getHistorySyncState("history_complete:cash") === "true",
    },
    dailyHistory,
  };
  });
}

function mapCashKind(type: string): TransactionKind {
  if (type.includes("deposit")) return "deposit";
  if (type.includes("withdraw")) return "withdrawal";
  if (type.includes("interest")) return "interest";
  if (type.includes("fee")) return "fee";
  if (type.includes("transfer")) return "transfer";
  return "adjustment";
}

function mapCashFlowScope(
  type: string,
): "external" | "internal" | "unclassified" | "not_applicable" {
  // The public transactions endpoint is intentionally superficial. WITHDRAW
  // represents money leaving the Invest account, including 212 Card spending,
  // which is an external outflow for performance. DEPOSIT is ambiguous because
  // card cashback is also surfaced as a generic deposit; the richer CSV export
  // resolves deposits into Deposit vs Spending cashback.
  if (type.includes("deposit")) return "unclassified";
  if (type.includes("withdraw")) return "external";
  if (type.includes("transfer")) return "internal";
  return "not_applicable";
}

function mapCashCategory(type: string) {
  if (type.includes("withdraw")) return "cash_out_external";
  if (type.includes("deposit")) return "cash_in_unclassified";
  if (type.includes("transfer")) return "internal_transfer";
  return type || null;
}

function cryptoLike(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url").slice(0, 64);
}

export const TRADING212_PROVIDER: ProviderId = "trading212";
