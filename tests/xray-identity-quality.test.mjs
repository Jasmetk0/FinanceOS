import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";

const VWCE="IE00BK5BQT80", SPYI="IE00B3YLTY66", MSFT="US5949181045";
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass,valueCzk,isin,
  quantity:1,canonicalKey:null,provider:"trading212",accountName:"Invest",
});
const constituent=(fundSymbol,fundIsin,securitySymbol,kind,weightPct,options={})=>({
  fundSymbol,fundIsin,securitySymbol,kind,weightPct,asOf:"2026-10-13",
  source:fundIsin===SPYI?"State Street official daily SPYI XLSX; 2026-10-13":
    "Vanguard EU official GPX holdings; 2026-10-13",
  securityName:securitySymbol,securityIsin:null,securitySedol:null,...options,
});

test("100% portfolio denominator is conserved across SIX distinct confidence tiers",()=>{
  const holdings=[
    holding("d-msft","MSFT","stock",100,MSFT),
    holding("d-abc","ABC","stock",40),
    holding("d-btc","BTC","crypto",60),
    holding("v","VWCE","etf",1000,VWCE),
    holding("s","SPYI","etf",500,SPYI),
    holding("m","UNKNOWN","etf",300,"IE00C0000000"),
    holding("cash","CZK","cash",5000),
  ];
  const parts=[
    constituent("VWCE",VWCE,"MSFT@B1YW440","stock",10,{securitySedol:"B1YW440"}),
    constituent("VWCE",VWCE,"NVDA@0263494","stock",20,{securitySedol:"0263494"}),
    constituent("VWCE",VWCE,"NOID","stock",5),
    constituent("SPYI",SPYI,"MSFT","stock",20,{securityIsin:MSFT,securitySedol:"B1YW440"}),
    constituent("SPYI",SPYI,"ETH","crypto",10),
    constituent("SPYI",SPYI,"CASH","other",10),
  ];
  const r=calculateXRay(holdings,parts);
  assert.equal(r.denominatorCzk,2000);
  assert.equal(r.mappedCzk,700);
  assert.equal(r.unallocatedCzk,1300);
  assert.deepEqual(r.identityCoverage,{
    isinCzk:200,
    bridgedCzk:100,
    sedolOnlyCzk:200,
    tickerOnlyCzk:90,
    cryptoCzk:110,
    unmappedCzk:1300,
    totalCzk:2000,
  });
  const sum=Object.entries(r.identityCoverage).filter(([k])=>k!=="totalCzk")
    .reduce((x,[,v])=>x+v,0);
  assert.ok(Math.abs(sum-r.denominatorCzk)<1e-8);
  assert.equal(r.exposures.find(x=>x.key==="stock|isin:"+MSFT).totalCzk,300);
});

test("ticker inferred into a unique ISIN is still labelled ticker-only evidence",()=>{
  const r=calculateXRay([
    holding("direct","NVDA","stock",100),
    holding("etf","F","etf",200,"IE00B0000000"),
  ],[constituent("F","IE00B0000000","NVDA","stock",20,{
    securityIsin:"US67066G1040",source:"issuer-test",
  })]);
  assert.equal(r.exposures.length,1);
  assert.equal(r.exposures[0].totalCzk,140);
  assert.equal(r.identityCoverage.tickerOnlyCzk,100);
  assert.equal(r.identityCoverage.isinCzk,40);
  assert.equal(r.identityCoverage.unmappedCzk,160);
});

test("cryptocurrency tickers do not masquerade as ISIN verified identities",()=>{
  const r=calculateXRay([
    holding("btc","BTC","crypto",100),
    holding("xbt","XBT","crypto",50),
    holding("stock","BTC","stock",70),
  ],[]);
  assert.equal(r.identityCoverage.cryptoCzk,150);
  assert.equal(r.identityCoverage.tickerOnlyCzk,70);
  assert.equal(r.identityCoverage.isinCzk,0);
  assert.equal(r.identityCoverage.totalCzk,220);
});

test("empty or entirely opaque ETF portfolios remain financially honest",()=>{
  const zero=calculateXRay([],[]);
  assert.deepEqual(zero.identityCoverage,{
    isinCzk:0,bridgedCzk:0,sedolOnlyCzk:0,tickerOnlyCzk:0,
    cryptoCzk:0,unmappedCzk:0,totalCzk:0,
  });
  const unknown=calculateXRay([holding("a","F","etf",1000)],[]);
  assert.equal(unknown.identityCoverage.unmappedCzk,1000);
  assert.equal(unknown.mappedPct,0);
});

test("quality UI explains source identifiers, shows each category, never requires CSV",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const quality=read("components/xray-identity-quality.tsx");
  const app=read("components/portfolio-xray.tsx");
  assert.ok(app.includes("<XRayIdentityQuality coverage={data.identityCoverage} funds={data.funds} />"));
  assert.ok(app.includes("CSV slouží pouze jako volitelná záloha."));
  for(const key of ["isinCzk","bridgedCzk","sedolOnlyCzk","tickerOnlyCzk","cryptoCzk","unmappedCzk"]){
    assert.ok(quality.includes(key),"Missing "+key);
  }
  assert.ok(quality.includes("Složení ETF je historický snapshot emitenta"));
  assert.ok(quality.includes("Největší dosud nerozložené fondy"));
});
