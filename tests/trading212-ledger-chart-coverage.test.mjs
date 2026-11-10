import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("portfolio charts provide ledger-driven dated deposits independent of snapshots", () => {
  const server = source("lib/server/analytics.ts");
  const client = source("components/portfolio-history-chart.tsx");
  assert.ok(server.includes("const cashFlows: PortfolioCashFlowPoint[] = []"));
  assert.ok(server.includes("flow.ownContributionDelta === 0"));
  assert.ok(server.includes("cashFlows.push(point)"));
  assert.ok(server.includes("cashFlows,"));
  assert.ok(server.includes("const accountCashFlows: PortfolioCashFlowPoint[]"));
  assert.ok(server.includes("cashFlows: accountCashFlows"));
  assert.ok(client.includes('metric === "contributions" && cashFlowPoints.length'));
  assert.ok(client.includes("cashFlowPoints"));
  assert.ok(client.includes('visibleCashFlows.length ? visibleCashFlows : filtered'));
  assert.ok(client.includes('"step"'));
  assert.ok(!client.includes('if (metric === "contributions" && performanceComplete === false) return null'));
});

test("cash-only days do not fabricate market valuations or profit", () => {
  const client = source("components/portfolio-history-chart.tsx");
  assert.ok(client.includes("function cashMetric(value: number)"));
  assert.match(client, /function cashMetric[\s\S]*?valueCzk: null,[\s\S]*?profitCzk: null,[\s\S]*?returnPct: null/);
  assert.ok(client.includes("performanceComplete: flow.performanceComplete"));
  assert.ok(client.includes("Graf zobrazuje známé doložené"));
});

test("partial reconstructed valuations are only shown as explicitly labelled estimates", () => {
  const server = source("lib/server/analytics.ts");
  const client = source("components/portfolio-history-chart.tsx");
  const reconstruction = source("lib/server/trading212-history.ts");
  assert.ok(server.includes("latestCandidateByAccount"));
  assert.ok(server.includes("estimatedValueCzk: !complete"));
  assert.ok(server.includes('snapshotQuality === "partial"'));
  assert.ok(reconstruction.includes("cashHistoryComplete"));
  assert.ok(client.includes("Orientační historická hodnota (přerušovaně · neověřeno)"));
  assert.ok(client.includes('strokeDasharray="5 6"'));
  assert.ok(client.includes("Orientační celkem · neověřeno"));
  assert.ok(client.includes("point.total.valueCzk === null"));
});

test("CSV enrichment matching is scoped to one broker account", () => {
  const rich = source("lib/server/trading212-card.ts");
  assert.match(rich, /function findExistingTransaction\(\s*accountId: string,/);
  assert.ok(rich.includes("AND account_id = ? AND external_id = ? LIMIT 1"));
  assert.match(rich, /String\(row.account_id\),\s*csvId,/);
  assert.match(rich, /input.accountId,\s*id,/);
});

test("card spending and cashback reports ignore enrichment-only duplicates", () => {
  const server = source("lib/server/analytics.ts");
  const rich = source("lib/server/trading212-card.ts");
  const status = rich.slice(rich.indexOf("export function getTrading212CardStatus()"));
  const exclusion = "AND COALESCE(raw_json, '') NOT LIKE '%\"enrichmentOnly\":true%'";
  assert.ok(server.includes(exclusion));
  assert.ok(status.includes(exclusion));
  assert.ok(status.includes("enrichment_only_count"));
});

test("bad API dates never turn old money movements into today's activity", () => {
  const t212 = source("lib/server/integrations/trading212.ts");
  assert.ok(t212.includes("historical cash movement has no valid date; cursor not advanced"));
  assert.ok(t212.includes("historical order has no valid date; cursor not advanced"));
  assert.ok(t212.includes("historical dividend has no valid date; cursor not advanced"));
  assert.ok(t212.includes("repairHistoricalTrading212Fx"));
  assert.ok(t212.includes("AND amount_czk IS NULL"));
  assert.ok(t212.includes("UPDATE transactions SET amount_czk = ? WHERE id = ? AND amount_czk IS NULL"));
  assert.ok(t212.includes("const batchLimit = 120"));
  assert.ok(t212.includes('getHistorySyncState("fx_repair_offset_v1")'));
  assert.ok(t212.includes("ORDER BY occurred_at ASC, id ASC LIMIT ? OFFSET ?"));
});
