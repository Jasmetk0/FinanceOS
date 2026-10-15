import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay, displayXRayTicker } from "../lib/xray/engine.ts";

const VWCE="IE00BK5BQT80",SPYI="IE00B3YLTY66",GOOG_ISIN="US02079K1079";
const fund=(valueCzk=100_000)=>({
  id:"vwce",symbol:"VWCE",name:"Vanguard FTSE All-World",assetClass:"etf",
  isin:VWCE,canonicalKey:null,quantity:1,valueCzk,
  provider:"trading212",accountName:"Invest",
});
const constituent=(symbol,sedol,name,weightPct,opts={})=>({
  fundSymbol:"VWCE",fundIsin:VWCE,securitySymbol:symbol,
  securitySedol:sedol,securityIsin:null,securityName:name,weightPct,
  kind:"stock",asOf:"2026-08-31",
  source:"Vanguard EU official GPX holdings; 2026-08-31",
  ...opts,
});

test("four exact user-reported Vanguard rows show clean tickers but retain unique SEDOL identities",()=>{
  const inputs=[
    {raw:"2330@6889106",ticker:"2330",sedol:"6889106",
      name:"Taiwan Semiconductor Manufacturing Co Ltd",weight:2.191,value:2191},
    {raw:"GOOG@BYY88Y7",ticker:"GOOG",sedol:"BYY88Y7",
      name:"Alphabet Inc",weight:1.828,value:1828},
    {raw:"TSLA@B616C79",ticker:"TSLA",sedol:"B616C79",
      name:"Tesla Inc",weight:1.190,value:1190},
    {raw:"LLY@2516152",ticker:"LLY",sedol:"2516152",
      name:"Eli Lilly & Co",weight:1.066,value:1066},
  ];
  const rows=inputs.map(x=>constituent(x.raw,x.sedol,x.name,x.weight));
  const result=calculateXRay([fund()],rows);
  assert.equal(result.denominatorCzk,100_000);
  assert.equal(result.directCzk,0);
  assert.equal(result.exposures.length,4);
  for(const x of inputs){
    const exposure=result.exposures.find(r=>r.key==="stock|sedol:"+x.sedol);
    assert.ok(exposure,"Preserve identity "+x.sedol);
    assert.equal(exposure.ticker,x.ticker,"Do not expose internal @SEDOL as ticker");
    assert.equal(exposure.name,x.name);
    assert.equal(exposure.directCzk,0);
    assert.ok(Math.abs(exposure.viaFundsCzk-x.value)<1e-8);
    assert.equal(exposure.directQuantity,0);
    assert.equal(exposure.fundEquivalentQuantity,null);
  }
  assert.equal(result.mappedCzk,6275);
  assert.equal(result.unallocatedCzk,93725);
  assert.equal(result.identityCoverage.sedolOnlyCzk,6275);
});

test("cleaning display must never merge identical tickers of distinct share classes",()=>{
  const r=calculateXRay([fund()],[
    constituent("GOOG@BYY88Y7","BYY88Y7","Alphabet Inc Class C",10),
    constituent("GOOG@B1YW440","B1YW440","Other share line",5),
  ]);
  assert.equal(r.exposures.length,2);
  assert.ok(r.exposures.every(x=>x.ticker==="GOOG"));
  assert.deepEqual(r.exposures.map(x=>x.key).sort(),
    ["stock|sedol:B1YW440","stock|sedol:BYY88Y7"]);
  assert.equal(r.mappedCzk,15000);
  assert.equal(r.unallocatedCzk,85000);
});

test("never strip arbitrary @ text or a wrong / invalid SEDOL",()=>{
  assert.equal(displayXRayTicker("TSLA@B616C79","B616C79"),"TSLA");
  assert.equal(displayXRayTicker("TSLA@B616C79","BYY88Y7"),"TSLA@B616C79");
  assert.equal(displayXRayTicker("TSLA@B616C70","B616C70"),"TSLA@B616C70");
  assert.equal(displayXRayTicker("ABC@NOTANID",null),"ABC@NOTANID");
  assert.equal(displayXRayTicker("ALPHA@B616C79-extra","B616C79"),"ALPHA@B616C79-extra");
  assert.equal(displayXRayTicker("ABC.X@B616C79","B616C79"),"ABC.X");
});

test("old IndexedDB snapshots with absent securitySedol still display human ticker, but identity stays fund scoped",()=>{
  const r=calculateXRay([fund()],[
    constituent("TSLA@B616C79",null,"Tesla Inc",5),
  ]);
  assert.equal(r.exposures.length,1);
  assert.equal(r.exposures[0].ticker,"TSLA");
  assert.ok(r.exposures[0].key.startsWith("stock|fund:"));
  assert.equal(r.identityCoverage.tickerOnlyCzk,5000);
  assert.equal(r.identityCoverage.sedolOnlyCzk,0);
});

test("direct holdings remain authoritative for ticker and enable only justified quantity equivalence",()=>{
  const direct={
    id:"direct-goog",symbol:"GOOG",name:"Alphabet Inc Class C",assetClass:"stock",
    isin:GOOG_ISIN,canonicalKey:null,quantity:2,valueCzk:4000,
    provider:"trading212",accountName:"Invest",
  };
  const spdr=constituent("GOOG","BYY88Y7","Alphabet Inc",10,{
    fundSymbol:"SPYI",fundIsin:SPYI,securityIsin:GOOG_ISIN,
    source:"State Street official daily SPYI XLSX; 2026-08-31",
  });
  const r=calculateXRay([fund(),direct],[
    constituent("GOOG@BYY88Y7","BYY88Y7","Alphabet Inc",5),spdr,
  ]);
  const exposure=r.exposures.find(x=>x.key==="stock|isin:"+GOOG_ISIN);
  assert.ok(exposure);
  assert.equal(exposure.ticker,"GOOG");
  assert.equal(exposure.name,"Alphabet Inc Class C");
  assert.equal(exposure.directQuantity,2);
  assert.equal(exposure.viaFundsCzk,5000);
  assert.equal(exposure.fundEquivalentQuantity,2.5);
  assert.equal(r.denominatorCzk,104000);
  assert.equal(r.unallocatedCzk,95000);
});

test("X-Ray table tells direct shares apart from fund-only exposures and search includes identifiers",()=>{
  const view=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
  assert.ok(view.includes("item.directCzk > 0 ? quantity(item.directQuantity)"));
  assert.ok(view.includes("Pouze přes ETF"));
  const detail=readFileSync(new URL("../components/xray-exposure-breakdown.tsx",import.meta.url),"utf8");
  assert.ok(detail.includes("SEDOL "));
  assert.ok(detail.includes("ISIN "));
  assert.ok(view.includes("item.key, ...item.fundSymbols"));
  assert.ok(view.includes("pomlčka") || view.includes("Pomlčka"));
});
