import {
  recordSnapshot,
  replaceHoldings,
  upsertAccount,
  upsertAsset,
  upsertTransaction,
} from "@/lib/server/repository";
import type { HoldingInput } from "@/lib/server/repository";
import { getConnectionSecret } from "@/lib/server/repository";
import { getDb } from "@/lib/server/db";
import { toCzk } from "@/lib/server/fx";
import { withProviderSyncLock } from "@/lib/server/provider-sync-lock";

type JsonObject = Record<string, unknown>;

export interface PhantomCredentials {
  address: string;
}

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const TOKEN_META: Record<
  string,
  { symbol: string; name: string; pricePair?: string; stableUsd?: number }
> = {
  [USDC_MINT]: {
    symbol: "USDC",
    name: "USD Coin",
    pricePair: "USDCUSD",
    stableUsd: 1,
  },
};

const priceCache = new Map<string, { fetchedAt: number; price: number }>();

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Solana RPC failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (payload.error) {
    throw new Error(
      "Solana RPC: " +
        (payload.error.message || "unknown error") +
        (payload.error.code ? ` (${payload.error.code})` : ""),
    );
  }
  if (payload.result === undefined) {
    throw new Error("Solana RPC returned no result.");
  }
  return payload.result;
}

async function krakenUsdPrice(pair: string, fallback?: number) {
  const cached = priceCache.get(pair);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    return cached.price;
  }

  try {
    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("ticker http");

    const payload = (await response.json()) as {
      error?: unknown[];
      result?: Record<string, JsonObject>;
    };
    const errors = Array.isArray(payload.error)
      ? payload.error.map(String).filter(Boolean)
      : [];
    if (errors.length) throw new Error(errors.join("; "));

    const ticker = Object.values(payload.result || {})[0] || {};
    const close = Array.isArray(ticker.c) ? ticker.c : [];
    const price = num(close[0], Number.NaN);
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid ticker");

    priceCache.set(pair, { fetchedAt: Date.now(), price });
    return price;
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`Current USD price is unavailable for ${pair}.`);
  }
}

async function solUsdPrice() {
  return krakenUsdPrice("SOLUSD");
}

async function tokenUsdPrice(
  meta: (typeof TOKEN_META)[string],
): Promise<number | null> {
  if (meta.pricePair) {
    try {
      return await krakenUsdPrice(meta.pricePair, meta.stableUsd);
    } catch {
      return meta.stableUsd ?? null;
    }
  }
  return meta.stableUsd ?? null;
}

