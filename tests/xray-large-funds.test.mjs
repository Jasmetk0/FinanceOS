import test from "node:test";
import assert from "node:assert/strict";
import { calculateXRay } from "../lib/xray/engine.ts";

const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,
  canonicalKey:null,quantity:1,provider:"trading212",accountName:"Invest",
});
const component=(fundSymbol,securitySymbol,weightPct,options={})=>({
  fundSymbol,fundIsin:"IE00BK5BQT80",securitySymbol,
  securityIsin:null,securityName:securitySymbol,weightPct,kind:"stock",
  asOf:"2026-10-13",source:"original-issuer-snapshot.csv",...options,
});

test("a 10,000-stock global ETF is expanded without losing its unallocated remainder",()=>{
  const rows=Array.from({length:10_000},(_,i)=>component("VWCE","STOCK_"+i,0.009));
  const result=calculateXRay([holding("fund","VWCE","etf",100_000,"IE00BK5BQT80")],rows);
  assert.equal(result.denominatorCzk,100_000);
  assert.equal(result.exposures.length,10_000);
  assert.ok(Math.abs(result.mappedCzk-90_000)<1e-6);
  assert.ok(Math.abs(result.unallocatedCzk-10_000)<1e-6);
  assert.ok(Math.abs(result.mappedCzk+result.unallocatedCzk-result.denominatorCzk)<1e-6);
  assert.ok(Math.abs(result.funds[0].mappedPct-90)<1e-6);
});

test("two contradictory sources for the same fund/date do not create fake blended exposures",()=>{
  const r=calculateXRay([holding("fund","VWCE","etf",100,"IE00BK5BQT80")],[
    component("VWCE","MSFT",10),
    component("VWCE","NVDA",10,{source:"unrelated-other-snapshot.csv"}),
  ]);
  assert.equal(r.exposures.length,0);
  assert.equal(r.mappedCzk,0);
  assert.equal(r.unallocatedCzk,100);
  assert.equal(r.funds[0].note,"Nesmíšený zdroj nelze ověřit");
  assert.match(r.warnings.join(" "),/různých zdrojů/);
});

test("identical sources with distinct constituents still merge by ISIN when valid",()=>{
  const r=calculateXRay([
    holding("fund","VWCE","etf",100,"IE00BK5BQT80"),
    holding("direct","MSFT","stock",50,"US5949181045"),
  ],[
    component("VWCE","MSFT",10,{securityIsin:"US5949181045"}),
    component("VWCE","NVDA",10,{securityIsin:"US67066G1040"}),
  ]);
  assert.equal(r.exposures.length,2);
  assert.equal(r.exposures.find(e=>e.ticker==="MSFT").totalCzk,60);
  assert.equal(r.unallocatedCzk,80);
  assert.ok(Math.abs(r.mappedCzk+r.unallocatedCzk-r.denominatorCzk)<1e-6);
});
