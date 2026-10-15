import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay } from "../lib/xray/engine.ts";

const MSFT="US5949181045",VWCE="IE00BK5BQT80",SPYI="IE00B3YLTY66";
const holding=(id,symbol,assetClass,valueCzk,quantity,isin=null,provider="trading212",accountName="Invest")=>({
  id,symbol,name:symbol,assetClass,valueCzk,quantity,isin,canonicalKey:null,
  provider,accountName,
});
const row=(fundSymbol,fundIsin,securitySymbol,securityIsin,weightPct)=>({
  fundSymbol,fundIsin,securitySymbol,securityIsin,securitySedol:null,
  securityName:securitySymbol,weightPct,kind:"stock",
  asOf:"2026-10-14",source:"Official issuer daily holdings; 2026-10-14",
});
const nearly=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+" != "+b);

test("one stock explains exactly how much CZK comes from each ETF and each broker account",()=>{
  const holdings=[
    holding("direct1","MSFT","stock",100,0.5,MSFT),
    holding("direct2","MSFT","stock",200,1,MSFT,"kraken","Brokerage"),
    holding("v","VWCE","etf",1000,2,VWCE),
    holding("s","SPYI","etf",2000,4,SPYI),
  ];
  const compositions=[row("VWCE",VWCE,"MSFT",MSFT,10),
    row("SPYI",SPYI,"MSFT",MSFT,5)];
  const r=calculateXRay(holdings,compositions);
  assert.equal(r.denominatorCzk,3300);
  assert.equal(r.mappedCzk,500);
  assert.equal(r.unallocatedCzk,2800);
  const security=r.exposures.find(e=>e.key==="stock|isin:"+MSFT);
  assert.ok(security);
  assert.equal(security.totalCzk,500);
  assert.equal(security.directCzk,300);
  assert.equal(security.viaFundsCzk,200);
  assert.equal(security.directQuantity,1.5);
  assert.deepEqual(security.directContributions,[
    {account:"kraken · Brokerage",valueCzk:200,quantity:1},
    {account:"trading212 · Invest",valueCzk:100,quantity:0.5},
  ]);
  assert.deepEqual(security.fundContributions,[
    {fundSymbol:"SPYI",fundIsin:SPYI,valueCzk:100},
    {fundSymbol:"VWCE",fundIsin:VWCE,valueCzk:100},
  ]);
  nearly(security.directContributions.reduce((x,y)=>x+y.valueCzk,0),security.directCzk);
  nearly(security.fundContributions.reduce((x,y)=>x+y.valueCzk,0),security.viaFundsCzk);
  nearly(security.directCzk+security.viaFundsCzk,security.totalCzk);
  nearly(security.weightPct,100*500/3300);
});

test("multiple broker lots of same verified ISIN and account correctly accumulate quantity and value",()=>{
  const r=calculateXRay([
    holding("a","MSFT","stock",100,1,MSFT),
    holding("b","MSFT","stock",300,3,MSFT),
  ],[]);
  assert.equal(r.exposures.length,1);
  assert.deepEqual(r.exposures[0].directContributions,[
    {account:"trading212 · Invest",valueCzk:400,quantity:4},
  ]);
  assert.deepEqual(r.exposures[0].fundContributions,[]);
  assert.equal(r.exposures[0].fundEquivalentQuantity,null);
});

test("two exchange listings of the SAME ETF ISIN collapse to one underlying source group",()=>{
  const r=calculateXRay([
    holding("v1","VWCE","etf",1000,1,VWCE),
    holding("v2","VWRA","etf",2000,2,VWCE),
  ],[row("VWCE",VWCE,"MSFT",MSFT,10)]);
  assert.equal(r.exposures.length,1);
  const e=r.exposures[0];
  assert.equal(e.viaFundsCzk,300);
  assert.deepEqual(e.fundContributions,[
    {fundSymbol:"VWCE / VWRA",fundIsin:VWCE,valueCzk:300},
  ]);
  assert.deepEqual(e.fundSymbols,["VWCE","VWRA"]);
  assert.equal(r.denominatorCzk,3000);
  assert.equal(r.unallocatedCzk,2700);
});

