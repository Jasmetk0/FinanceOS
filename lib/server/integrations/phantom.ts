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
import { canonicalCryptoIdentity } from "@/lib/shared/finance-normalization.mjs";

type JsonObject = Record<string, unknown>;

export interface PhantomCredentials {
  address: string;
}

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
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
  const [balanceResult, legacyTokens, token2022] = await Promise.all([
    rpc<{ context: unknown; value: number }>("getBalance", [
      address,
      { commitment: "confirmed" },
    ]),
    rpc<{ context: unknown; value: unknown[] }>("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_PROGRAM },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
    rpc<{ context: unknown; value: unknown[] }>("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_2022_PROGRAM },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]).catch(() => ({ context: null, value: [] as unknown[] })),
  ]);

  const tokensByMint = new Map<string, number>();
  const tokenRows = [
    ...(Array.isArray(legacyTokens.value) ? legacyTokens.value : []),
    ...(Array.isArray(token2022.value) ? token2022.value : []),
  ];
  for (const rawEntry of tokenRows) {
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
    tokensByMint.set(mint, (tokensByMint.get(mint) ?? 0) + quantity);
  }

  return {
    sol: num(balanceResult.value) / 1_000_000_000,
    tokens: [...tokensByMint.entries()].map(([mint, quantity]) => ({
      mint,
      quantity,
    })),
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

type KrakenWalletTransfer = {
  id: string;
  occurredAt: string;
  currency: string;
  amount: number;
  direction: "to_phantom" | "from_phantom";
  counterpartyRef: string;
  rawJson: string;
};

type SolanaWalletDelta = {
  signature: string;
  occurredAt: string;
  symbol: string;
  quantity: number;
};

function unlinkedKrakenTransfers(): KrakenWalletTransfer[] {
  return getDb()
    .prepare(
      "SELECT id, occurred_at, currency, amount, category, counterparty_ref, raw_json " +
        "FROM transactions WHERE provider = 'kraken' " +
        "AND kind = 'transfer' " +
        "AND category IN ('wallet_transfer_out_unclassified', 'wallet_transfer_in_unclassified') " +
        "ORDER BY occurred_at ASC",
    )
    .all()
    .map((row) => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      currency: String(row.currency || "").toUpperCase(),
      amount: Math.abs(num(row.amount)),
      direction:
        String(row.category) === "wallet_transfer_in_unclassified"
          ? "from_phantom" as const
          : "to_phantom" as const,
      counterpartyRef: text(row.counterparty_ref),
      rawJson: String(row.raw_json || "{}"),
    }));
}

function accountKeysFromTransaction(transaction: JsonObject) {
  const message = asObject(asObject(transaction.transaction).message);
  const rawKeys = Array.isArray(message.accountKeys)
    ? message.accountKeys
    : [];

  return rawKeys.map((raw) => {
    if (typeof raw === "string") return raw;
    return text(asObject(raw).pubkey);
  });
}

function tokenBalanceQuantity(raw: unknown) {
  const balance = asObject(raw);
  const ui = asObject(balance.uiTokenAmount);
  return num(ui.uiAmountString ?? ui.uiAmount, 0);
}

function walletDeltasFromTransaction(
  signature: string,
  blockTime: number,
  transaction: JsonObject,
  address: string,
): SolanaWalletDelta[] {
  const transfers: SolanaWalletDelta[] = [];
  const meta = asObject(transaction.meta);
  const keys = accountKeysFromTransaction(transaction);
  const addressIndex = keys.findIndex((key) => key === address);

  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  if (addressIndex >= 0) {
    const deltaLamports =
      num(postBalances[addressIndex]) - num(preBalances[addressIndex]);
    if (deltaLamports !== 0) {
      transfers.push({
        signature,
        occurredAt: new Date(blockTime * 1000).toISOString(),
        symbol: "SOL",
        quantity: deltaLamports / 1_000_000_000,
      });
    }
  }

  const preByMint = new Map<string, number>();
  const postByMint = new Map<string, number>();

  for (const raw of Array.isArray(meta.preTokenBalances)
    ? meta.preTokenBalances
    : []) {
    const balance = asObject(raw);
    if (text(balance.owner) !== address) continue;
    const mint = text(balance.mint);
    if (!mint) continue;
    preByMint.set(
      mint,
      (preByMint.get(mint) ?? 0) + tokenBalanceQuantity(balance),
    );
  }

  for (const raw of Array.isArray(meta.postTokenBalances)
    ? meta.postTokenBalances
    : []) {
    const balance = asObject(raw);
    if (text(balance.owner) !== address) continue;
    const mint = text(balance.mint);
    if (!mint) continue;
    postByMint.set(
      mint,
      (postByMint.get(mint) ?? 0) + tokenBalanceQuantity(balance),
    );
  }

  for (const mint of new Set([...preByMint.keys(), ...postByMint.keys()])) {
    const delta = (postByMint.get(mint) ?? 0) - (preByMint.get(mint) ?? 0);
    if (delta === 0) continue;
    const symbol = TOKEN_META[mint]?.symbol || mint;
    transfers.push({
      signature,
      occurredAt: new Date(blockTime * 1000).toISOString(),
      symbol,
      quantity: delta,
    });
  }

  return transfers;
}

async function scanSolanaWalletDeltas(
  address: string,
  krakenTransfers: KrakenWalletTransfer[],
) {
  if (!krakenTransfers.length) {
    return {
      candidates: [] as SolanaWalletDelta[],
      signaturesScanned: 0,
      historyCompleteToOldestTransfer: true,
    };
  }

  const oldest =
    Math.min(
      ...krakenTransfers.map((item) => new Date(item.occurredAt).getTime()),
    ) - 24 * 60 * 60 * 1000;
  const newest =
    Math.max(
      ...krakenTransfers.map((item) => new Date(item.occurredAt).getTime()),
    ) + 24 * 60 * 60 * 1000;

  const signatures: Array<{ signature: string; blockTime: number }> = [];
  let before: string | undefined;
  let reachedOldest = false;

  for (let page = 0; page < 5; page += 1) {
    const options: Record<string, unknown> = { limit: 1000 };
    if (before) options.before = before;

    const result = await rpc<unknown[]>("getSignaturesForAddress", [
      address,
      options,
    ]);
    const rows = Array.isArray(result) ? result : [];
    if (!rows.length) {
      reachedOldest = true;
      break;
    }

    for (const raw of rows) {
      const item = asObject(raw);
      const signature = text(item.signature);
      const blockTime = num(item.blockTime, 0);
      if (!signature || !blockTime) continue;
      const timeMs = blockTime * 1000;
      if (timeMs >= oldest && timeMs <= newest) {
        signatures.push({ signature, blockTime });
      }
      if (timeMs < oldest) reachedOldest = true;
    }

    const last = asObject(rows.at(-1));
    before = text(last.signature) || undefined;
    if (reachedOldest || !before) break;
  }

  const windows = krakenTransfers.map((item) => ({
    time: new Date(item.occurredAt).getTime(),
    symbol: item.currency,
  }));
  const candidateSignatures = signatures.filter((item) =>
    windows.some(
      (window) =>
        Math.abs(item.blockTime * 1000 - window.time) <=
        24 * 60 * 60 * 1000,
    ),
  );

  const candidates: SolanaWalletDelta[] = [];
  for (const item of candidateSignatures) {
    try {
      const transaction = await rpc<JsonObject | null>("getTransaction", [
        item.signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!transaction) continue;
      candidates.push(
        ...walletDeltasFromTransaction(
          item.signature,
          item.blockTime,
          transaction,
          address,
        ),
      );
    } catch {
      // Best-effort historical enrichment. Current wallet valuation must still
      // succeed if an archival transaction is unavailable from public RPC.
    }
  }

  return {
    candidates,
    signaturesScanned: signatures.length,
    historyCompleteToOldestTransfer: reachedOldest,
  };
}

function quantityMatches(expected: number, actual: number) {
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-6);
  return Math.abs(expected - actual) <= tolerance;
}

async function matchKrakenWithdrawalsFromChain(address: string) {
  const krakenTransfers = unlinkedKrakenTransfers();
  if (!krakenTransfers.length) {
    return {
      matched: 0,
      candidates: 0,
      signaturesScanned: 0,
      historyCompleteToOldestTransfer: true,
    };
  }

  const scan = await scanSolanaWalletDeltas(address, krakenTransfers);
  const used = new Set<string>();
  const db = getDb();
  const update = db.prepare(
    "UPDATE transactions SET counterparty_ref = ?, source_label = ?, raw_json = ? WHERE id = ?",
  );

  let matched = 0;

  for (const source of krakenTransfers) {
    if (matchesAddress(source.counterpartyRef, address)) continue;

    const sourceTime = new Date(source.occurredAt).getTime();
    const possible = scan.candidates
      .filter(
        (candidate) =>
          !used.has(candidate.signature + ":" + candidate.symbol) &&
          candidate.symbol === source.currency &&
          (source.direction === "to_phantom"
            ? candidate.quantity > 0
            : candidate.quantity < 0) &&
          quantityMatches(source.amount, Math.abs(candidate.quantity)) &&
          Math.abs(
            new Date(candidate.occurredAt).getTime() - sourceTime,
          ) <=
            24 * 60 * 60 * 1000,
      )
      .sort(
        (a, b) =>
          Math.abs(new Date(a.occurredAt).getTime() - sourceTime) -
          Math.abs(new Date(b.occurredAt).getTime() - sourceTime),
      );

    if (possible.length !== 1) continue;
    const match = possible[0];
    used.add(match.signature + ":" + match.symbol);

    let raw: JsonObject = {};
    try {
      raw = asObject(JSON.parse(source.rawJson));
    } catch {
      raw = {};
    }

    update.run(
      address,
      source.direction === "to_phantom"
        ? "Kraken → Phantom · chain match"
        : "Phantom → Kraken · chain match",
      JSON.stringify({
        ...raw,
        financeOsPhantomMatch: {
          address,
          signature: match.signature,
          occurredAt: match.occurredAt,
          symbol: match.symbol,
          quantity: match.quantity,
          method: "solana-public-ledger",
        },
      }),
      source.id,
    );
    matched += 1;
  }

  return {
    matched,
    candidates: scan.candidates.length,
    signaturesScanned: scan.signaturesScanned,
    historyCompleteToOldestTransfer:
      scan.historyCompleteToOldestTransfer,
  };
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
        "t.transfer_value_czk, t.counterparty_ref, t.raw_json, t.category " +
        "FROM transactions t " +
        "WHERE t.provider = 'kraken' " +
        "AND t.kind = 'transfer' " +
        "AND t.category IN (" +
          "'wallet_transfer_out_unclassified', 'wallet_transfer_out_owned', " +
          "'wallet_transfer_in_unclassified', 'wallet_transfer_in_owned'" +
        ") " +
        "ORDER BY t.occurred_at ASC",
    )
    .all();

  const sourceUpdate = db.prepare(
    "UPDATE transactions SET flow_scope = 'internal', " +
      "category = ?, counterparty_ref = ?, source_label = ? WHERE id = ?",
  );

  let matched = 0;
  let matchedWithBookValue = 0;

  for (const row of rows) {
    const currentCounterparty = text(row.counterparty_ref);
    const rawDestination = destinationFromRaw(row.raw_json);
    const sourceCategory = String(row.category || "");
    const fromPhantom = sourceCategory.includes("wallet_transfer_in_");
    const alreadyLinked = currentCounterparty === "phantom:" + address;
    if (
      !alreadyLinked &&
      !matchesAddress(currentCounterparty, address) &&
      !matchesAddress(rawDestination, address)
    ) {
      continue;
    }

    const ownedCategory = fromPhantom
      ? "wallet_transfer_in_owned"
      : "wallet_transfer_out_owned";
    const sourceLabel = fromPhantom ? "Phantom → Kraken" : "Kraken → Phantom";

    sourceUpdate.run(
      ownedCategory,
      "phantom:" + address,
      sourceLabel,
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

    const signedAmount = fromPhantom
      ? -Math.abs(num(row.amount))
      : Math.abs(num(row.amount));
    const signedTransferValue =
      transferValue === null
        ? null
        : fromPhantom
          ? -transferValue
          : transferValue;

    upsertTransaction({
      provider: "phantom",
      accountId,
      externalId: "kraken-transfer:" + String(row.id),
      kind: "transfer",
      occurredAt: String(row.occurred_at),
      currency: symbol,
      amount: signedAmount,
      amountCzk: null,
      assetId,
      quantity: signedAmount,
      fee: 0,
      note: sourceLabel,
      category: fromPhantom
        ? "wallet_transfer_out_owned"
        : "wallet_transfer_in_owned",
      sourceLabel,
      flowScope: "internal",
      counterpartyRef: "kraken:" + String(row.id),
      transferValueCzk: signedTransferValue,
      raw: {
        mirroredFromProvider: "kraken",
        mirroredTransactionId: String(row.id),
        phantomAddress: address,
        direction: fromPhantom ? "phantom-to-kraken" : "kraken-to-phantom",
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
      realizedPnlStatus: "unavailable",
      unrealizedPnlStatus: "unavailable",
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
    const solIdentity = canonicalCryptoIdentity("SOL", "SOL");
    const solAssetId = upsertAsset({
      provider: "phantom",
      externalId: "native:SOL",
      symbol: solIdentity.canonicalSymbol,
      name: "Solana",
      assetClass: "crypto",
      currency: "USD",
      canonicalKey: solIdentity.canonicalKey,
      listingSymbol: solIdentity.listingSymbol,
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

      const identity = meta
        ? canonicalCryptoIdentity(symbol, symbol)
        : null;
      const assetId = upsertAsset({
        provider: "phantom",
        externalId: token.mint,
        symbol: identity?.canonicalSymbol || symbol,
        name: meta?.name || "Solana token " + token.mint.slice(0, 8),
        assetClass: "crypto",
        currency: "USD",
        canonicalKey: identity?.canonicalKey || "solana:" + token.mint,
        listingSymbol: identity?.listingSymbol || token.mint,
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

    let chainMatch = {
      matched: 0,
      candidates: 0,
      signaturesScanned: 0,
      historyCompleteToOldestTransfer: false,
      error: null as string | null,
    };
    try {
      chainMatch = {
        ...(await matchKrakenWithdrawalsFromChain(address)),
        error: null,
      };
    } catch (error) {
      chainMatch.error =
        error instanceof Error ? error.message : String(error);
    }

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
        chainHistoryMatch: chainMatch,
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
      chainHistoryMatch: chainMatch,
    };
  });
}
