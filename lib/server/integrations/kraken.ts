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
import { canonicalCryptoIdentity } from "@/lib/shared/finance-normalization.mjs";
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

    await privateRequest("/0/private/Balance", credentials);
    await privateRequest("/0/private/TradesHistory", credentials, { ofs: 0 });
    await privateRequest("/0/private/Ledgers", credentials, { ofs: 0 });
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

interface KrakenWithdrawalStatus {
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
}

async function fetchRecentWithdrawalStatuses(
  credentials: KrakenCredentials,
): Promise<KrakenWithdrawalStatus[]> {
  try {
    const result = await privateRequest<unknown>(
      "/0/private/WithdrawStatus",
      credentials,
      { cursor: true },
    );
    if (Array.isArray(result)) {
      return result.map((item) => asObject(item) as KrakenWithdrawalStatus);
    }
    const object = asObject(result);
    const withdrawals = object.withdrawals;
    return Array.isArray(withdrawals)
      ? withdrawals.map((item) => asObject(item) as KrakenWithdrawalStatus)
      : [];
  } catch {
    // Ledger sync still remains useful if Kraken does not expose funding status
    // for this account/key. The transfer stays explicitly unclassified.
    return [];
  }
}

function enrichKrakenWalletTransfers(
  statuses: KrakenWithdrawalStatus[],
) {
  const db = getDb();
  const byRef = new Map(
    statuses
      .filter((item) => item.refid)
      .map((item) => [String(item.refid), item]),
  );

  const rows = db
    .prepare(
      "SELECT id, raw_json FROM transactions " +
        "WHERE provider = 'kraken' AND category = 'wallet_transfer_out_unclassified'",
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
    const status = byRef.get(refid);
    if (!status) continue;

    const destination = stringValue(status.info);
    const txid = status.txid ? String(status.txid) : "";
    const counterparty = destination || txid || null;
    const sourceLabel = [status.network, status.method]
      .filter(Boolean)
      .map(String)
      .join(" · ");

    update.run(
      counterparty,
      sourceLabel || "Kraken on-chain withdrawal",
      JSON.stringify({
        ...raw,
        financeOsWithdrawalStatus: status,
      }),
      String(row.id),
    );
  }
}

function reclassifyLegacyKrakenWalletFlows() {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, kind, currency, note, raw_json FROM transactions " +
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
        "t.quantity, t.fee, t.category, t.flow_scope, a.symbol " +
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
      scope === "unclassified" &&
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
      scope === "unclassified" &&
      quantity > 0
    ) {
      // Until an owned source wallet is linked, the carried cost basis of an
      // incoming on-chain transfer is unknown.
      lots.push({ quantity, costCzk: null });
      incompleteSymbols.add(symbol);
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

  let unrealizedKnownTotal = 0;
  let allHoldingsComplete = true;

  for (const holding of holdings) {
    const symbol = String(holding.symbol).toUpperCase();
    const lots = lotsBySymbol.get(symbol) ?? [];
    const remainingQuantity = lots.reduce(
      (sum, lot) => sum + Math.max(0, lot.quantity),
      0,
    );
    const complete =
      !incompleteSymbols.has(symbol) &&
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
    const balances = await privateRequest<Record<string, string>>(
      "/0/private/Balance",
      credentials,
    );
    const pairs = await getAssetPairs();
    const trades = await fetchAllTrades(credentials);
    const ledgers = await fetchAllLedgers(credentials);
    const withdrawalStatuses = await fetchRecentWithdrawalStatuses(credentials);

  const accountExternalId = "spot";
  let cashValueCzk = 0;
  let investedValueCzk = 0;
  const preparedHoldings: Array<{
    rawAsset: string;
    normalized: string;
    quantity: number;
    currentPrice: number | null;
    quote: string;
    valueQuote: number;
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
    raw: { balances },
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
    enrichKrakenWalletTransfers(withdrawalStatuses);
    rebuildKrakenTransferBookValuesAndCostBasis();
    recordSnapshot(accountIdValue);

    return {
      accountId: accountIdValue,
      holdings: holdings.length,
      trades: trades.length,
      ledgers: ledgers.length,
      enrichedWithdrawals: withdrawalStatuses.length,
    };
  });
}
