import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";
import { buildSedolIsinCrosswalk } from "../lib/xray/security-identity.ts";
import { combineConstituentSources } from "../lib/xray/auto-merge.ts";
import { reconcileIssuerRows } from "../lib/xray/issuer-reliability.ts";
import {
  needsSpyiIdentityReference, assertSpyiIdentityReference,
  IDENTITY_REFERENCE_MAX_AGE_DAYS,
} from "../lib/xray/identity-reference.ts";
import { SPYI_ISIN } from "../lib/xray/auto-spyi.ts";
import { VWCE_ISIN, VALL_ISIN } from "../lib/xray/auto-vanguard.ts";

const DAY=86_400_000,weights=[1,3,1,7,3,9];
const day=(days=1)=>new Date(Date.now()-DAY*days).toISOString().slice(0,10);
const sedolFor=i=>{
  const stem=String(i).padStart(6,"0");
  const sum=[...stem].reduce((total,c,idx)=>total+Number(c)*weights[idx],0);
  return stem+String((10-sum%10)%10);
};
const isinFor=i=>"US"+String(i).padStart(10,"0");
const dictionary=(count=550,date=day(1))=>
  Array.from({length:count},(_,i)=>({
    fundSymbol:"SPYI",fundIsin:SPYI_ISIN,
    securitySymbol:"S"+i,securityName:"Security "+i,
    securityIsin:isinFor(i),securitySedol:sedolFor(i),
    kind:"stock",weightPct:99/count,asOf:date,
    source:"State Street official daily SPYI XLSX; "+date,
  }));
