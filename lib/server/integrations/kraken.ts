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
import {
  canonicalCryptoIdentity,
  quantitiesApproximatelyEqual,
} from "@/lib/shared/finance-normalization.mjs";
import { getDb } from "@/lib/server/db";
import { withProviderSyncLock } from "@/lib/server/provider-sync-lock";

type JsonObject = Record<string, unknown>;

export interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

let nonceCounter = 0;
const privateQueues = new Map<string, Promise<void>>();
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
  const queueKey = credentials.apiKey;
  const previous = privateQueues.get(queueKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  privateQueues.set(queueKey, queued);

  await previous.catch(() => undefined);

  try {
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

    const errors = Array.isArray(json.error)
      ? json.error.map(String).filter(Boolean)
      : [];
    if (errors.length) {
      throw new Error(`Kraken: ${errors.join("; ")}`);
    }

    return json.result as T;
  } finally {
    release();
    if (privateQueues.get(queueKey) === queued) {
      privateQueues.delete(queueKey);
    }
  }
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

function balanceBucket(rawAsset: string) {
  const parts = rawAsset.toUpperCase().split(".");
  if (parts.length < 2) return "spot";
  const suffix = parts.at(-1);
  if (suffix === "B") return "yield_bearing";
  if (suffix === "F") return "auto_rewards";
  if (suffix === "S") return "legacy_staking";
  if (suffix === "M") return "opt_in_rewards";
  if (suffix === "T") return "tokenized";
  return "other";
}

type KrakenExtendedBalance = {
  balance: number;
  holdTrade: number;
  credit: number;
  creditUsed: number;
  available: number;
  bucket: string;
};

function parseExtendedBalances(raw: Record<string, unknown>) {
  const result = new Map<string, KrakenExtendedBalance>();

  for (const [asset, value] of Object.entries(raw)) {
    const object = asObject(value);
    const balance =
      typeof value === "string" || typeof value === "number"
        ? numberValue(value)
        : numberValue(object.balance);
    const holdTrade = numberValue(object.hold_trade);
    const credit = numberValue(object.credit);
    const creditUsed = numberValue(object.credit_used);
    result.set(asset, {
      balance,
      holdTrade,
      credit,
      creditUsed,
      available: balance + credit - creditUsed - holdTrade,
      bucket: balanceBucket(asset),
    });
  }

  return result;
}

function safeKrakenKeyDiagnostics(keyInfo: JsonObject) {
  const permissions = Array.isArray(keyInfo.permissions)
    ? keyInfo.permissions.map(String)
    : [];
  const epochOrNull = (value: unknown) => {
    const raw = stringValue(value);
    const seconds = Number(raw);
    return raw && raw !== "0" && Number.isFinite(seconds)
      ? new Date(seconds * 1000).toISOString()
      : null;
  };

  return {
    name: stringValue(keyInfo.apiKeyName) || null,
    permissions,
    validUntil: epochOrNull(keyInfo.validUntil),
    queryFrom: epochOrNull(keyInfo.queryFrom),
    queryTo: epochOrNull(keyInfo.queryTo),
    createdAt: epochOrNull(keyInfo.createdTime),
    modifiedAt: epochOrNull(keyInfo.modifiedTime),
    lastUsedAt: epochOrNull(keyInfo.lastUsed),
    ipAllowlistCount: Array.isArray(keyInfo.ipAllowlist)
      ? keyInfo.ipAllowlist.length
      : 0,
    hasHistoryRestriction:
      (stringValue(keyInfo.queryFrom) &&
        stringValue(keyInfo.queryFrom) !== "0") ||
      (stringValue(keyInfo.queryTo) &&
        stringValue(keyInfo.queryTo) !== "0"),
    hasExpiry:
      Boolean(stringValue(keyInfo.validUntil)) &&
      stringValue(keyInfo.validUntil) !== "0",
    exportDataEnabled: permissions.includes("export-data"),
    marginQueryEnabled: permissions.includes("query-open-trades"),
  };
}

async function fetchEarnAllocations(credentials: KrakenCredentials) {
  try {
    const result = await privateRequest<JsonObject>(
      "/0/private/Earn/Allocations",
      credentials,
      {
        converted_asset: "CZK",
        hide_zero_allocations: true,
      },
    );
    const items = Array.isArray(result.items) ? result.items : [];
    return {
      available: true,
      convertedAsset: stringValue(result.converted_asset, "CZK"),
      totalAllocatedCzk: numberValue(result.total_allocated),
      totalRewardedCzk: numberValue(result.total_rewarded),
      activeStrategies: items.length,
      items: items.map((value) => {
        const item = asObject(value);
        const allocated = asObject(item.amount_allocated);
        const total = asObject(allocated.total);
        const rewarded = asObject(item.total_rewarded);
        const bonding = asObject(allocated.bonding);
        const unbonding = asObject(allocated.unbonding);
        const exitQueue = asObject(allocated.exit_queue);
        return {
          strategyId: stringValue(item.strategy_id),
          asset: normalizeAssetCode(stringValue(item.native_asset)),
          allocatedNative: numberValue(total.native),
          allocatedCzk: numberValue(total.converted),
          rewardedNative: numberValue(rewarded.native),
          rewardedCzk: numberValue(rewarded.converted),
          bondingNative: numberValue(bonding.native),
          unbondingNative: numberValue(unbonding.native),
          exitQueueNative: numberValue(exitQueue.native),
        };
      }),
      error: null as string | null,
    };
  } catch (error) {
    return {
      available: false,
      convertedAsset: "CZK",
      totalAllocatedCzk: 0,
      totalRewardedCzk: 0,
      activeStrategies: 0,
      items: [] as Array<Record<string, unknown>>,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchMarginStatus(
  credentials: KrakenCredentials,
  enabled: boolean,
) {
  if (!enabled) {
    return {
      queryEnabled: false,
      openPositions: 0,
      error: null as string | null,
    };
  }

  try {
    const positions = await privateRequest<JsonObject>(
      "/0/private/OpenPositions",
      credentials,
      { docalcs: true },
    );
    return {
      queryEnabled: true,
      openPositions: Object.keys(positions).length,
      error: null as string | null,
    };
  } catch (error) {
    return {
      queryEnabled: true,
      openPositions: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
): Promise<{
  price: number | null;
  valueQuote: number;
  valueCzk: number;
  quote: string | null;
}> {
  const normalized = normalizeAssetCode(rawAsset);

  if (isFiat(normalized)) {
    return {
      price: 1,
      valueQuote: quantity,
      valueCzk: await toCzk(quantity, normalized),
      quote: normalized,
    };
  }

  const pair = pairForAsset(rawAsset, pairs);
  if (!pair) {
    return { price: null, valueQuote: 0, valueCzk: 0, quote: null };
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
    valueQuote: quoteValue,
    valueCzk: await toCzk(quoteValue, pair.quote),
    quote: pair.quote,
  };
}

export async function validateKraken(credentials: KrakenCredentials) {
  return withProviderSyncLock("kraken", async () => {
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
    const missing = required.filter(
      (permission) => !permissions.includes(permission),
    );
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

    await privateRequest("/0/private/BalanceEx", credentials);
    await privateRequest("/0/private/TradesHistory", credentials, { ofs: 0 });
    await privateRequest("/0/private/Ledgers", credentials, { ofs: 0 });
    // Earn uses the same Query Funds permission. It is product-dependent, so
    // validation does not fail if the endpoint is unavailable for an account.
    await fetchEarnAllocations(credentials);
    return safeKrakenKeyDiagnostics(keyInfo);
  });
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

function ledgerKind(type: string, currency: string): TransactionKind {
  switch (type) {
    case "deposit":
      return isFiat(currency) ? "deposit" : "transfer";
    case "withdrawal":
      return isFiat(currency) ? "withdrawal" : "transfer";
    case "transfer":
    case "hybridearndeposit":
    case "hybridearnwithdrawal":
      return "transfer";
    case "dividend":
      return "dividend";
    case "staking":
    case "credit":
    case "reward":
      return "interest";
    default:
      return "adjustment";
  }
}

function ledgerFlowScope(
  type: string,
  currency: string,
): "external" | "internal" | "unclassified" | "not_applicable" {
  if ((type === "deposit" || type === "withdrawal") && isFiat(currency)) {
    return "external";
  }
  if ((type === "deposit" || type === "withdrawal") && !isFiat(currency)) {
    return "unclassified";
  }
  if (
    type === "transfer" ||
    type === "hybridearndeposit" ||
    type === "hybridearnwithdrawal"
  ) {
    return "internal";
  }
  return "not_applicable";
}

function ledgerCategory(type: string, currency: string, subtype: string) {
  if (type === "withdrawal" && !isFiat(currency)) {
    return "wallet_transfer_out_unclassified";
  }
  if (type === "deposit" && !isFiat(currency)) {
    return "wallet_transfer_in_unclassified";
  }
  if (
    type === "transfer" ||
    type === "hybridearndeposit" ||
    type === "hybridearnwithdrawal"
  ) {
    return subtype
      ? "kraken_internal_" + subtype
      : "kraken_internal_" + type;
  }
  if (type === "reward") {
    return subtype ? "kraken_reward_" + subtype : "kraken_reward";
  }
  return subtype || null;
}

interface KrakenFundingStatus {
  asset?: string;
  refid?: string;
  txid?: string | null;
  info?: string;
  amount?: string;
  fee?: string;
  time?: number;
  status?: string;
  method?: string;
  network?: string;
  originators?: unknown[];
}

async function fetchRecentLegacyFundingStatuses(
  credentials: KrakenCredentials,
  direction: "deposit" | "withdrawal",
): Promise<{
  rows: KrakenFundingStatus[];
  error: string | null;
}> {
  try {
    const path =
      direction === "deposit"
        ? "/0/private/DepositStatus"
        : "/0/private/WithdrawStatus";
    const result = await privateRequest<unknown>(
      path,
      credentials,
      { cursor: true },
    );
    if (Array.isArray(result)) {
      return {
        rows: result.map((item) => asObject(item) as KrakenFundingStatus),
        error: null,
      };
    }
    const object = asObject(result);
    const list =
      direction === "deposit" ? object.deposits : object.withdrawals;
    return {
      rows: Array.isArray(list)
        ? list.map((item) => asObject(item) as KrakenFundingStatus)
        : [],
      error: null,
    };
  } catch (error) {
    // These are deprecated Kraken funding endpoints. They remain a best-effort
    // enrichment fallback while the ledger remains the accounting source of
    // truth. Failing enrichment must never erase or invent cash flow.
    return {
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function enrichKrakenWalletTransfers(
  deposits: KrakenFundingStatus[],
  withdrawals: KrakenFundingStatus[],
) {
  const db = getDb();
  const depositByRef = new Map(
    deposits
      .filter((item) => item.refid)
      .map((item) => [String(item.refid), item]),
  );
  const withdrawalByRef = new Map(
    withdrawals
      .filter((item) => item.refid)
      .map((item) => [String(item.refid), item]),
  );

  const rows = db
    .prepare(
      "SELECT id, category, raw_json FROM transactions " +
        "WHERE provider = 'kraken' AND category IN (" +
        "'wallet_transfer_in_unclassified', 'wallet_transfer_out_unclassified')",
    )
    .all();

  const update = db.prepare(
    "UPDATE transactions SET counterparty_ref = ?, source_label = ?, raw_json = ? WHERE id = ?",
  );

  for (const row of rows) {
    let raw: JsonObject = {};
    try {
      raw = row.raw_json ? asObject(JSON.parse(String(row.raw_json))) : {};
    } catch {
      raw = {};
    }

    const refid = stringValue(raw.refid);
    const direction = String(row.category).includes("_in_")
      ? "deposit"
      : "withdrawal";
    const status =
      direction === "deposit"
        ? depositByRef.get(refid)
        : withdrawalByRef.get(refid);
    if (!status) continue;

    const address = stringValue(status.info);
    const txid = status.txid ? String(status.txid) : "";
    const originators = Array.isArray(status.originators)
      ? status.originators.map(String).filter(Boolean)
      : [];
    const counterparty =
      address || originators[0] || txid || null;
    const sourceLabel = [status.network, status.method]
      .filter(Boolean)
      .map(String)
      .join(" · ");

    update.run(
      counterparty,
      sourceLabel ||
        (direction === "deposit"
          ? "Kraken on-chain deposit"
          : "Kraken on-chain withdrawal"),
      JSON.stringify({
        ...raw,
        [direction === "deposit"
          ? "financeOsDepositStatus"
          : "financeOsWithdrawalStatus"]: status,
        financeOsFundingTxid: txid || null,
        financeOsFundingAddress: address || null,
        financeOsFundingOriginators: originators,
      }),
      String(row.id),
    );
  }
}

function reclassifyLegacyKrakenWalletFlows() {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, kind, currency, note, category, flow_scope, counterparty_ref, raw_json " +
        "FROM transactions " +
        "WHERE provider = 'kraken' AND external_id LIKE 'ledger:%'",
    )
    .all();
  const update = db.prepare(
    "UPDATE transactions SET kind = ?, flow_scope = ?, category = ? WHERE id = ?",
  );

  for (const row of rows) {
    let raw: JsonObject = {};
    try {
      raw = row.raw_json ? asObject(JSON.parse(String(row.raw_json))) : {};
    } catch {
      raw = {};
    }

    const currentCategory = String(row.category || "");
    const currentCounterparty = String(row.counterparty_ref || "");
    const phantomMatch = asObject(raw.financeOsPhantomMatch);
    const ownedWalletLink =
      currentCategory === "wallet_transfer_out_owned" ||
      currentCategory === "wallet_transfer_in_owned" ||
      currentCounterparty.startsWith("phantom:") ||
      Boolean(phantomMatch.address);

    if (ownedWalletLink) {
      const direction =
        currentCategory.includes("_in_") ||
        stringValue(raw.type).toLowerCase() === "deposit"
          ? "in"
          : "out";
      update.run(
        "transfer",
        "internal",
        direction === "in"
          ? "wallet_transfer_in_owned"
          : "wallet_transfer_out_owned",
        String(row.id),
      );
      continue;
    }

    const type = stringValue(raw.type, String(row.kind)).toLowerCase();
    const subtype = stringValue(raw.subtype);
    const currency = String(row.currency);
    update.run(
      ledgerKind(type, currency),
      ledgerFlowScope(type, currency),
      ledgerCategory(type, currency, subtype),
      String(row.id),
    );
  }
}


function repairLegacyKrakenLedgerQuantities() {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, raw_json FROM transactions " +
        "WHERE provider = 'kraken' AND external_id LIKE 'ledger:%'",
    )
    .all();
  const update = db.prepare(
    "UPDATE transactions SET quantity = ? WHERE id = ?",
  );

  for (const row of rows) {
    try {
      const raw = asObject(JSON.parse(String(row.raw_json || "{}")));
      const amount = numberValue(raw.amount, 0);
      const fee = Math.abs(numberValue(raw.fee, 0));
      update.run(amount - fee, String(row.id));
    } catch {
      // Keep the stored quantity if the provider audit payload is unavailable.
    }
  }
}

type KrakenLot = {
  quantity: number;
  costCzk: number | null;
};

function consumeLots(
  lots: KrakenLot[],
  requestedQuantity: number,
) {
  let remaining = Math.max(0, requestedQuantity);
  let knownCost = 0;
  let complete = true;

  while (remaining > 1e-12 && lots.length) {
    const lot = lots[0];
    const take = Math.min(remaining, lot.quantity);
    if (lot.costCzk === null) {
      complete = false;
    } else if (lot.quantity > 0) {
      knownCost += lot.costCzk * (take / lot.quantity);
    }

    if (lot.costCzk !== null && lot.quantity > 0) {
      lot.costCzk -= lot.costCzk * (take / lot.quantity);
    }
    lot.quantity -= take;
    remaining -= take;

    if (lot.quantity <= 1e-12) lots.shift();
  }

  if (remaining > 1e-10) complete = false;
  return { complete, costCzk: complete ? knownCost : null };
}

function rebuildKrakenTransferBookValuesAndCostBasis() {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT t.id, t.kind, t.occurred_at, t.amount, t.amount_czk, " +
        "t.quantity, t.fee, t.category, t.flow_scope, t.transfer_value_czk, a.symbol " +
        "FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id " +
        "WHERE t.provider = 'kraken' AND t.asset_id IS NOT NULL " +
        "ORDER BY t.occurred_at ASC, t.id ASC",
    )
    .all();

  const lotsBySymbol = new Map<string, KrakenLot[]>();
  const transferUpdate = db.prepare(
    "UPDATE transactions SET transfer_value_czk = ? WHERE id = ?",
  );
  const realizedBySymbol = new Map<string, number>();
  const incompleteSymbols = new Set<string>();

  const lotsFor = (symbol: string) => {
    const existing = lotsBySymbol.get(symbol);
    if (existing) return existing;
    const created: KrakenLot[] = [];
    lotsBySymbol.set(symbol, created);
    return created;
  };

  for (const row of rows) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol || isFiat(symbol)) continue;

    const kind = String(row.kind);
    const category = String(row.category || "");
    const scope = String(row.flow_scope || "legacy");
    const quantity = numberValue(row.quantity, 0);
    const amountCzk =
      row.amount_czk === null || row.amount_czk === undefined
        ? null
        : numberValue(row.amount_czk, 0);
    const amountNative = Math.abs(numberValue(row.amount, 0));
    const feeNative = Math.abs(numberValue(row.fee, 0));
    const historicalFx =
      amountCzk !== null && amountNative > 0
        ? Math.abs(amountCzk) / amountNative
        : null;
    const feeCzk =
      historicalFx === null ? 0 : feeNative * historicalFx;
    const lots = lotsFor(symbol);

    if (kind === "buy" && quantity > 0 && amountCzk !== null) {
      lots.push({
        quantity: Math.abs(quantity),
        costCzk: Math.abs(amountCzk) + feeCzk,
      });
      continue;
    }

    if (kind === "sell" && quantity > 0) {
      const consumed = consumeLots(lots, Math.abs(quantity));
      if (consumed.costCzk === null || amountCzk === null) {
        incompleteSymbols.add(symbol);
      } else {
        realizedBySymbol.set(
          symbol,
          (realizedBySymbol.get(symbol) ?? 0) +
            Math.max(0, Math.abs(amountCzk) - feeCzk) -
            consumed.costCzk,
        );
      }
      continue;
    }

    if (
      kind === "transfer" &&
      category.startsWith("wallet_transfer_out_") &&
      quantity < 0
    ) {
      const consumed = consumeLots(lots, Math.abs(quantity));
      transferUpdate.run(
        consumed.costCzk === null ? null : -consumed.costCzk,
        String(row.id),
      );
      if (consumed.costCzk === null) incompleteSymbols.add(symbol);
      continue;
    }

    if (
      kind === "transfer" &&
      category.startsWith("wallet_transfer_in_") &&
      quantity > 0
    ) {
      const carriedValue =
        row.transfer_value_czk === null ||
        row.transfer_value_czk === undefined
          ? null
          : Math.abs(numberValue(row.transfer_value_czk, 0));
      lots.push({
        quantity,
        costCzk:
          scope === "internal" && carriedValue !== null
            ? carriedValue
            : null,
      });
      if (scope !== "internal" || carriedValue === null) {
        incompleteSymbols.add(symbol);
      }
      continue;
    }

    if (
      (kind === "interest" || kind === "adjustment") &&
      quantity > 0
    ) {
      lots.push({ quantity, costCzk: null });
      incompleteSymbols.add(symbol);
      continue;
    }

    // Kraken-internal allocation/staking bucket moves do not cross the
    // economic asset boundary and therefore must not create or consume lots.
    if (kind === "transfer" && category.startsWith("kraken_internal_")) {
      continue;
    }
  }

  const holdings = db
    .prepare(
      "SELECT h.id, h.quantity, h.market_value_czk, a.symbol " +
        "FROM holdings h JOIN assets a ON a.id = h.asset_id " +
        "JOIN accounts ac ON ac.id = h.account_id " +
        "WHERE ac.provider = 'kraken' AND a.asset_class = 'crypto'",
    )
    .all();

  const holdingUpdate = db.prepare(
    "UPDATE holdings SET average_price = ?, unrealized_pnl_czk = ?, raw_json = ? " +
      "WHERE id = ?",
  );

  const holdingQuantityBySymbol = new Map<string, number>();
  for (const holding of holdings) {
    const symbol = String(holding.symbol).toUpperCase();
    holdingQuantityBySymbol.set(
      symbol,
      (holdingQuantityBySymbol.get(symbol) ?? 0) +
        Math.max(0, numberValue(holding.quantity, 0)),
    );
  }

  let unrealizedKnownTotal = 0;
  let allHoldingsComplete = true;

  for (const holding of holdings) {
    const symbol = String(holding.symbol).toUpperCase();
    const lots = lotsBySymbol.get(symbol) ?? [];
    const remainingQuantity = lots.reduce(
      (sum, lot) => sum + Math.max(0, lot.quantity),
      0,
    );
    const expectedQuantity = holdingQuantityBySymbol.get(symbol) ?? 0;
    const quantityCoverageComplete = quantitiesApproximatelyEqual(
      remainingQuantity,
      expectedQuantity,
    );
    if (!quantityCoverageComplete) incompleteSymbols.add(symbol);

    const complete =
      !incompleteSymbols.has(symbol) &&
      quantityCoverageComplete &&
      lots.every((lot) => lot.costCzk !== null);
    const totalCost = complete
      ? lots.reduce((sum, lot) => sum + (lot.costCzk ?? 0), 0)
      : null;
    const averagePrice =
      complete && remainingQuantity > 1e-12 && totalCost !== null
        ? totalCost / remainingQuantity
        : null;
    const holdingQuantity = Math.max(0, numberValue(holding.quantity, 0));
    const allocatedCost =
      averagePrice === null ? null : averagePrice * holdingQuantity;
    const unrealized =
      allocatedCost === null
        ? null
        : numberValue(holding.market_value_czk, 0) - allocatedCost;

    if (unrealized === null || !complete) {
      allHoldingsComplete = false;
    } else {
      unrealizedKnownTotal += unrealized;
    }

    holdingUpdate.run(
      averagePrice,
      unrealized,
      JSON.stringify({
        costBasisStatus: complete ? "complete" : "incomplete",
        canonicalSymbol: symbol,
        reconstructedFromLedger: true,
      }),
      String(holding.id),
    );
  }

  const realizedComplete = incompleteSymbols.size === 0;
  const realizedTotal = [...realizedBySymbol.values()].reduce(
    (sum, value) => sum + value,
    0,
  );

  const account = db
    .prepare("SELECT id, raw_json FROM accounts WHERE provider = 'kraken' LIMIT 1")
    .get();
  if (account) {
    let raw: JsonObject = {};
    try {
      raw = account.raw_json ? asObject(JSON.parse(String(account.raw_json))) : {};
    } catch {
      raw = {};
    }
    db.prepare(
      "UPDATE accounts SET raw_json = ?, realized_pnl_czk = ?, realized_pnl_status = ?, " +
        "unrealized_pnl_czk = ?, unrealized_pnl_status = ? WHERE id = ?",
    ).run(
      JSON.stringify({
        ...raw,
        costBasisStatus:
          realizedComplete && allHoldingsComplete ? "complete" : "partial",
        incompleteCostBasisSymbols: [...incompleteSymbols].sort(),
        reconstructedRealizedPnlCzk: realizedComplete ? realizedTotal : null,
        reconstructedUnrealizedPnlCzk: allHoldingsComplete
          ? unrealizedKnownTotal
          : null,
      }),
      realizedComplete ? realizedTotal : 0,
      realizedComplete ? "available" : "partial",
      allHoldingsComplete ? unrealizedKnownTotal : 0,
      allHoldingsComplete ? "available" : "partial",
      String(account.id),
    );
  }
}

export async function syncKraken() {
  return withProviderSyncLock("kraken", async () => {
    const connection = getConnectionSecret<KrakenCredentials>("kraken");
    if (!connection) throw new Error("Kraken is not connected.");

    const { credentials } = connection;

    // Private requests are intentionally sequential. Kraken nonces are scoped
    // to the API key, so parallel requests can arrive out of order even if
    // locally generated nonce values are unique.
    const keyInfo = await privateRequest<JsonObject>(
      "/0/private/GetApiKeyInfo",
      credentials,
    );
    const keyDiagnostics = safeKrakenKeyDiagnostics(keyInfo);
    const rawExtendedBalances = await privateRequest<Record<string, unknown>>(
      "/0/private/BalanceEx",
      credentials,
    );
    const extendedBalances = parseExtendedBalances(rawExtendedBalances);
    const pairs = await getAssetPairs();
    const earn = await fetchEarnAllocations(credentials);
    const margin = await fetchMarginStatus(
      credentials,
      keyDiagnostics.marginQueryEnabled,
    );
    const trades = await fetchAllTrades(credentials);
    const ledgers = await fetchAllLedgers(credentials);
    const depositStatuses = await fetchRecentLegacyFundingStatuses(
      credentials,
      "deposit",
    );
    const withdrawalStatuses = await fetchRecentLegacyFundingStatuses(
      credentials,
      "withdrawal",
    );

  const accountExternalId = "spot";
  let cashValueCzk = 0;
  let investedValueCzk = 0;
  const preparedHoldings: Array<{
    rawAsset: string;
    normalized: string;
    quantity: number;
    availableQuantity: number;
    heldTradeQuantity: number;
    balanceBucket: string;
    currentPrice: number | null;
    quote: string;
    valueQuote: number;
    valueCzk: number;
  }> = [];

  for (const [rawAsset, extended] of extendedBalances.entries()) {
    const quantity = extended.balance;
    if (!quantity) continue;

    const normalized = normalizeAssetCode(rawAsset);
    const priced = await priceAssetInCzk(rawAsset, quantity, pairs);
    if (isFiat(normalized)) cashValueCzk += priced.valueCzk;
    else investedValueCzk += priced.valueCzk;

    preparedHoldings.push({
      rawAsset,
      normalized,
      quantity,
      availableQuantity: extended.available,
      heldTradeQuantity: extended.holdTrade,
      balanceBucket: extended.bucket,
      currentPrice: priced.price,
      quote: priced.quote || normalized,
      valueQuote: priced.valueQuote,
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
    realizedPnlStatus: "unavailable",
    unrealizedPnlStatus: "unavailable",
    cashValueCzk,
    investedValueCzk,
    totalValueCzk,
    realizedPnlCzk: 0,
    unrealizedPnlCzk: 0,
    raw: {
      balances: Object.fromEntries(
        [...extendedBalances.entries()].map(([asset, value]) => [
          asset,
          {
            balance: value.balance,
            holdTrade: value.holdTrade,
            credit: value.credit,
            creditUsed: value.creditUsed,
            available: value.available,
            bucket: value.bucket,
          },
        ]),
      ),
      financeOsKrakenV2: {
        balanceSource: "BalanceEx",
        key: keyDiagnostics,
        earn,
        margin,
        funding: {
          legacyDepositStatusRows: depositStatuses.rows.length,
          legacyWithdrawalStatusRows: withdrawalStatuses.rows.length,
          legacyDepositStatusError: depositStatuses.error,
          legacyWithdrawalStatusError: withdrawalStatuses.error,
          api: "legacy_status_fallback",
        },
      },
    },
  });

  const holdings = [];
  for (const item of preparedHoldings) {
    const identity = canonicalCryptoIdentity(item.normalized, item.rawAsset);
    const assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: item.rawAsset,
      symbol: item.normalized,
      name: item.normalized,
      assetClass: isFiat(item.normalized) ? "cash" : "crypto",
      currency: item.quote,
      canonicalKey: isFiat(item.normalized)
        ? "currency:" + item.normalized
        : identity.canonicalKey,
      listingSymbol: identity.listingSymbol,
      raw: { rawAsset: item.rawAsset, financeOsIdentity: identity },
    });

    holdings.push({
      accountId: accountIdValue,
      assetId: assetIdValue,
      quantity: item.quantity,
      averagePrice: null,
      currentPrice: item.currentPrice,
      currency: item.quote,
      marketValue: item.valueQuote,
      marketValueCzk: item.valueCzk,
      unrealizedPnl: null,
      unrealizedPnlCzk: null,
      raw: {
        rawAsset: item.rawAsset,
        financeOsKrakenBalance: {
          bucket: item.balanceBucket,
          totalQuantity: item.quantity,
          availableQuantity: item.availableQuantity,
          heldTradeQuantity: item.heldTradeQuantity,
        },
      },
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
    const identity = canonicalCryptoIdentity(base, baseRaw);
    assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: baseRaw,
      symbol: base,
      name: base,
      assetClass: "crypto",
      currency: quote,
      canonicalKey: identity.canonicalKey,
      listingSymbol: identity.listingSymbol,
      raw: { ...pairMeta, financeOsIdentity: identity },
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
    const ledgerFee = Math.abs(numberValue(ledger.fee, 0));
    const balanceDelta = amount - ledgerFee;
    const occurredAt = new Date(numberValue(ledger.time) * 1000).toISOString();

    let amountCzk: number | null = null;
    if (isFiat(currency)) {
      amountCzk = await maybeToCzk(amount, currency, occurredAt);
    } else {
      // Do not value historical crypto ledger movements using today's crypto price.
      // A dedicated historical market-price engine will fill these values later.
      amountCzk = null;
    }

    const identity = canonicalCryptoIdentity(currency, rawAsset);
    const assetIdValue = upsertAsset({
      provider: "kraken",
      externalId: rawAsset,
      symbol: identity.canonicalSymbol,
      name: identity.canonicalSymbol,
      assetClass: isFiat(currency) ? "cash" : "crypto",
      currency,
      canonicalKey: isFiat(currency)
        ? "currency:" + identity.canonicalSymbol
        : identity.canonicalKey,
      listingSymbol: identity.listingSymbol,
      raw: { rawAsset, financeOsIdentity: identity },
    });

    upsertTransaction({
      provider: "kraken",
      accountId: accountIdValue,
      externalId: `ledger:${ledgerId}`,
      kind: ledgerKind(type, currency),
      occurredAt,
      currency,
      amount,
      amountCzk,
      assetId: assetIdValue,
      quantity: balanceDelta,
      fee: ledgerFee,
      note: [type, stringValue(ledger.subtype)].filter(Boolean).join(" · "),
      category: ledgerCategory(type, currency, stringValue(ledger.subtype)),
      flowScope: ledgerFlowScope(type, currency),
      raw: ledger,
    });
  }

    reclassifyLegacyKrakenWalletFlows();
    repairLegacyKrakenLedgerQuantities();
    enrichKrakenWalletTransfers(
      depositStatuses.rows,
      withdrawalStatuses.rows,
    );
    rebuildKrakenTransferBookValuesAndCostBasis();
    recordSnapshot(accountIdValue);

    return {
      accountId: accountIdValue,
      holdings: holdings.length,
      trades: trades.length,
      ledgers: ledgers.length,
      enrichedDeposits: depositStatuses.rows.length,
      enrichedWithdrawals: withdrawalStatuses.rows.length,
      earnAllocations: earn.activeStrategies,
      openMarginPositions: margin.openPositions,
      balanceSource: "BalanceEx",
    };
  });
}


export function getKrakenStatus() {
  const db = getDb();
  const connection = db
    .prepare(
      "SELECT status, last_synced_at, last_error FROM connections WHERE provider = 'kraken' LIMIT 1",
    )
    .get();
  const account = db
    .prepare(
      "SELECT id, total_value_czk, raw_json FROM accounts WHERE provider = 'kraken' LIMIT 1",
    )
    .get();

  let raw: JsonObject = {};
  try {
    raw = account?.raw_json
      ? asObject(JSON.parse(String(account.raw_json)))
      : {};
  } catch {
    raw = {};
  }

  const v2 = asObject(raw.financeOsKrakenV2);
  const key = asObject(v2.key);
  const earn = asObject(v2.earn);
  const margin = asObject(v2.margin);
  const funding = asObject(v2.funding);

  const transferAudit = db
    .prepare(
      "SELECT " +
        "SUM(CASE WHEN category LIKE 'wallet_transfer_%_unclassified' THEN 1 ELSE 0 END) AS unclassified_count, " +
        "SUM(CASE WHEN category LIKE 'wallet_transfer_%_owned' THEN 1 ELSE 0 END) AS owned_count, " +
        "SUM(CASE WHEN category LIKE 'wallet_transfer_%_unclassified' AND transfer_value_czk IS NOT NULL THEN 1 ELSE 0 END) AS unclassified_with_book_value " +
        "FROM transactions WHERE provider = 'kraken'",
    )
    .get();

  const costBasis = db
    .prepare(
      "SELECT realized_pnl_status, unrealized_pnl_status, raw_json " +
        "FROM accounts WHERE provider = 'kraken' LIMIT 1",
    )
    .get();
  let costRaw: JsonObject = {};
  try {
    costRaw = costBasis?.raw_json
      ? asObject(JSON.parse(String(costBasis.raw_json)))
      : {};
  } catch {
    costRaw = {};
  }
  const incompleteSymbols = Array.isArray(costRaw.incompleteCostBasisSymbols)
    ? costRaw.incompleteCostBasisSymbols.map(String)
    : [];

  const holdingRows = account?.id
    ? db
        .prepare(
          "SELECT market_value_czk, raw_json FROM holdings WHERE account_id = ?",
        )
        .all(String(account.id))
    : [];
  let heldValueCzk = 0;
  let availableValueCzk = 0;
  const balanceBuckets = new Map<string, number>();
  for (const row of holdingRows) {
    const holdingRaw = (() => {
      try {
        return row.raw_json
          ? asObject(JSON.parse(String(row.raw_json)))
          : {};
      } catch {
        return {};
      }
    })();
    const balance = asObject(holdingRaw.financeOsKrakenBalance);
    const totalQuantity = numberValue(balance.totalQuantity);
    const heldQuantity = numberValue(balance.heldTradeQuantity);
    const availableQuantity = numberValue(balance.availableQuantity);
    const valueCzk = numberValue(row.market_value_czk);
    if (totalQuantity > 0) {
      heldValueCzk += valueCzk * (heldQuantity / totalQuantity);
      availableValueCzk += valueCzk * (availableQuantity / totalQuantity);
    }
    const bucket = stringValue(balance.bucket, "unknown");
    balanceBuckets.set(
      bucket,
      (balanceBuckets.get(bucket) ?? 0) + valueCzk,
    );
  }

  return {
    connected: Boolean(connection),
    status: connection?.status ? String(connection.status) : "not_connected",
    lastSyncedAt: connection?.last_synced_at
      ? String(connection.last_synced_at)
      : null,
    lastError: connection?.last_error ? String(connection.last_error) : null,
    totalValueCzk:
      account?.total_value_czk === null ||
      account?.total_value_czk === undefined
        ? null
        : numberValue(account.total_value_czk),
    balanceSource:
      typeof v2.balanceSource === "string" ? v2.balanceSource : null,
    heldValueCzk,
    availableValueCzk,
    balanceBuckets: Object.fromEntries(balanceBuckets),
    earn: {
      available: earn.available === true,
      allocatedCzk: numberValue(earn.totalAllocatedCzk),
      rewardedCzk: numberValue(earn.totalRewardedCzk),
      activeStrategies: numberValue(earn.activeStrategies),
      error: typeof earn.error === "string" ? earn.error : null,
    },
    margin: {
      queryEnabled: margin.queryEnabled === true,
      openPositions: numberValue(margin.openPositions),
      error: typeof margin.error === "string" ? margin.error : null,
    },
    key: {
      name: typeof key.name === "string" ? key.name : null,
      hasHistoryRestriction: key.hasHistoryRestriction === true,
      hasExpiry: key.hasExpiry === true,
      validUntil: typeof key.validUntil === "string" ? key.validUntil : null,
      queryFrom: typeof key.queryFrom === "string" ? key.queryFrom : null,
      queryTo: typeof key.queryTo === "string" ? key.queryTo : null,
      exportDataEnabled: key.exportDataEnabled === true,
      marginQueryEnabled: key.marginQueryEnabled === true,
      ipAllowlistCount: numberValue(key.ipAllowlistCount),
    },
    funding: {
      ownedTransfers: numberValue(transferAudit?.owned_count),
      unclassifiedTransfers: numberValue(transferAudit?.unclassified_count),
      unclassifiedTransfersWithBookValue: numberValue(
        transferAudit?.unclassified_with_book_value,
      ),
      depositStatusRows: numberValue(funding.legacyDepositStatusRows),
      withdrawalStatusRows: numberValue(
        funding.legacyWithdrawalStatusRows,
      ),
      depositStatusError:
        typeof funding.legacyDepositStatusError === "string"
          ? funding.legacyDepositStatusError
          : null,
      withdrawalStatusError:
        typeof funding.legacyWithdrawalStatusError === "string"
          ? funding.legacyWithdrawalStatusError
          : null,
      api: typeof funding.api === "string" ? funding.api : null,
    },
    costBasis: {
      status:
        typeof costRaw.costBasisStatus === "string"
          ? costRaw.costBasisStatus
          : null,
      incompleteSymbols,
      realizedStatus: costBasis?.realized_pnl_status
        ? String(costBasis.realized_pnl_status)
        : null,
      unrealizedStatus: costBasis?.unrealized_pnl_status
        ? String(costBasis.unrealized_pnl_status)
        : null,
    },
  };
}
