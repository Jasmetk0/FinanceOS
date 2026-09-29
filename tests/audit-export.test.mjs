import test from "node:test";
import assert from "node:assert/strict";
import { auditExport } from "../scripts/audit-export.mjs";

test("Trading 212 reconciliation detects Pie cash inside provider investment value", () => {
  const data = {
    version: 1,
    accounts: [
      {
        id: "t212",
        provider: "trading212",
        name: "Trading 212",
        cash_value_czk: 884.48,
        total_value_czk: 309005.61,
        raw_json: JSON.stringify({
          totalValue: 309005.61,
          cash: {
            availableToTrade: 420.56,
            inPies: 463.92,
            reservedForOrders: 0,
          },
          investments: { currentValue: 302498.19 },
        }),
      },
    ],
    assets: [
      { id: "stock", provider: "trading212", asset_class: "stock" },
    ],
    holdings: [
      {
        account_id: "t212",
        asset_id: "stock",
        market_value_czk: 302034.27,
      },
    ],
    transactions: [],
    snapshots: [],
    assetPrices: [],
    connections: [],
  };

  const audit = auditExport(data);
  assert.equal(
    audit.trading212.pieCashAppearsInsideProviderInvestments,
    true,
  );
  assert.ok(
    Math.abs(audit.trading212.derivedUnclassifiedCzk - 6086.86) < 0.001,
  );
});

test("Kraken crypto withdrawal without CZK is flagged as wallet transfer", () => {
  const data = {
    version: 1,
    accounts: [
      {
        id: "kraken",
        provider: "kraken",
        name: "Kraken",
        total_value_czk: 100,
        cash_value_czk: 0,
      },
    ],
    assets: [
      {
        id: "usdc",
        provider: "kraken",
        asset_class: "crypto",
      },
    ],
    holdings: [],
    transactions: [
      {
        provider: "kraken",
        account_id: "kraken",
        asset_id: "usdc",
        amount_czk: null,
        raw_json: JSON.stringify({
          type: "withdrawal",
          asset: "USDC",
          amount: "-100",
        }),
      },
    ],
    snapshots: [],
    assetPrices: [],
    connections: [],
  };

  const audit = auditExport(data);
  assert.equal(audit.kraken.walletTransferCount, 1);
  assert.equal(audit.kraken.walletTransfersMissingCzk, 1);
  assert.ok(
    audit.warnings.some(
      (warning) => warning.code === "kraken_wallet_transfer_value_missing",
    ),
  );
});

test("Mintos balance-only state is explicit", () => {
  const audit = auditExport({
    version: 2,
    accounts: [
      {
        id: "mintos",
        provider: "mintos",
        name: "Mintos",
        total_value_czk: 18000,
        cash_value_czk: 0,
      },
    ],
    assets: [],
    holdings: [],
    transactions: [],
    snapshots: [],
    assetPrices: [],
    connections: [],
  });

  assert.equal(audit.mintos.historyStatus, "balance_only");
});


test("export audit catches orphan references, duplicate identities and incomplete P/L", () => {
  const audit = auditExport({
    version: 2,
    schemaVersion: 2,
    accounts: [
      {
        id: "broker",
        provider: "trading212",
        name: "Broker",
        type: "brokerage",
        total_value_czk: 1000,
        cash_value_czk: 0,
        realized_pnl_status: "available",
        unrealized_pnl_status: "partial",
      },
    ],
    assets: [
      {
        id: "asset",
        provider: "trading212",
        external_id: "ABC_US_EQ",
        asset_class: "stock",
        canonical_key: "symbol:ABC",
      },
      {
        id: "asset-duplicate",
        provider: "trading212",
        external_id: "ABC_US_EQ",
        asset_class: "stock",
      },
    ],
    holdings: [
      {
        account_id: "missing-account",
        asset_id: "missing-asset",
        market_value_czk: 100,
      },
    ],
    transactions: [
      {
        provider: "trading212",
        external_id: "same",
        account_id: "broker",
        asset_id: null,
        amount_czk: 1,
      },
      {
        provider: "trading212",
        external_id: "same",
        account_id: "missing-account",
        asset_id: "missing-asset",
        amount_czk: 1,
      },
    ],
    snapshots: [
      { account_id: "broker", recorded_at: "2026-09-29" },
      { account_id: "broker", recorded_at: "2026-09-29" },
    ],
    assetPrices: [],
    connections: [],
  });

  assert.equal(audit.dataIntegrity.orphanHoldingAccounts, 1);
  assert.equal(audit.dataIntegrity.orphanHoldingAssets, 1);
  assert.equal(audit.dataIntegrity.orphanTransactionAccounts, 1);
  assert.equal(audit.dataIntegrity.orphanTransactionAssets, 1);
  assert.equal(audit.dataIntegrity.duplicateSnapshotKeys.length, 1);
  assert.equal(audit.dataIntegrity.duplicateTransactionKeys.length, 1);
  assert.equal(audit.dataIntegrity.duplicateAssetKeys.length, 1);
  assert.equal(audit.pnlCoverage.incompleteAccounts, 1);
  assert.equal(audit.canonicalIdentity.assetsWithCanonicalKey, 1);
  assert.ok(audit.warnings.some((warning) => warning.code === "referential_integrity"));
  assert.ok(audit.warnings.some((warning) => warning.code === "duplicate_identity"));
  assert.ok(audit.warnings.some((warning) => warning.code === "pnl_coverage_incomplete"));
});
