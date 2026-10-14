import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  XRAY_AUTO_REFRESH_MS, XRAY_MANUAL_COOLDOWN_MS,
  calculateXRayFreshness, classifyLiveStatus, shouldStartAutoSync,
} from "../lib/xray/freshness.ts";

const now = Date.parse("2026-10-14T18:00:00.000Z");
const connected = (ageMins=1, overrides={}) => ({
  provider: "trading212", status: "connected",
  lastSyncedAt: new Date(now-ageMins*60_000).toISOString(),
  lastError: null, ...overrides,
});

test("distinguishes actual broker API snapshot from a non-existent streaming quote",()=>{
  assert.equal(classifyLiveStatus([],now),"disconnected");
  assert.equal(classifyLiveStatus([connected(14)],now),"current");
  assert.equal(classifyLiveStatus([connected(15)],now),"stale");
  assert.equal(classifyLiveStatus([connected(1,{status:"error",lastError:"HTTP 429"})],now),"error");
  assert.equal(classifyLiveStatus([connected(1,{lastSyncedAt:null})],now),"stale");
  assert.equal(classifyLiveStatus([connected(1),{...connected(20),provider:"kraken"}],now),"stale");
  assert.equal(classifyLiveStatus([connected(1,{lastSyncedAt:"not a timestamp"})],now),"stale");
  assert.equal(classifyLiveStatus([connected(-2)],now),"stale");
});

test("freshness reports oldest and newest local valuation updates separately from sync timestamps",()=>{
  const data=calculateXRayFreshness([connected(2)],[
    "2026-10-13T10:00:00Z","2026-10-14T17:55:00Z",null,
  ],now);
  assert.equal(data.status,"current");
  assert.equal(data.checkedAt,"2026-10-14T18:00:00.000Z");
  assert.equal(data.oldestPositionUpdateAt,"2026-10-13T10:00:00.000Z");
  assert.equal(data.newestPositionUpdateAt,"2026-10-14T17:55:00.000Z");
  assert.equal(data.positionsCount,3);
  assert.equal(data.connections[0].provider,"trading212");
});

test("automatic API sync observes cooldown even when broker currently fails",()=>{
  const stale=calculateXRayFreshness([connected(25)],[],now);
  const failed=calculateXRayFreshness([connected(25,{status:"error"})],[],now);
  assert.ok(shouldStartAutoSync(stale,null,now));
  assert.ok(shouldStartAutoSync(failed,null,now));
  assert.equal(shouldStartAutoSync(failed,now-1_000,now),false);
  assert.equal(shouldStartAutoSync(stale,now-XRAY_AUTO_REFRESH_MS,now),true);
  assert.equal(shouldStartAutoSync(calculateXRayFreshness([connected(1)],[],now),null,now),false);
  assert.equal(shouldStartAutoSync(calculateXRayFreshness([],[],now),null,now),false);
  assert.equal(XRAY_MANUAL_COOLDOWN_MS,30_000);
});

test("live endpoint uses only existing encrypted API connectors, rate limits calls and never returns credentials",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const server=read("lib/server/xray-live.ts");
  const route=read("app/api/xray/live/route.ts");
  const base=read("lib/server/xray.ts");
  assert.ok(server.includes("getXRayHoldings()"));
  assert.ok(server.includes('["trading212", "kraken", "phantom"]'));
  assert.ok(route.includes("localOnly(request)"));
  assert.ok(route.includes("syncAll()"));
  assert.ok(route.includes("XRAY_AUTO_REFRESH_MS"));
  assert.ok(route.includes("XRAY_MANUAL_COOLDOWN_MS"));
  assert.ok(route.includes("state.running"));
  assert.ok(route.includes("results: results.map"));
  assert.ok(!route.includes("credentials_enc"));
  assert.ok(base.includes("h.updated_at"));
  assert.ok(base.includes("updatedAt:"));
});

test("X-Ray automatically asks for fresh brokerage holdings and refetches corresponding issuer funds",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const page=read("app/xray/page.tsx");
  const portfolio=read("components/portfolio-xray.tsx");
  const sync=read("components/xray-live-positions.tsx");
  const issuers=read("components/xray-auto-sync.tsx");
  assert.ok(page.includes("getXRayLiveSnapshot()"));
  assert.ok(portfolio.includes("<XRayLivePositions"));
  assert.ok(portfolio.includes("liveHoldings, effectiveRows"));
  assert.ok(portfolio.includes("refreshSignal={issuerRefresh}"));
  assert.ok(sync.includes('method:"POST"'));
  assert.ok(sync.includes("shouldStartAutoSync("));
  assert.ok(sync.includes("document.visibilityState"));
  assert.ok(sync.includes("onIssuerRefresh(mode==="));
  assert.ok(issuers.includes("refreshSignal?.force"));
});
