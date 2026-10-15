import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";
import { fundInsightForIsin } from "../lib/xray/fund-insights.ts";

const h=(id,symbol,assetClass,valueCzk,isin)=>({
  id,symbol,assetClass,valueCzk,isin,quantity:1,
  name:symbol,canonicalKey:null,provider:"trading212",accountName:"Invest"
});
const c=(fundSymbol,fundIsin,securitySymbol,securityIsin,weightPct,kind="stock")=>({
  fundSymbol,fundIsin,securitySymbol,securityIsin,weightPct,kind,
  securityName:securitySymbol,asOf:"2026-10-14",source:"test issuer daily data"
});

test("duplicate EQQQ positions collapse to a single coverage row by exact ISIN",()=>{
  const portfolio=calculateXRay([
    h("eqqq-a","EQQQ","etf",6601,"IE0032077012"),
    h("eqqq-b","EQQQ","etf",666,"IE0032077012"),
    h("eqac","EQAC","etf",6804,"IE00BFZXGZ54"),
  ],[]);
  assert.equal(portfolio.funds.length,2);
  assert.equal(portfolio.funds.find(f=>f.isin==="IE0032077012").valueCzk,7267);
  assert.equal(portfolio.funds.find(f=>f.isin==="IE00BFZXGZ54").valueCzk,6804);
  assert.equal(portfolio.denominatorCzk,14071);
  assert.equal(portfolio.unallocatedCzk,14071);
  assert.equal(portfolio.mappedCzk,0);
});

test("same ETF across different exchange tickers aggregates coverage AND stock exposure without duplicate NAV",()=>{
  const fundIsin="IE00B5BMR087",msftIsin="US5949181045";
  const r=calculateXRay([
    h("a","SXR8","etf",1000,fundIsin),
    h("b","CSPX","etf",500,fundIsin),
    h("direct","MSFT","stock",200,msftIsin),
  ],[
    c("SXR8",fundIsin,"MSFT",msftIsin,40),
    c("SXR8",fundIsin,"USD-CASH",null,60,"other"),
  ]);
  assert.equal(r.funds.length,1);
  assert.equal(r.funds[0].symbol,"CSPX / SXR8");
  assert.equal(r.funds[0].mappedCzk,600);
  assert.equal(r.funds[0].unmappedCzk,900);
  assert.equal(r.funds[0].mappedPct,40);
  const stock=r.exposures.find(e=>e.ticker==="MSFT");
  assert.equal(stock.directCzk,200);
  assert.equal(stock.viaFundsCzk,600);
  assert.equal(stock.fundContributions.length,1);
  assert.equal(stock.fundContributions[0].valueCzk,600);
  assert.equal(r.mappedCzk,800);
  assert.equal(r.denominatorCzk,1700);
  assert.equal(r.mappedCzk+r.unallocatedCzk,r.denominatorCzk);
});

test("identical symbols with different fund ISINs must NOT be combined",()=>{
  const r=calculateXRay([
    h("a","SAME","etf",100,"IE0032077012"),
    h("b","SAME","etf",200,"IE00BFZXGZ54"),
  ],[]);
  assert.equal(r.funds.length,2);
  assert.deepEqual(r.funds.map(x=>x.valueCzk).sort((a,b)=>a-b),[100,200]);
});

test("verified issuer structures are exact-ISIN, never inferred from symbols",()=>{
  for(const [isin,structure] of [
    ["LU1829221024","synthetic-equity"],
    ["IE0032077012","physical-equity"],
    ["IE00BFZXGZ54","physical-equity"],
    ["IE00B4ND3602","physical-gold"],
    ["JE00BN2CJ301","physical-gold"],
    ["GB00BTWSDN84","leveraged-crypto"],
  ]){
    const insight=fundInsightForIsin(isin);
    assert.equal(insight.structure,structure);
    assert.equal(insight.isin,isin);
    assert.equal(new URL(insight.issuerUrl).protocol,"https:");
  }
  assert.equal(fundInsightForIsin("US0000000001"),null);
  assert.equal(fundInsightForIsin("BTC3EUR"),null);
  assert.equal(fundInsightForIsin(null),null);
  assert.equal(fundInsightForIsin(" ie0032077012 ")?.isin,"IE0032077012");
});

test("synthetic ETF, physically-backed gold and 3x BTC ETP are NOT fabricated stocks or spot BTC",()=>{
  const r=calculateXRay([
    h("swap","LYMS","etf",25116,"LU1829221024"),
    h("gold","IGLN","etf",3646,"IE00B4ND3602"),
    h("gold2","WGLD","etf",252,"JE00BN2CJ301"),
    h("crypto","BTC3EUR","etf",190,"GB00BTWSDN84"),
  ],[]);
  assert.equal(r.exposures.length,0);
  assert.equal(r.denominatorCzk,29204);
  assert.equal(r.unallocatedCzk,29204);
  assert.match(r.funds.find(f=>f.symbol==="LYMS").note,/swapem/);
  assert.match(r.funds.find(f=>f.symbol==="IGLN").note,/zlatu/);
  assert.match(r.funds.find(f=>f.symbol==="WGLD").note,/zlatem/);
  assert.match(r.funds.find(f=>f.symbol==="BTC3EUR").note,/3× DENNÍ/);
  assert.equal(r.identityCoverage.cryptoCzk,0);
});

test("X-Ray user interface renders issuer explanations with links while preserving stock/crypto-only exposures",()=>{
  const ui=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
  assert.ok(ui.includes("fundInsightForIsin(f.isin)"));
  assert.ok(ui.includes("Struktura podle emitenta"));
  assert.ok(ui.includes('rel="noopener noreferrer"'));
  assert.ok(ui.includes("Akcie / krypto"));
});

test("automatic issuer status also explains why known gold, swap and leveraged products stay unresolved",()=>{
  const route=readFileSync(new URL("../app/api/xray/auto/route.ts",import.meta.url),"utf8");
  assert.ok(route.includes("fundInsightForIsin(isin)"));
  assert.ok(route.includes("insight.label + \". \" + insight.explanation"));
  assert.ok(route.includes("const id = isin"));
});
