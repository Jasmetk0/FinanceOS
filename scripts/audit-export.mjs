import fs from "node:fs";
import { pathToFileURL } from "node:url";

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRaw(row) {
  if (!row || !row.raw_json) return {};
  try {
    return JSON.parse(String(row.raw_json));
  } catch {
    return {};
  }
}

export function auditExport(data) {
  if (!data || typeof data !== "object") {
    throw new Error("FinanceOS export must be a JSON object.");
  }

  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const holdings = Array.isArray(data.holdings) ? data.holdings : [];
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  const prices = Array.isArray(data.assetPrices) ? data.assetPrices : [];
  const connections = Array.isArray(data.connections) ? data.connections : [];

  const assetById = new Map(assets.map((row) => [String(row.id), row]));
  const accountById = new Map(accounts.map((row) => [String(row.id), row]));

  const orphanHoldingAccounts = holdings.filter(
    (row) => !accountById.has(String(row.account_id)),
  );
  const orphanHoldingAssets = holdings.filter(
    (row) => !assetById.has(String(row.asset_id)),
  );
  const orphanTransactionAccounts = transactions.filter(
    (row) => !accountById.has(String(row.account_id)),
  );
  const orphanTransactionAssets = transactions.filter(
    (row) =>
      row.asset_id !== null &&
      row.asset_id !== undefined &&
      !assetById.has(String(row.asset_id)),
  );

  const duplicateKeys = (rows, keyFor) => {
    const seen = new Set();
    const duplicates = new Set();
    for (const row of rows) {
      const key = keyFor(row);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    return [...duplicates];
  };

  const duplicateSnapshotKeys = duplicateKeys(
    snapshots,
    (row) => String(row.account_id) + "|" + String(row.recorded_at),
  );
  const duplicateTransactionKeys = duplicateKeys(
    transactions,
    (row) => String(row.provider) + "|" + String(row.external_id),
  );
  const duplicateAssetKeys = duplicateKeys(
    assets,
    (row) => String(row.provider) + "|" + String(row.external_id),
  );

  const investmentAccounts = accounts.filter((row) =>
    ["brokerage", "crypto", "p2p"].includes(String(row.type || "")),
  );
  const pnlCoverage = investmentAccounts.map((row) => ({
    provider: String(row.provider || ""),
    account: String(row.name || row.external_id || row.provider || ""),
    realized: String(row.realized_pnl_status || "unknown"),
    unrealized: String(row.unrealized_pnl_status || "unknown"),
  }));
  const incompletePnlAccounts = pnlCoverage.filter(
    (row) =>
      !["available", "not_applicable"].includes(row.realized) ||
      !["available", "not_applicable"].includes(row.unrealized),
  );

  const canonicalAssets = assets.filter(
    (row) => typeof row.canonical_key === "string" && row.canonical_key.trim(),
  ).length;
  const isinAssets = assets.filter(
    (row) => typeof row.isin === "string" && row.isin.trim(),
  ).length;

  const holdingsByAccount = new Map();
  for (const holding of holdings) {
    const key = String(holding.account_id);
    const list = holdingsByAccount.get(key) || [];
    list.push(holding);
    holdingsByAccount.set(key, list);
  }

  const accountAudits = accounts.map((account) => {
    const provider = String(account.provider || "");
    const accountHoldings = holdingsByAccount.get(String(account.id)) || [];
    const nonCashHoldings = accountHoldings
      .filter((holding) => {
        const asset = assetById.get(String(holding.asset_id));
        return String(asset?.asset_class || "") !== "cash";
      })
      .reduce((sum, row) => sum + n(row.market_value_czk), 0);

    const storedUnclassified = n(account.unclassified_value_czk);
    const total = n(account.total_value_czk);
    const cash = n(account.cash_value_czk);
    const arithmeticDifference =
      total - cash - nonCashHoldings - storedUnclassified;

    return {
      provider,
      account: String(account.name || account.external_id || provider),
      totalCzk: total,
      knownCashCzk: cash,
      nonCashHoldingsCzk: nonCashHoldings,
      unclassifiedCzk: storedUnclassified,
      arithmeticDifferenceCzk: arithmeticDifference,
      reconciliationStatus:
        account.reconciliation_status ||
        (Math.abs(arithmeticDifference) <= 0.05 ? "reconciled" : "warning"),
    };
  });

  const snapshotByProvider = new Map();
  for (const snapshot of snapshots) {
    const account = accountById.get(String(snapshot.account_id));
    const provider = String(account?.provider || "unknown");
    const item = snapshotByProvider.get(provider) || {
      count: 0,
      first: null,
      last: null,
    };
    const date = String(snapshot.recorded_at || "").slice(0, 10);
    item.count += 1;
    if (date && (!item.first || date < item.first)) item.first = date;
    if (date && (!item.last || date > item.last)) item.last = date;
    snapshotByProvider.set(provider, item);
  }

  const connectionHealth = connections.map((connection) => ({
    provider: String(connection.provider || ""),
    status: String(connection.status || "unknown"),
    lastSyncedAt: connection.lastSyncedAt || null,
    lastError: connection.lastError || null,
  }));

  const krakenWalletTransfers = transactions.filter((tx) => {
    if (tx.provider !== "kraken") return false;
    const raw = parseRaw(tx);
    const type = String(raw.type || "").toLowerCase();
    const asset = assetById.get(String(tx.asset_id || ""));
    const assetClass = String(asset?.asset_class || "");
    return (
      (type === "withdrawal" || type === "deposit") &&
      assetClass === "crypto"
    );
  });

  const missingCzk = transactions.filter(
    (tx) => tx.amount_czk === null || tx.amount_czk === undefined,
  );

  const trading212 = accounts.find((row) => row.provider === "trading212");
  let trading212Reconciliation = null;
  if (trading212) {
    const raw = parseRaw(trading212);
    const cash = raw.cash || {};
    const investments = raw.investments || {};
    const t212Holdings = (holdingsByAccount.get(String(trading212.id)) || [])
      .filter((holding) => {
        const asset = assetById.get(String(holding.asset_id));
        return String(asset?.asset_class || "") !== "cash";
      });
    const positions = t212Holdings.reduce(
      (sum, row) => sum + n(row.market_value_czk),
      0,
    );
    const available = n(cash.availableToTrade);
    const inPies = n(cash.inPies);
    const reserved = n(cash.reservedForOrders);
    const providerInvestments = n(investments.currentValue);
    const providerTotal = n(raw.totalValue || trading212.total_value_czk);
    const knownCash = available + inPies + reserved;
    const unclassified = providerTotal - positions - knownCash;

    trading212Reconciliation = {
      positionsCzk: positions,
      availableToTradeCzk: available,
      pieCashCzk: inPies,
      reservedCashCzk: reserved,
      providerInvestmentsCurrentValueCzk: providerInvestments,
      providerTotalCzk: providerTotal,
      providerInvestmentsMinusPositionsCzk: providerInvestments - positions,
      pieCashAppearsInsideProviderInvestments:
        Math.abs(providerInvestments - positions - inPies) <= 0.05,
      derivedUnclassifiedCzk: unclassified,
    };
  }

  const kraken = accounts.find((row) => row.provider === "kraken");
  const krakenRaw = kraken ? parseRaw(kraken) : {};
  const krakenCostBasisStatus =
    typeof krakenRaw.costBasisStatus === "string"
      ? krakenRaw.costBasisStatus
      : "unavailable";

  const mintos = accounts.find((row) => row.provider === "mintos");
  const mintosTransactions = transactions.filter(
    (row) => row.provider === "mintos",
  ).length;

  const warnings = [];
  for (const connection of connectionHealth) {
    if (connection.status === "error") {
      warnings.push({
        code: "connection_error",
        provider: connection.provider,
        detail: connection.lastError || "Unknown provider error",
      });
    }
  }
  if (!prices.length) {
    warnings.push({
      code: "historical_prices_missing",
      detail: "assetPrices is empty; full historical market-value reconstruction is unavailable.",
    });
  }
  if (krakenWalletTransfers.some((tx) => tx.amount_czk == null)) {
    warnings.push({
      code: "kraken_wallet_transfer_value_missing",
      provider: "kraken",
      detail:
        "Kraken crypto wallet transfers exist without CZK values and must not be treated as ordinary external withdrawals.",
    });
  }
  if (mintos && mintosTransactions === 0) {
    warnings.push({
      code: "mintos_balance_only",
      provider: "mintos",
      detail: "Mintos has a balance but no transaction ledger in this export.",
    });
  }
  if (
    orphanHoldingAccounts.length ||
    orphanHoldingAssets.length ||
    orphanTransactionAccounts.length ||
    orphanTransactionAssets.length
  ) {
    warnings.push({
      code: "referential_integrity",
      detail:
        "Export contains orphan references: " +
        orphanHoldingAccounts.length +
        " holding-account, " +
        orphanHoldingAssets.length +
        " holding-asset, " +
        orphanTransactionAccounts.length +
        " transaction-account, " +
        orphanTransactionAssets.length +
        " transaction-asset.",
    });
  }
  if (
    duplicateSnapshotKeys.length ||
    duplicateTransactionKeys.length ||
    duplicateAssetKeys.length
  ) {
    warnings.push({
      code: "duplicate_identity",
      detail:
        "Duplicate keys detected: " +
        duplicateSnapshotKeys.length +
        " snapshots, " +
        duplicateTransactionKeys.length +
        " transactions, " +
        duplicateAssetKeys.length +
        " assets.",
    });
  }
  if (incompletePnlAccounts.length) {
    warnings.push({
      code: "pnl_coverage_incomplete",
      detail:
        incompletePnlAccounts.length +
        " investment account(s) have partial/unavailable P/L.",
    });
  }

  return {
    schemaVersion: n(data.schemaVersion ?? data.version),
    exportedAt: data.exportedAt || null,
    counts: {
      accounts: accounts.length,
      assets: assets.length,
      holdings: holdings.length,
      transactions: transactions.length,
      snapshots: snapshots.length,
      assetPrices: prices.length,
    },
    accountAudits,
    dataIntegrity: {
      orphanHoldingAccounts: orphanHoldingAccounts.length,
      orphanHoldingAssets: orphanHoldingAssets.length,
      orphanTransactionAccounts: orphanTransactionAccounts.length,
      orphanTransactionAssets: orphanTransactionAssets.length,
      duplicateSnapshotKeys,
      duplicateTransactionKeys,
      duplicateAssetKeys,
    },
    pnlCoverage: {
      accounts: pnlCoverage,
      incompleteAccounts: incompletePnlAccounts.length,
    },
    canonicalIdentity: {
      assetsWithCanonicalKey: canonicalAssets,
      assetsWithIsin: isinAssets,
      totalAssets: assets.length,
    },
    snapshotsByProvider: Object.fromEntries(snapshotByProvider),
    connectionHealth,
    missingCzkTransactions: missingCzk.length,
    kraken: {
      walletTransferCount: krakenWalletTransfers.length,
      walletTransfersMissingCzk: krakenWalletTransfers.filter(
        (tx) => tx.amount_czk == null,
      ).length,
      costBasisStatus: krakenCostBasisStatus,
    },
    trading212: trading212Reconciliation,
    mintos: {
      historyStatus: mintos
        ? mintosTransactions > 0
          ? "partial_or_complete"
          : "balance_only"
        : "not_present",
      transactionCount: mintosTransactions,
    },
    warnings,
  };
}

export function formatAudit(audit) {
  const lines = [];
  lines.push("FinanceOS export audit");
  lines.push("======================");
  lines.push(
    "Accounts: " +
      audit.counts.accounts +
      " · Assets: " +
      audit.counts.assets +
      " · Holdings: " +
      audit.counts.holdings +
      " · Transactions: " +
      audit.counts.transactions +
      " · Snapshots: " +
      audit.counts.snapshots,
  );

  for (const connection of audit.connectionHealth) {
    lines.push(
      connection.provider +
        " sync: " +
        connection.status.toUpperCase() +
        (connection.lastError ? " · " + connection.lastError : ""),
    );
  }

  if (audit.trading212) {
    lines.push(
      "Trading212 reconciliation: " +
        (Math.abs(audit.trading212.derivedUnclassifiedCzk) <= 0.05
          ? "OK"
          : "WARNING") +
        " · unclassified " +
        audit.trading212.derivedUnclassifiedCzk.toFixed(2) +
        " CZK" +
        (audit.trading212.pieCashAppearsInsideProviderInvestments
          ? " · inPies appears included in investments.currentValue"
          : ""),
    );
  }

  lines.push(
    "Kraken wallet transfers: " +
      audit.kraken.walletTransferCount +
      " · missing CZK " +
      audit.kraken.walletTransfersMissingCzk +
      " · cost basis " +
      audit.kraken.costBasisStatus.toUpperCase(),
  );
  lines.push(
    "Mintos history: " + audit.mintos.historyStatus.toUpperCase(),
  );
  lines.push(
    "Historical prices: " +
      (audit.counts.assetPrices ? audit.counts.assetPrices : "NONE"),
  );
  lines.push(
    "Data integrity: " +
      (audit.dataIntegrity.orphanHoldingAccounts +
        audit.dataIntegrity.orphanHoldingAssets +
        audit.dataIntegrity.orphanTransactionAccounts +
        audit.dataIntegrity.orphanTransactionAssets ===
        0 &&
      audit.dataIntegrity.duplicateSnapshotKeys.length === 0 &&
      audit.dataIntegrity.duplicateTransactionKeys.length === 0 &&
      audit.dataIntegrity.duplicateAssetKeys.length === 0
        ? "OK"
        : "WARNING"),
  );
  lines.push(
    "P/L coverage: " +
      (audit.pnlCoverage.incompleteAccounts === 0
        ? "COMPLETE"
        : audit.pnlCoverage.incompleteAccounts + " INCOMPLETE ACCOUNT(S)"),
  );
  lines.push(
    "Canonical identity: " +
      audit.canonicalIdentity.assetsWithCanonicalKey +
      "/" +
      audit.canonicalIdentity.totalAssets +
      " assets",
  );

  if (audit.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of audit.warnings) {
      lines.push(
        "- " +
          warning.code +
          (warning.provider ? " [" + warning.provider + "]" : "") +
          ": " +
          warning.detail,
      );
    }
  }

  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2];
  if (!filename) {
    console.error("Usage: node scripts/audit-export.mjs <financeos-export.json>");
    process.exit(2);
  }

  const data = JSON.parse(fs.readFileSync(filename, "utf8"));
  const audit = auditExport(data);
  console.log(formatAudit(audit));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(audit, null, 2));
  }
}
