import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("app shell does not start a duplicate client autosync", () => {
  const appShell = source("components/app-shell.tsx");
  assert.equal(appShell.includes("<AutoSync"), false);
  assert.ok(
    (appShell.match(/prefetch=\{false\}/g) || []).length >= 3,
    "navigation links should not eagerly prefetch dynamic local routes",
  );
});

test("investments reuses dashboard holdings instead of querying dashboard twice", () => {
  const page = source("app/investments/page.tsx");
  assert.equal(page.includes("getHoldings"), false);
  assert.ok(page.includes("const holdings = dashboard.holdings"));
});

test("history analytics do not cross join transactions with snapshots", () => {
  const analytics = source("lib/server/analytics.ts");
  const dangerous = /LEFT JOIN transactions[\s\S]{0,500}LEFT JOIN snapshots/;
  assert.equal(
    dangerous.test(analytics),
    false,
    "transactions and snapshots must be aggregated independently before joining accounts",
  );
});

test("SQLite has account/date indexes for navigation analytics", () => {
  const db = source("lib/server/db.ts");
  assert.ok(db.includes("idx_transactions_account_occurred"));
  assert.ok(db.includes("idx_transactions_account_kind_scope"));
  assert.ok(db.includes("idx_snapshots_account_recorded"));
});

test("background sync yields startup to interactive navigation", () => {
  const worker = source("scripts/background-sync.ps1");
  assert.ok(worker.includes("Start-Sleep -Seconds 30"));
  assert.ok(worker.includes("if (-not (Test-Path $backupPath))"));
});


test("desktop launcher cleans stale Next.js generated state before rebuild", () => {
  const launcher = source("scripts/start-financeos.ps1");
  assert.ok(launcher.includes('$productionBuildId = Join-Path $nextBuild "BUILD_ID"'));
  assert.ok(launcher.includes('Remove-Item $nextBuild -Recurse -Force -ErrorAction Stop'));
  assert.ok(
    launcher.includes(
      'Building FinanceOS production bundle from a clean .next directory.',
    ),
  );
});

test("Windows credential protection explicitly loads the DPAPI assembly", () => {
  const cryptoSource = source("lib/server/crypto.ts");
  assert.ok(
    cryptoSource.includes(
      'Add-Type -AssemblyName System.Security -ErrorAction Stop;',
    ),
  );
  assert.ok(cryptoSource.includes("LOAD_WINDOWS_SECURITY"));
});