const held=(id,symbol,assetClass,valueCzk,isin)=>({
  id,symbol,name:symbol,isin,assetClass,valueCzk,quantity:1,canonicalKey:null,
  provider:"trading212",accountName:"Invest",
});
const equityRow=(isin,sedol,weightPct)=>({
  fundSymbol:"VWCE",fundIsin:VWCE_ISIN,
  securitySymbol:"SAMPLE@"+sedol,securitySedol:sedol,securityIsin:null,
  securityName:"Sample",kind:"stock",weightPct,asOf:day(1),
  source:"Vanguard EU official GPX holdings; "+day(1),
});
const officialReference=()=>{
  const asOf=day(1);
  return dictionary().map(x=>({...x,source:x.source+"; identity-only reference",asOf}));
};
test("reference fetched only for held Vanguard VWCE/VALL when SPYI is not itself held",()=>{
  assert.equal(needsSpyiIdentityReference([VWCE_ISIN]),true);
  assert.equal(needsSpyiIdentityReference([VALL_ISIN]),true);
  assert.equal(needsSpyiIdentityReference([VALL_ISIN,VWCE_ISIN]),true);
  assert.equal(needsSpyiIdentityReference([VALL_ISIN,SPYI_ISIN]),false);
  assert.equal(needsSpyiIdentityReference([VWCE_ISIN,SPYI_ISIN]),false);
  assert.equal(needsSpyiIdentityReference([SPYI_ISIN]),false);
  assert.equal(needsSpyiIdentityReference([null,"IE0032077012"]),false);
  assert.equal(needsSpyiIdentityReference([]),false);
});
test("requires authentic-like full State Street XLSX source, matched fund ISIN and 14-day freshness",()=>{
  const rows=dictionary();
  const check=assertSpyiIdentityReference(rows);
  assert.equal(check.bridges,550);
  assert.equal(check.stocks,550);
  assert.equal(check.asOf,day(1));
  assert.equal(IDENTITY_REFERENCE_MAX_AGE_DAYS,14);
  assert.throws(()=>assertSpyiIdentityReference(rows.slice(0,120)),/kompletní|ověřených/);
  assert.throws(()=>assertSpyiIdentityReference(dictionary(550,day(17))),/zastaralý/);
  assert.throws(()=>assertSpyiIdentityReference(rows.map((r,i)=>i? r:{...r,fundIsin:VWCE_ISIN})),/kompletní/);
  assert.throws(()=>assertSpyiIdentityReference(rows.map((r,i)=>i? r:{...r,source:"manual-investown.csv"})),/důvěryhodný/);
  assert.throws(()=>assertSpyiIdentityReference(rows.map(r=>({...r,securitySedol:null}))),/ověřených/);
});
test("SPYI as an unowned reference joins verified Vanguard SEDOL to direct share ISIN with no fictitious SPYI NAV",()=>{
  const reference=officialReference();
  const row=equityRow(isinFor(0),sedolFor(0),20);
  const holdings=[
    held("share","SAMPLE","stock",100,isinFor(0)),
    held("vanguard","VWCE","etf",1000,VWCE_ISIN),
  ];
  const without=calculateXRay(holdings,[row]);
  assert.equal(without.exposures.length,2);
  assert.equal(without.identityCoverage.sedolOnlyCzk,200);
  const withReference=calculateXRay(holdings,[row,...reference]);
  assert.equal(withReference.exposures.length,1);
  assert.equal(withReference.exposures[0].key,"stock|isin:"+isinFor(0));
  assert.equal(withReference.exposures[0].directCzk,100);
  assert.equal(withReference.exposures[0].viaFundsCzk,200);
  assert.equal(withReference.funds.length,1);
  assert.equal(withReference.denominatorCzk,1100);
  assert.equal(withReference.mappedCzk,300);
  assert.equal(withReference.unallocatedCzk,800);
  assert.equal(withReference.identityCoverage.bridgedCzk,200);
  assert.equal(withReference.funds.some(f=>f.isin===SPYI_ISIN),false);
});
test("reference cached beyond validity cannot bridge Vanguard share to stale ISIN",()=>{
  const reference=dictionary(550,day(23)).map(r=>({
    ...r,source:r.source+"; identity-only reference",
  }));
  assert.equal(buildSedolIsinCrosswalk(reference).linkedCount,0);
  const res=calculateXRay([
    held("direct","SAMPLE","stock",100,isinFor(0)),
    held("fund","VWCE","etf",1000,VWCE_ISIN),
  ],[equityRow(isinFor(0),sedolFor(0),20),...reference]);
  assert.equal(res.exposures.length,2);
  assert.equal(res.identityCoverage.sedolOnlyCzk,200);
  assert.equal(res.identityCoverage.bridgedCzk,0);
});
test("same SPYI issuer feed used as physical held ETF is not a separate synthetic investment",()=>{
  const refs=officialReference();
  const holdings=[
    held("real-spyi","SPYI","etf",500,SPYI_ISIN),
    held("vanguard","VWCE","etf",1000,VWCE_ISIN),
  ];
  // If SPYI is held, route fetches it as a normal official fund exactly once.
  assert.equal(needsSpyiIdentityReference(holdings.map(x=>x.isin)),false);
  const report=calculateXRay(holdings,[equityRow(isinFor(0),sedolFor(0),20),
    ...refs.map(r=>({...r,source:r.source.replace("; identity-only reference","")}))]);
  assert.equal(report.denominatorCzk,1500);
  assert.equal(report.funds.length,2);
  assert.equal(report.funds.find(f=>f.isin===SPYI_ISIN)?.valueCzk,500);
  assert.ok(Math.abs(report.mappedCzk+report.unallocatedCzk-1500)<1e-7);
});
test("issuer-only reference is retained atomically on transient network failure and discarded when no longer needed",()=>{
  const backup=officialReference();
  const initial=reconcileIssuerRows([],
    backup,[{isin:SPYI_ISIN,symbol:"SPYI (identita)",identityOnly:true,
      status:"ok",asOf:day(1)}]);
  assert.equal(initial.rows.length,550);
  const failed=reconcileIssuerRows(initial.rows,[],
    [{isin:SPYI_ISIN,symbol:"SPYI (identita)",identityOnly:true,status:"error"}]);
  assert.equal(failed.rows.length,550);
  assert.deepEqual(failed.retainedIsins,[SPYI_ISIN]);
  const noLongerNeeded=reconcileIssuerRows(failed.rows,[],[]);
  assert.equal(noLongerNeeded.rows.length,0);
});
test("the official reference cannot be overwritten by a later manual SPYI snapshot",()=>{
  const official=officialReference();
  const manual=dictionary(550,day(0)).map(r=>({...r,source:"manual-spyi.csv"}));
  const merged=combineConstituentSources(manual,official);
  assert.deepEqual(merged,official);
  assert.equal(buildSedolIsinCrosswalk(merged).linkedCount,550);
});
test("a conflicting SEDOL-to-ISIN pair from official reference fails closed and cannot change NAV",()=>{
 const dict=officialReference();
 const reused=dict.map((r,i)=>i===1?{...r,securitySedol:dict[0].securitySedol}:r);
 const lookup=buildSedolIsinCrosswalk(reused);
 assert.equal(lookup.linkedCount,548);
 assert.ok(lookup.conflicted.has(dict[0].securitySedol));
 const res=calculateXRay([
   held("v","VWCE","etf",1000,VWCE_ISIN),
   held("d","SAMPLE","stock",100,dict[0].securityIsin),
 ],[equityRow(dict[0].securityIsin,dict[0].securitySedol,20),...reused]);
 assert.equal(res.exposures.length,2);
 assert.ok(Math.abs(res.mappedCzk+res.unallocatedCzk-1100)<1e-7);
});
test("API and UI disclose reference-only status without mutating broker positions",()=>{
 const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 const route=file("app/api/xray/auto/route.ts");
 const ui=file("components/xray-auto-sync.tsx");
 assert.ok(route.includes("needsSpyiIdentityReference(funds.keys())"));
 assert.ok(route.includes("fetchSpyiHoldings(\"SPYI\",force)"));
 assert.ok(route.includes("assertSpyiIdentityReference(fetched.rows)"));
 assert.ok(route.includes("identityOnly:true"));
 assert.ok(ui.includes("NE investice"));
 assert.ok(ui.includes("SEDOL ↔ ISIN"));
 assert.ok(route.includes("getXRayHoldings()"));
});
