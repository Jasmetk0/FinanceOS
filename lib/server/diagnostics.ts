import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/server/db";
import {
  getDatabasePath,
  getFinanceOsDataDir,
  getMasterKeyPath,
  getProtectedMasterKeyPath,
} from "@/lib/server/paths";

export type DiagnosticSeverity = "ok" | "info" | "warning" | "error";

export interface DiagnosticCheck {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageHours(iso: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return (Date.now() - time) / 3_600_000;
}

function newestBackup(dataDir: string) {
  const backupDir = path.join(dataDir, "backups");
  if (!fs.existsSync(backupDir)) {
    return { path: null as string | null, modifiedAt: null as string | null, ageHours: null as number | null };
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^financeos-\d{4}-\d{2}-\d{2}\.json$/i.test(name))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files.length) {
    return { path: null as string | null, modifiedAt: null as string | null, ageHours: null as number | null };
  }

  const newest = files[0];
  return {
    path: newest.fullPath,
    modifiedAt: new Date(newest.mtimeMs).toISOString(),
    ageHours: (Date.now() - newest.mtimeMs) / 3_600_000,
  };
}

export function getDiagnostics() {
  const db = getDb();
  const dataDir = getFinanceOsDataDir();
  const checks: DiagnosticCheck[] = [];

  const quickCheck = db.prepare("PRAGMA quick_check").all();
  const quickMessages = quickCheck.map((row) => String(row.quick_check ?? ""));
  if (quickMessages.length === 1 && quickMessages[0].toLowerCase() === "ok") {
    checks.push({
      id: "sqlite-integrity",
      severity: "ok",
      title: "SQLite integrity",
      detail: "PRAGMA quick_check returned OK.",
    });
  } else {
    checks.push({
      id: "sqlite-integrity",
      severity: "error",
      title: "SQLite integrity",
      detail: quickMessages.join("; ") || "SQLite integrity check returned no result.",
    });
  }

  const connections = db
    .prepare("SELECT provider, label, status, last_synced_at, last_error FROM connections ORDER BY provider")
    .all();

  if (!connections.length) {
    checks.push({
      id: "connections-none",
      severity: "info",
      title: "Live providers",
      detail: "No live API provider is connected. Imported/manual data can still be used.",
    });
  }

  for (const row of connections) {
    const provider = String(row.provider);
    const label = String(row.label || provider);
    const status = String(row.status || "unknown");
    const lastSyncedAt = row.last_synced_at ? String(row.last_synced_at) : null;
    const hours = ageHours(lastSyncedAt);

    if (status === "error") {
      checks.push({
        id: "connection-" + provider,
        severity: "error",
        title: label + " connection",
        detail: String(row.last_error || "Provider is in error state."),
      });
    } else if (hours === null) {
      checks.push({
        id: "connection-" + provider,
        severity: "warning",
        title: label + " connection",
        detail: "Connected, but no successful sync timestamp is stored yet.",
      });
    } else if (hours > 24) {
      checks.push({
        id: "connection-" + provider,
        severity: "warning",
        title: label + " sync freshness",
        detail:
          "Last successful sync was " +
          hours.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) +
          " hours ago.",
      });
    } else {
      checks.push({
        id: "connection-" + provider,
        severity: "ok",
        title: label + " sync freshness",
        detail:
          "Last successful sync was " +
          hours.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) +
          " hours ago.",
      });
    }
  }

  const accountRows = db
    .prepare(
      "SELECT a.id, a.provider, a.name, a.type, a.total_value_czk, " +
        "a.cash_value_czk, a.unclassified_value_czk, " +
        "a.reconciliation_difference, a.reconciliation_status, " +
        "COALESCE(SUM(CASE WHEN ast.asset_class = 'cash' THEN 0 ELSE h.market_value_czk END), 0) AS holdings_value_czk " +
        "FROM accounts a " +
        "LEFT JOIN holdings h ON h.account_id = a.id " +
        "LEFT JOIN assets ast ON ast.id = h.asset_id " +
        "GROUP BY a.id, a.provider, a.name, a.type, a.total_value_czk, " +
        "a.cash_value_czk, a.unclassified_value_czk, " +
        "a.reconciliation_difference, a.reconciliation_status " +
        "ORDER BY a.name"
    )
    .all();

  for (const row of accountRows) {
    const type = String(row.type);
    const provider = String(row.provider);
    const shouldReconcile =
      ["brokerage", "crypto"].includes(type) || provider === "investown";
    if (!shouldReconcile) continue;

    const total = num(row.total_value_czk);
    const cash = num(row.cash_value_czk);
    const holdings = num(row.holdings_value_czk);
    const unclassified = num(row.unclassified_value_czk);
    const expected = cash + holdings + unclassified;
    const difference = total - expected;
    const storedStatus = String(row.reconciliation_status || "unknown");
    const tolerance = Math.max(0.05, Math.abs(total) * 0.000001);

    if (
      storedStatus === "warning" ||
      storedStatus === "error" ||
      Math.abs(difference) > tolerance
    ) {
      checks.push({
        id: "reconcile-" + String(row.id),
        severity: storedStatus === "error" ? "error" : "warning",
        title: String(row.name) + " reconciliation",
        detail:
          "Total " +
          total.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
          " Kč = holdings " +
          holdings.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
          " Kč + known cash " +
          cash.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
          " Kč + unclassified " +
          unclassified.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
          " Kč. Remaining arithmetic difference: " +
          difference.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) +
          " Kč.",
      });
    } else {
      checks.push({
        id: "reconcile-" + String(row.id),
        severity: "ok",
        title: String(row.name) + " reconciliation",
        detail: "Account total is fully explained by holdings + known cash.",
      });
    }
  }

  const krakenTransferStats = db
    .prepare(
      "SELECT " +
        "SUM(CASE WHEN kind = 'transfer' AND flow_scope = 'unclassified' THEN 1 ELSE 0 END) AS unclassified, " +
        "SUM(CASE WHEN kind = 'transfer' AND flow_scope = 'unclassified' AND transfer_value_czk IS NULL THEN 1 ELSE 0 END) AS missing_value, " +
        "SUM(CASE WHEN kind = 'transfer' AND flow_scope = 'unclassified' AND transfer_value_czk < 0 THEN ABS(transfer_value_czk) ELSE 0 END) AS valued_out " +
        "FROM transactions WHERE provider = 'kraken'",
    )
    .get();

  const krakenUnclassified = num(krakenTransferStats?.unclassified);
  const krakenMissingTransferValue = num(krakenTransferStats?.missing_value);
  const krakenValuedOut = num(krakenTransferStats?.valued_out);
  if (krakenUnclassified > 0) {
    checks.push({
      id: "kraken-wallet-transfers",
      severity: krakenMissingTransferValue > 0 ? "warning" : "info",
      title: "Kraken wallet transfers",
      detail:
        krakenUnclassified.toLocaleString("cs-CZ") +
        " on-chain transfer(s) are kept outside external contributions. " +
        krakenValuedOut.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) +
        " Kč of outgoing book value is reconstructed" +
        (krakenMissingTransferValue > 0
          ? "; " +
            krakenMissingTransferValue.toLocaleString("cs-CZ") +
            " transfer(s) still have incomplete carried value."
          : "."),
    });
  }

  const krakenAccount = db
    .prepare("SELECT raw_json FROM accounts WHERE provider = 'kraken' LIMIT 1")
    .get();
  if (krakenAccount?.raw_json) {
    try {
      const raw = JSON.parse(String(krakenAccount.raw_json)) as Record<string, unknown>;
      const status = typeof raw.costBasisStatus === "string"
        ? raw.costBasisStatus
        : "unknown";
      const incomplete = Array.isArray(raw.incompleteCostBasisSymbols)
        ? raw.incompleteCostBasisSymbols.map(String)
        : [];
      checks.push({
        id: "kraken-cost-basis",
        severity: status === "complete" ? "ok" : "warning",
        title: "Kraken cost basis",
        detail:
          status === "complete"
            ? "Kraken ledger cost basis is complete for reconstructed assets."
            : "Kraken cost basis is " +
              status +
              (incomplete.length ? ": " + incomplete.join(", ") : "."),
      });
    } catch {
      checks.push({
        id: "kraken-cost-basis",
        severity: "warning",
        title: "Kraken cost basis",
        detail: "Kraken cost-basis metadata could not be parsed.",
      });
    }
  }

  const phantomAccount = db
    .prepare(
      "SELECT raw_json, total_value_czk FROM accounts WHERE provider = 'phantom' LIMIT 1",
    )
    .get();

  if (phantomAccount?.raw_json) {
    try {
      const raw = JSON.parse(String(phantomAccount.raw_json)) as Record<string, unknown>;
      const valuationStatus =
        typeof raw.valuationStatus === "string"
          ? raw.valuationStatus
          : "unknown";
      const unpricedMints = Array.isArray(raw.unpricedMints)
        ? raw.unpricedMints.map(String)
        : [];
      const matched = num(raw.matchedKrakenTransfers);
      const matchedWithBookValue = num(
        raw.matchedKrakenTransfersWithBookValue,
      );

      checks.push({
        id: "phantom-valuation",
        severity: valuationStatus === "complete" ? "ok" : "warning",
        title: "Phantom valuation",
        detail:
          valuationStatus === "complete"
            ? "Current Solana wallet holdings are fully priced by the supported watch-only valuation set."
            : "Phantom valuation is " +
              valuationStatus +
              (unpricedMints.length
                ? "; " +
                  unpricedMints.length.toLocaleString("cs-CZ") +
                  " token mint(s) are stored but not valued."
                : "."),
      });

      checks.push({
        id: "phantom-kraken-links",
        severity:
          matched > 0 && matchedWithBookValue < matched ? "warning" : "ok",
        title: "Kraken → Phantom transfer links",
        detail:
          matched.toLocaleString("cs-CZ") +
          " transfer(s) matched to this wallet; " +
          matchedWithBookValue.toLocaleString("cs-CZ") +
          " carry reconstructed book value.",
      });
    } catch {
      checks.push({
        id: "phantom-valuation",
        severity: "warning",
        title: "Phantom valuation",
        detail: "Phantom wallet metadata could not be parsed.",
      });
    }
  }

  const investownAccount = db
    .prepare(
      "SELECT raw_json, total_value_czk, cash_value_czk, invested_value_czk FROM accounts WHERE provider = 'investown' LIMIT 1",
    )
    .get();

  if (!investownAccount) {
    checks.push({
      id: "investown-import",
      severity: "info",
      title: "Investown import",
      detail: "Investown has not been imported yet.",
    });
  } else {
    const investownStats = db
      .prepare(
        "SELECT COUNT(*) AS transactions, " +
          "SUM(CASE WHEN kind = 'adjustment' THEN 1 ELSE 0 END) AS unknown, " +
          "MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at " +
          "FROM transactions WHERE provider = 'investown'",
      )
      .get();
    const investownProjects = db
      .prepare(
        "SELECT COUNT(*) AS count FROM assets WHERE provider = 'investown' AND asset_class = 'p2p'",
      )
      .get();

    const unknown = num(investownStats?.unknown);
    let importMode = "unknown";
    try {
      const raw = investownAccount.raw_json
        ? (JSON.parse(String(investownAccount.raw_json)) as Record<string, unknown>)
        : {};
      if (typeof raw.importMode === "string") importMode = raw.importMode;
    } catch {
      importMode = "invalid metadata";
    }

    checks.push({
      id: "investown-import",
      severity: unknown > 0 ? "warning" : "ok",
      title: "Investown import",
      detail:
        num(investownStats?.transactions).toLocaleString("cs-CZ") +
        " transactions · " +
        num(investownProjects?.count).toLocaleString("cs-CZ") +
        " projects · mode " +
        importMode +
        (unknown > 0
          ? " · " +
            unknown.toLocaleString("cs-CZ") +
            " rows have an unknown transaction type."
          : " · all transaction types classified."),
    });
  }

  const missingFx = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE amount_czk IS NULL")
    .get();
  const missingFxCount = num(missingFx?.count);
  checks.push({
    id: "missing-fx",
    severity: missingFxCount > 0 ? "warning" : "ok",
    title: "Transaction CZK coverage",
    detail:
      missingFxCount > 0
        ? missingFxCount.toLocaleString("cs-CZ") +
          " transactions do not yet have a CZK value."
        : "All stored transactions currently have a CZK value.",
  });

  const invalidNumbers = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM accounts WHERE total_value_czk IS NULL OR total_value_czk != total_value_czk) + (SELECT COUNT(*) FROM holdings WHERE market_value_czk IS NULL OR market_value_czk != market_value_czk) AS count"
    )
    .get();
  const invalidNumberCount = num(invalidNumbers?.count);
  checks.push({
    id: "invalid-numbers",
    severity: invalidNumberCount > 0 ? "error" : "ok",
    title: "Numeric data validity",
    detail:
      invalidNumberCount > 0
        ? invalidNumberCount.toLocaleString("cs-CZ") +
          " account/holding values are invalid."
        : "No invalid account or holding numbers were found.",
  });

  const priceStats = db
    .prepare(
      "SELECT COUNT(*) AS count, SUM(CASE WHEN close_czk IS NULL THEN 1 ELSE 0 END) AS missing_czk FROM asset_prices",
    )
    .get();
  const priceCount = num(priceStats?.count);
  const missingPriceCzk = num(priceStats?.missing_czk);
  checks.push({
    id: "historical-prices",
    severity:
      priceCount === 0
        ? "info"
        : missingPriceCzk > 0
          ? "warning"
          : "ok",
    title: "Historical price coverage",
    detail:
      priceCount === 0
        ? "No imported historical asset prices yet."
        : priceCount.toLocaleString("cs-CZ") +
          " historical prices stored" +
          (missingPriceCzk > 0
            ? "; " +
              missingPriceCzk.toLocaleString("cs-CZ") +
              " are missing a historical CZK conversion."
            : " and all have CZK conversion."),
  });

  const snapshotRow = db
    .prepare("SELECT MAX(recorded_at) AS latest, COUNT(*) AS count FROM snapshots")
    .get();
  const latestSnapshot = snapshotRow?.latest ? String(snapshotRow.latest) : null;
  const snapshotHours = latestSnapshot
    ? ageHours(latestSnapshot + "T23:59:59Z")
    : null;
  checks.push({
    id: "snapshots",
    severity:
      latestSnapshot === null
        ? "info"
        : snapshotHours !== null && snapshotHours > 48
          ? "warning"
          : "ok",
    title: "Portfolio snapshots",
    detail:
      latestSnapshot === null
        ? "No daily portfolio snapshot exists yet."
        : num(snapshotRow?.count).toLocaleString("cs-CZ") +
          " snapshots stored; latest date is " +
          latestSnapshot +
          ".",
  });

  const backup = newestBackup(dataDir);
  checks.push({
    id: "backup",
    severity:
      backup.path === null
        ? "warning"
        : backup.ageHours !== null && backup.ageHours > 36
          ? "warning"
          : "ok",
    title: "Automatic backup",
    detail:
      backup.path === null
        ? "No automatic backup file was found yet."
        : "Newest backup: " +
          path.basename(backup.path) +
          " · " +
          (backup.ageHours ?? 0).toLocaleString("cs-CZ", {
            maximumFractionDigits: 1,
          }) +
          " hours old.",
  });

  const dbPath = getDatabasePath();
  checks.push({
    id: "database-file",
    severity: fs.existsSync(dbPath) ? "ok" : "error",
    title: "Database file",
    detail: fs.existsSync(dbPath)
      ? dbPath
      : "FinanceOS database file is missing.",
  });

  const protectedKey = getProtectedMasterKeyPath();
  const rawKey = getMasterKeyPath();
  if (process.platform === "win32") {
    checks.push({
      id: "master-key",
      severity: fs.existsSync(protectedKey)
        ? "ok"
        : fs.existsSync(rawKey)
          ? "warning"
          : "info",
      title: "Credential master key",
      detail: fs.existsSync(protectedKey)
        ? "Windows user-scoped DPAPI protected master key is present."
        : fs.existsSync(rawKey)
          ? "Legacy raw master key is still present; FinanceOS will migrate it when credentials are accessed."
          : "No master key exists yet because no encrypted credentials have been stored.",
    });
  }

  const summary = checks.reduce(
    (acc, check) => {
      acc[check.severity] += 1;
      return acc;
    },
    { ok: 0, info: 0, warning: 0, error: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    dataDir,
    checks,
    summary,
  };
}