function validAddressShape(address: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export async function validatePhantom(credentials: PhantomCredentials) {
  return withProviderSyncLock("phantom", async () => {
    const address = credentials.address.trim();
    if (!validAddressShape(address)) {
      throw new Error("Phantom Solana address has an invalid format.");
    }

    await rpc<{ context: unknown; value: number }>("getBalance", [
      address,
      { commitment: "confirmed" },
    ]);
  });
}

interface TokenBalance {
  mint: string;
  quantity: number;
}

async function readWallet(address: string) {
  const [balanceResult, tokenResult] = await Promise.all([
    rpc<{ context: unknown; value: number }>("getBalance", [
      address,
      { commitment: "confirmed" },
    ]),
    rpc<{ context: unknown; value: unknown[] }>("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_PROGRAM },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
  ]);

  const tokens: TokenBalance[] = [];
  for (const rawEntry of Array.isArray(tokenResult.value) ? tokenResult.value : []) {
    const entry = asObject(rawEntry);
    const account = asObject(entry.account);
    const data = asObject(account.data);
    const parsed = asObject(data.parsed);
    const info = asObject(parsed.info);
    const mint = text(info.mint);
    const tokenAmount = asObject(info.tokenAmount);
    const quantity = num(
      tokenAmount.uiAmountString ?? tokenAmount.uiAmount,
      0,
    );
    if (!mint || quantity <= 0) continue;
    tokens.push({ mint, quantity });
  }

  return {
    sol: num(balanceResult.value) / 1_000_000_000,
    tokens,
  };
}

function destinationFromRaw(rawJson: unknown) {
  try {
    const raw = asObject(JSON.parse(String(rawJson || "{}")));
    const status = asObject(raw.financeOsWithdrawalStatus);
    return text(status.info);
  } catch {
    return "";
  }
}

function matchesAddress(candidate: string, address: string) {
  if (!candidate) return false;
  const normalized = candidate.trim();
  return (
    normalized === address ||
    (address.length >= 32 && normalized.includes(address))
  );
}

function phantomAssetExternalId(symbol: string) {
  if (symbol === "SOL") return "native:SOL";
  if (symbol === "USDC") return USDC_MINT;
  return "symbol:" + symbol;
}

function linkKrakenTransfers(
  accountId: string,
  address: string,
) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT t.id, t.occurred_at, t.currency, t.amount, t.quantity, " +
        "t.transfer_value_czk, t.counterparty_ref, t.raw_json " +
        "FROM transactions t " +
        "WHERE t.provider = 'kraken' " +
        "AND t.kind = 'transfer' " +
        "AND t.category IN ('wallet_transfer_out_unclassified', 'wallet_transfer_out_owned') " +
        "ORDER BY t.occurred_at ASC",
    )
    .all();

  const sourceUpdate = db.prepare(
    "UPDATE transactions SET flow_scope = 'internal', " +
      "category = 'wallet_transfer_out_owned', counterparty_ref = ?, " +
      "source_label = ? WHERE id = ?",
  );

  let matched = 0;
  let matchedWithBookValue = 0;

  for (const row of rows) {
    const currentCounterparty = text(row.counterparty_ref);
    const rawDestination = destinationFromRaw(row.raw_json);
    const alreadyLinked = currentCounterparty === "phantom:" + address;
    if (
      !alreadyLinked &&
      !matchesAddress(currentCounterparty, address) &&
      !matchesAddress(rawDestination, address)
    ) {
      continue;
    }

    sourceUpdate.run(
      "phantom:" + address,
      "Kraken → Phantom",
      String(row.id),
    );

    const symbol = String(row.currency || "").toUpperCase();
    if (!symbol) continue;

    const externalId = phantomAssetExternalId(symbol);
    const assetId = upsertAsset({
      provider: "phantom",
      externalId,
      symbol,
      name: symbol === "USDC" ? "USD Coin" : symbol,
      assetClass: "crypto",
      currency: "USD",
      raw: {
        source: "matched-kraken-transfer",
        phantomAddress: address,
      },
    });

    const transferValue =
      row.transfer_value_czk === null || row.transfer_value_czk === undefined
        ? null
        : Math.abs(num(row.transfer_value_czk));

    upsertTransaction({
      provider: "phantom",
      accountId,
      externalId: "kraken-transfer:" + String(row.id),
      kind: "transfer",
      occurredAt: String(row.occurred_at),
      currency: symbol,
      amount: Math.abs(num(row.amount)),
      amountCzk: null,
      assetId,
      quantity: Math.abs(num(row.amount)),
      fee: 0,
      note: "Kraken → Phantom",
      category: "wallet_transfer_in_owned",
      sourceLabel: "Kraken → Phantom",
      flowScope: "internal",
      counterpartyRef: "kraken:" + String(row.id),
      transferValueCzk: transferValue,
      raw: {
        mirroredFromProvider: "kraken",
        mirroredTransactionId: String(row.id),
        phantomAddress: address,
      },
    });

    matched += 1;
    if (transferValue !== null) matchedWithBookValue += 1;
  }

  return { matched, matchedWithBookValue };
}

