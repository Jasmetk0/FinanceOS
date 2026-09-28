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
      "SELECT a.id, a.provider, a.name, a.type, a.total_value_czk, a.cash_value_czk, COALESCE(SUM(h.market_value_czk), 0) AS holdings_value_czk FROM accounts a LEFT JOIN holdings h ON h.account_id = a.id GROUP BY a.id, a.provider, a.name, a.type, a.total_value_czk, a.cash_value_czk ORDER BY a.name"
    )
    .all();

  for (const row of accountRows) {
    const type = String(row.type);
    if (!["brokerage", "crypto"].includes(type)) continue;

    const total = num(row.total_value_czk);
    const cash = num(row.cash_value_czk);
    const holdings = num(row.holdings_value_czk);
    const expected = cash + holdings;
    const difference = total - expected;
    const tolerance = Math.max(5, Math.abs(total) * 0.005);

    if (Math.abs(difference) > tolerance) {
      checks.push({
        id: "reconcile-" + String(row.id),
        severity: "warning",
        title: String(row.name) + " reconciliation",
        detail:
          "Account total differs from cash + holdings by " +
          difference.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) +
          " Kč. This can be normal if the provider exposes unsettled or reserved balances.",
      });
    } else {
      checks.push({
        id: "reconcile-" + String(row.id),
        severity: "ok",
        title: String(row.name) + " reconciliation",
        detail: "Account total is consistent with cash + current holdings.",
      });
    }
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