test("different ETFs remain independent attribution sources even when they hold identical ISIN",()=>{
  const r=calculateXRay([
    holding("v","VWCE","etf",1000,1,VWCE),
    holding("s","SPYI","etf",1000,1,SPYI),
  ],[
    row("VWCE",VWCE,"MSFT",MSFT,20),
    row("SPYI",SPYI,"MSFT",MSFT,30),
  ]);
  const e=r.exposures[0];
  assert.equal(e.totalCzk,500);
  assert.equal(e.fundContributions.length,2);
  assert.deepEqual(e.fundContributions.map(x=>[x.fundSymbol,x.valueCzk]),
    [["SPYI",300],["VWCE",200]]);
});

test("crypto is direct-only, unknown share classes stay unmerged and no fake ETF source appears",()=>{
  const r=calculateXRay([
    holding("btc","BTC","crypto",1000,0.01,null,"kraken","Spot"),
    holding("abc1","ABC","stock",100,1,null,"trading212","Invest"),
    holding("abc2","ABC","stock",200,2,null,"kraken","Spot"),
  ],[]);
  assert.equal(r.denominatorCzk,1300);
  assert.equal(r.unallocatedCzk,0);
  const btc=r.exposures.find(x=>x.key==="crypto|crypto:BTC");
  assert.deepEqual(btc.directContributions,[
    {account:"kraken · Spot",valueCzk:1000,quantity:0.01},
  ]);
  assert.deepEqual(btc.fundContributions,[]);
  assert.equal(r.exposures.filter(x=>x.ticker==="ABC").length,2);
  for(const e of r.exposures){
    nearly(e.directContributions.reduce((a,b)=>a+b.valueCzk,0),e.directCzk);
    nearly(e.fundContributions.reduce((a,b)=>a+b.valueCzk,0),e.viaFundsCzk);
  }
});

test("fractional ETF percentages and multiple source positions remain financially conserved",()=>{
  const r=calculateXRay([
    holding("a","MSFT","stock",1023.32,1.25,MSFT),
    holding("v","VWCE","etf",10007.17,4,VWCE),
    holding("s","SPYI","etf",5214.56,3,SPYI),
  ],[
    row("VWCE",VWCE,"MSFT",MSFT,6.379),
    row("SPYI",SPYI,"MSFT",MSFT,6.471),
  ]);
  const e=r.exposures[0];
  nearly(e.fundContributions.reduce((sum,x)=>sum+x.valueCzk,0),e.viaFundsCzk);
  nearly(e.directContributions.reduce((sum,x)=>sum+x.valueCzk,0),e.directCzk);
  nearly(r.mappedCzk+r.unallocatedCzk,r.denominatorCzk);
  nearly(e.totalCzk,e.viaFundsCzk+e.directCzk);
});

test("interactive X-Ray row displays full-width source breakdown with per-account and per-fund amounts",()=>{
  const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const parent=read("components/portfolio-xray.tsx");
  const detail=read("components/xray-exposure-breakdown.tsx");
  assert.ok(parent.includes("<XRayExposureBreakdown exposure={item}/>"));
  assert.ok(parent.includes('<td colSpan={6}'));
  assert.ok(parent.includes("<Fragment key={item.key}>"));
  assert.ok(parent.includes("setSelected(selected===item.key?null:item.key)"));
  assert.ok(detail.includes("exposure.directContributions.map"));
  assert.ok(detail.includes("exposure.fundContributions.map"));
  assert.ok(detail.includes("Nepřímá ekonomická expozice"));
  assert.ok(detail.includes("Podíl z analyzovaného portfolia"));
});