export async function syncPhantom() {
  return withProviderSyncLock("phantom", async () => {
    const connection = getConnectionSecret<PhantomCredentials>("phantom");
    if (!connection) throw new Error("Phantom is not connected.");

    const address = connection.credentials.address.trim();
    const wallet = await readWallet(address);
    const solPriceUsd = await solUsdPrice();
    const solMarketUsd = wallet.sol * solPriceUsd;
    const solMarketCzk = await toCzk(solMarketUsd, "USD");

    const accountId = upsertAccount({
      provider: "phantom",
      externalId: address,
      name: "Phantom",
      type: "crypto",
      currency: "CZK",
      cashValue: 0,
      investedValue: solMarketCzk,
      totalValue: solMarketCzk,
      realizedPnl: 0,
      unrealizedPnl: 0,
      cashValueCzk: 0,
      investedValueCzk: solMarketCzk,
      totalValueCzk: solMarketCzk,
      realizedPnlCzk: 0,
      unrealizedPnlCzk: 0,
      reconciliationStatus: "unknown",
      raw: {
        chain: "solana",
        address,
        rpc: "official-public",
        valuationStatus: "pending-token-pricing",
      },
    });

    const holdings: HoldingInput[] = [];
    const solAssetId = upsertAsset({
      provider: "phantom",
      externalId: "native:SOL",
      symbol: "SOL",
      name: "Solana",
      assetClass: "crypto",
      currency: "USD",
      raw: { chain: "solana", native: true },
    });
    if (wallet.sol > 0) {
      holdings.push({
        accountId,
        assetId: solAssetId,
        quantity: wallet.sol,
        averagePrice: null,
        currentPrice: solPriceUsd,
        currency: "USD",
        marketValue: solMarketUsd,
        marketValueCzk: solMarketCzk,
        unrealizedPnl: null,
        unrealizedPnlCzk: null,
        raw: { chain: "solana", native: true },
      });
    }

    let knownValueCzk = solMarketCzk;
    let knownValueUsd = solMarketUsd;
    const unpricedMints: string[] = [];

    for (const token of wallet.tokens) {
      const meta = TOKEN_META[token.mint];
      const symbol = meta?.symbol || token.mint.slice(0, 6) + "…";
      const tokenPriceUsd = meta ? await tokenUsdPrice(meta) : null;
      const marketUsd =
        tokenPriceUsd === null ? 0 : token.quantity * tokenPriceUsd;
      const marketCzk =
        tokenPriceUsd === null ? 0 : await toCzk(marketUsd, "USD");

      if (tokenPriceUsd === null) unpricedMints.push(token.mint);
      knownValueUsd += marketUsd;
      knownValueCzk += marketCzk;

      const assetId = upsertAsset({
        provider: "phantom",
        externalId: token.mint,
        symbol,
        name: meta?.name || "Solana token " + token.mint.slice(0, 8),
        assetClass: "crypto",
        currency: "USD",
        raw: {
          chain: "solana",
          mint: token.mint,
          pricing: tokenPriceUsd === null ? "unpriced" : "current-usd",
        },
      });

      holdings.push({
        accountId,
        assetId,
        quantity: token.quantity,
        averagePrice: null,
        currentPrice: tokenPriceUsd,
        currency: "USD",
        marketValue: marketUsd,
        marketValueCzk: marketCzk,
        unrealizedPnl: null,
        unrealizedPnlCzk: null,
        raw: {
          chain: "solana",
          mint: token.mint,
          pricing: tokenPriceUsd === null ? "unpriced" : "current-usd",
        },
      });
    }

    replaceHoldings(accountId, holdings);

    const links = linkKrakenTransfers(accountId, address);
    const valuationStatus = unpricedMints.length ? "partial" : "complete";

    upsertAccount({
      provider: "phantom",
      externalId: address,
      name: "Phantom",
      type: "crypto",
      currency: "CZK",
      cashValue: 0,
      investedValue: knownValueCzk,
      totalValue: knownValueCzk,
      realizedPnl: 0,
      unrealizedPnl: 0,
      cashValueCzk: 0,
      investedValueCzk: knownValueCzk,
      totalValueCzk: knownValueCzk,
      realizedPnlCzk: 0,
      unrealizedPnlCzk: 0,
      reconciliationDifference: 0,
      reconciliationStatus: unpricedMints.length ? "warning" : "reconciled",
      raw: {
        chain: "solana",
        address,
        rpc: "official-public",
        valuationStatus,
        knownValueUsd,
        knownValueCzk,
        unpricedMints,
        matchedKrakenTransfers: links.matched,
        matchedKrakenTransfersWithBookValue: links.matchedWithBookValue,
      },
    });

    recordSnapshot(accountId);

    return {
      accountId,
      address,
      holdings: holdings.length,
      knownValueCzk,
      unpricedTokens: unpricedMints.length,
      matchedKrakenTransfers: links.matched,
      matchedKrakenTransfersWithBookValue: links.matchedWithBookValue,
    };
  });
}
