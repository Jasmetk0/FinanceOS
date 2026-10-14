import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcileIssuerRows } from "../lib/xray/issuer-reliability.ts";
import { calculateXRay } from "../lib/xray/engine.ts";

const fundA="IE00BK5BQT80", fundB="IE00B3YLTY66";
const row=(fundIsin,symbol,asOf,weightPct=10)=>({
  fundSymbol:fundIsin===fundA?"VWCE":"SPYI",fundIsin,
  securitySymbol:symbol,securityIsin:null,securityName:symbol,
  weightPct,kind:"stock",asOf,source:"Original issuer daily holdings",
});
const status=(isin,asOf,kind="ok")=>({
  isin,symbol:isin===fundA?"VWCE":"SPYI",status:kind,asOf,
  fetchedAt:"2026-10-14T19:00:00.000Z",
});
const holding=(isin,symbol,czk)=>({id:isin,symbol,name:symbol,assetClass:"etf",
  isin,canonicalKey:null,quantity:1,valueCzk:czk,provider:"trading212",accountName:"Invest"});

test("an older downloaded issuer snapshot never downgrades previously verified holdings",()=>{
  const lastGood=[row(fundA,"NVDA", "2026-10-13", 40)];
  const older=[row(fundA,"OLD", "2026-10-11", 35)];
  const report=reconcileIssuerRows(lastGood,older,[status(fundA,"2026-10-11")]);
  assert.deepEqual(report.rows,lastGood);
  assert.deepEqual(report.retainedIsins,[fundA]);
  assert.deepEqual(report.regressedIsins,[fundA]);
  const lookthrough=calculateXRay([holding(fundA,"VWCE",10_000)],report.rows);
  assert.equal(lookthrough.mappedCzk,4000);
  assert.equal(lookthrough.unallocatedCzk,6000);
});

test("one fund may be downgraded by its CDN while a different fund updates successfully",()=>{
  const previous=[row(fundA,"NVDA","2026-10-13",40),
    row(fundB,"MSFT","2026-10-11",50)];
  const arriving=[row(fundA,"AMD","2026-10-10",38),
    row(fundB,"AAPL","2026-10-14",60)];
  const x=reconcileIssuerRows(previous,arriving,[
    status(fundA,"2026-10-10"),status(fundB,"2026-10-14"),
  ]);
  assert.deepEqual(x.retainedIsins,[fundA]);
  assert.deepEqual(x.regressedIsins,[fundA]);
  assert.ok(x.rows.some(r=>r.securitySymbol==="NVDA"));
  assert.ok(x.rows.some(r=>r.securitySymbol==="AAPL"));
  assert.ok(!x.rows.some(r=>r.securitySymbol==="AMD"||r.securitySymbol==="MSFT"));
  const report=calculateXRay([
    holding(fundA,"VWCE",1000),holding(fundB,"SPYI",2000),
  ],x.rows);
  assert.equal(report.mappedCzk,1600);
  assert.equal(report.unallocatedCzk,1400);
  assert.equal(report.denominatorCzk,3000);
});

test("same-date issuer correction is accepted, a newer date always replaces the old snapshot",()=>{
  const old=[row(fundA,"NVDA","2026-10-13",30)];
  const same=reconcileIssuerRows(old,[row(fundA,"NVDA","2026-10-13",32)],
    [status(fundA,"2026-10-13")]);
  assert.equal(same.rows[0].weightPct,32);
  assert.deepEqual(same.regressedIsins,[]);
  assert.deepEqual(same.retainedIsins,[]);
  const next=reconcileIssuerRows(old,[row(fundA,"MSFT","2026-10-14",50)],
    [status(fundA,"2026-10-14")]);
  assert.equal(next.rows[0].securitySymbol,"MSFT");
  assert.deepEqual(next.regressedIsins,[]);
});

test("older data must not be silently accepted when previous dataset has multiple dates",()=>{
  const old=[row(fundA,"NVDA","2026-10-13",10),row(fundA,"MSFT","2026-10-12",10)];
  const next=reconcileIssuerRows(old,[row(fundA,"AMZN","2026-10-11",10)],
    [status(fundA,"2026-10-11")]);
  // The old snapshot cannot be trusted, so do NOT claim to retain it as new.
  assert.equal(next.rows.length,1);
  assert.equal(next.rows[0].securitySymbol,"AMZN");
  assert.deepEqual(next.regressedIsins,[]);
});

test("successful issuer snapshots with malformed or missing calendar dates are rejected",()=>{
  const old=[row(fundA,"NVDA","2026-10-13",10)];
  assert.throws(()=>reconcileIssuerRows(old,[row(fundA,"NVDA","2026-02-30",10)],
    [status(fundA,"2026-02-30")]),/platné datum/);
  assert.throws(()=>reconcileIssuerRows(old,[row(fundA,"NVDA","",10)],
    [status(fundA,"")]),/platné datum/);
  assert.throws(()=>reconcileIssuerRows(old,[row(fundA,"NVDA","2026-10-10",10)],
    [status(fundA,"2026-10-09")]),/datum emitenta/);
});

test("a genuine issuer failure remains distinguishable from an issuer date regression",()=>{
  const old=[row(fundA,"NVDA","2026-10-13",10)];
  const outage=reconcileIssuerRows(old,[],[status(fundA,"","error")]);
  assert.deepEqual(outage.retainedIsins,[fundA]);
  assert.deepEqual(outage.regressedIsins,[]);
});

test("UI reports stale-source rollback and maintains the browser cache original expiry",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const component=read("components/xray-auto-sync.tsx");
  assert.ok(component.includes("result.regressedIsins"));
  assert.ok(component.includes("emitent vrátil STARŠÍ datum"));
  assert.ok(component.includes("Nově stažená data starší než záloha"));
  assert.ok(component.includes("result.retainedIsins.length&&cacheSavedAt.current"));
});
