import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  trading212BackfillWindow,
  canPromoteTrading212ExportCash,
  trading212BackfillComplete,
} from "../lib/shared/trading212-history-coverage.mjs";

function source(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("newest year is audited first and next window moves backwards without gaps", () => {
  const floor = "2015-01-01T00:00:00.000Z";
  const first = trading212BackfillWindow("2026-11-10T18:00:00.000Z", floor);
  assert.equal(first.timeTo, "2026-11-10T18:00:00.000Z");
  assert.ok(first.timeFrom.startsWith("2025-"));
  const second = trading212BackfillWindow(first.timeFrom, floor);
  assert.equal(second.timeTo, first.timeFrom);
  assert.ok(second.timeFrom < first.timeFrom);
  assert.ok(first.timeFrom <= "2026-07-22T00:00:00.000Z");
  assert.ok(first.timeFrom <= "2025-11-10T00:00:00.000Z" === false);
  let cursor = first.timeFrom;
  for (let i = 0; i < 30 && !trading212BackfillComplete(cursor, floor); i++) {
    const next = trading212BackfillWindow(cursor, floor);
    assert.ok(next);
    assert.equal(next.timeTo, cursor);
    cursor = next.timeFrom;
  }
  assert.equal(cursor, floor);
  assert.equal(trading212BackfillWindow(cursor, floor), null);
});

test("backfill calculations use UTC milliseconds including leap years", () => {
  const value = trading212BackfillWindow(
    "2024-03-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", 30,
  );
  assert.equal(value.timeFrom, "2024-01-31T00:00:00.000Z");
  assert.equal(value.timeTo, "2024-03-01T00:00:00.000Z");
  assert.throws(() => trading212BackfillWindow("not-a-date", "2015-01-01"), RangeError);
  assert.throws(() => trading212BackfillWindow("2026-01-01", "2015-01-01", 900), RangeError);
});

test("unpaired deposits and withdrawals are promoted only after full coarse API traversal", () => {
  const verified = { apiCashComplete: true, possibleCoarseMatch: false, flowScope: "external" };
  for (const kind of ["deposit", "withdrawal", "income"]) {
    assert.equal(canPromoteTrading212ExportCash({ ...verified, kind }), true);
    assert.equal(canPromoteTrading212ExportCash({ ...verified, kind,
      possibleCoarseMatch: true }), false);
    assert.equal(canPromoteTrading212ExportCash({ ...verified, kind,
      apiCashComplete: false }), false);
  }
  assert.equal(canPromoteTrading212ExportCash({ ...verified,
    kind: "transfer", flowScope: "internal" }), false);
  assert.equal(canPromoteTrading212ExportCash({ ...verified,
    kind: "fee", flowScope: "not_applicable" }), false);
  assert.equal(canPromoteTrading212ExportCash({ ...verified,
    kind: "deposit", flowScope: "unclassified" }), false);
});

test("history page checkpoints persist only after ingestion, not when fetching", () => {
  const sync = source("lib/server/integrations/trading212.ts");
  assert.ok(sync.includes('const HISTORY_BACKFILL_VERSION = "v3"'));
  assert.ok(sync.includes("const [orderFetch, dividendFetch, cashFetch] = await Promise.all"));
  assert.ok(sync.indexOf("saveHistoryCheckpoint(orderFetch.checkpoint)") >
    sync.indexOf("for (const item of orders)"));
  assert.ok(sync.indexOf("saveHistoryCheckpoint(dividendFetch.checkpoint)") >
    sync.indexOf("for (const dividend of dividends)"));
  assert.ok(sync.indexOf("saveHistoryCheckpoint(cashFetch.checkpoint)") >
    sync.indexOf("for (const transaction of cashTransactions)"));
  assert.ok(sync.includes("historyRequestQueue"));
  assert.ok(sync.includes("validateHistoryPath(path, endpoint)"));
  assert.ok(sync.includes("new Error(\"Trading 212 returned a repeated history cursor.\")"));
  assert.ok(sync.includes("history_v3:cash:complete"));
});

test("CSV export is requested with API key and its own lifetime audit", () => {
  const server = source("lib/server/trading212-card.ts");
  assert.ok(server.includes('const BACKFILL_END_KEY = "card_export_backfill_end_v3"'));
  assert.ok(server.includes('const BACKFILL_START = "2015-01-01T00:00:00.000Z"'));
  assert.ok(server.includes("trading212BackfillWindow("));
  assert.ok(server.includes("trading212BackfillComplete(pending.timeFrom, BACKFILL_START)"));
  assert.ok(server.includes("setState(BACKFILL_END_KEY, pending.timeFrom)"));
  assert.ok(server.includes("reconcileStoredRichExportRows();"));
  assert.ok(server.includes("hasPlausibleCoarseCounterpart("));
  assert.ok(server.includes("financeOsCsvPrimary: true"));
  assert.ok(server.includes("possibleCoarseMatch: ambiguousMatch"));
  assert.ok(server.includes('external_id LIKE \'card-export:%\''));
});

test("account diagnostic shows both coverage stages and reconstructed gaps remain partial", () => {
  const detail = source("app/accounts/[id]/page.tsx");
  const daily = source("lib/server/trading212-history.ts");
  assert.ok(detail.includes("Základní historie pohybů API"));
  assert.ok(detail.includes("card_export_backfill_complete_v3"));
  assert.ok(detail.includes("card_export_backfill_end_v3"));
  assert.ok(daily.includes('getState("history_v3:cash:complete") === "true"'));
  assert.ok(daily.includes('getState("card_export_backfill_complete_v3") === "true"'));
});
