import test from "node:test";
import assert from "node:assert/strict";
import { calculateXRay } from "../lib/xray/engine.ts";

const MSFT="US5949181045",OTHER="US0000000001";
const F1="IE00B5BMR087",F2="IE00B3YLTY66";
const holding=(id,symbol,cls,valueCzk,isin=null,provider="trading212",canonicalKey=null)=>({
  id,symbol,name:symbol,assetClass:cls,valueCzk,isin,quantity:1,
  canonicalKey,provider,accountName:"Invest",
});
const row=(fundSymbol,fundIsin,securitySymbol,securityIsin,weightPct,securitySedol=null)=>({
  fundSymbol,fundIsin,securitySymbol,securityIsin,securitySedol,
  securityName:securitySymbol,weightPct,kind:"stock",asOf:"2026-10-13",source:"mock-issuer",
});

test("two independent unverified direct positions sharing a ticker MUST NOT merge",()=>{
  const h=[holding("krk-1","ABC","stock",100,null,"kraken"),
    holding("t212-2","ABC","stock",50,null,"trading212")];
  const r=calculateXRay(h,[]);
  assert.equal(r.exposures.length,2);
  assert.equal(r.mappedCzk,150);
  assert.equal(r.unallocatedCzk,0);
  assert.equal(r.identityCoverage.tickerOnlyCzk,150);
  assert.deepEqual(r.exposures.map(x=>x.key).sort(),
    ["stock|position:krk-1","stock|position:t212-2"]);
  assert.equal(r.exposures.every(x=>x.fundEquivalentQuantity===null),true);
});

test("direct position without ISIN cannot falsely inherit fund ISIN from same ticker",()=>{
  const h=[
    holding("direct","ABC","stock",100),
    holding("f1","SXR8","etf",500,F1),
    holding("f2","SPYI","etf",300,F2),
  ];
  const composition=[
    row("SXR8",F1,"ABC",MSFT,30),
    row("SPYI",F2,"ABC",OTHER,30),
  ];
  const result=calculateXRay(h,composition);
  assert.equal(result.exposures.length,3);
  assert.equal(result.exposures.find(x=>x.key==="stock|position:direct").directCzk,100);
  assert.equal(result.exposures.find(x=>x.key==="stock|isin:"+MSFT).viaFundsCzk,150);
  assert.equal(result.exposures.find(x=>x.key==="stock|isin:"+OTHER).viaFundsCzk,90);
  assert.equal(result.denominatorCzk,900);
  assert.equal(result.mappedCzk,340);
  assert.equal(result.unallocatedCzk,560);
});

test("a symbol-only fund security cannot auto-merge with same ticker in a different ETF",()=>{
  const h=[holding("f1","SXR8","etf",1000,F1),holding("f2","SPYI","etf",2000,F2)];
  const r=calculateXRay(h,[
    row("SXR8",F1,"ABC",null,10),
    row("SPYI",F2,"ABC",null,20),
  ]);
  assert.equal(r.exposures.length,2);
  assert.ok(r.exposures.every(x=>x.key.startsWith("stock|fund:")));
  assert.equal(r.mappedCzk,500);
  assert.equal(r.identityCoverage.tickerOnlyCzk,500);
  assert.equal(r.unallocatedCzk,2500);
});

test("explicit matching ISIN still merges two brokers and holdings inside ETFs",()=>{
  const h=[holding("x","MSFT","stock",100,MSFT),
    holding("y","MSFT","stock",50,MSFT,"interactivebrokers"),
    holding("f","SXR8","etf",1000,F1)];
  const r=calculateXRay(h,[row("SXR8",F1,"MSFT",MSFT,10)]);
  assert.equal(r.exposures.length,1);
  assert.equal(r.exposures[0].key,"stock|isin:"+MSFT);
  assert.equal(r.exposures[0].directCzk,150);
  assert.equal(r.exposures[0].viaFundsCzk,100);
  assert.equal(r.exposures[0].fundEquivalentQuantity,100/(150/2));
  assert.equal(r.mappedCzk,250);
});

test("broker canonical ISIN matches even when the explicit ISIN property is empty",()=>{
  const r=calculateXRay([holding("direct","MSFT","stock",500,null,
    "trading212","isin:"+MSFT),
    holding("f","SXR8","etf",1000,F1)],[
    row("SXR8",F1,"MSFT",MSFT,10)]);
  assert.equal(r.exposures.length,1);
  assert.equal(r.exposures[0].totalCzk,600);
  assert.equal(r.identityCoverage.isinCzk,600);
});

test("identical valid SEDOL bridges positions between two ETF funds without a fabricated ISIN",()=>{
  const sedol="B1YW440";
  const r=calculateXRay([
    holding("a","SXR8","etf",1000,F1),
    holding("b","SPYI","etf",1000,F2),
  ],[
    row("SXR8",F1,"ABC@B1YW440",null,10,sedol),
    row("SPYI",F2,"ABC2@B1YW440",null,15,sedol),
  ]);
  assert.equal(r.exposures.length,1);
  assert.equal(r.exposures[0].key,"stock|sedol:"+sedol);
  assert.equal(r.exposures[0].viaFundsCzk,250);
  assert.equal(r.identityCoverage.sedolOnlyCzk,250);
});

test("fund with KNOWN ISIN must not inherit an unrelated symbol-only imported composition",()=>{
  const h=[holding("f","SAME","etf",1000,F1)];
  const source=[row("SAME",null,"MSFT",MSFT,30)];
  const r=calculateXRay(h,source);
  assert.equal(r.mappedCzk,0);
  assert.equal(r.unallocatedCzk,1000);
  assert.match(r.warnings.join(" "),/CSV bez fund_isin/);
});

test("fund with an ISIN uses exact issuer ISIN, even if ticker differs",()=>{
  const h=[holding("f","SAME","etf",1000,F1)];
  const source=[row("DIFFERENT",F1,"MSFT",MSFT,30)];
  const r=calculateXRay(h,source);
  assert.equal(r.mappedCzk,300);
  assert.equal(r.unallocatedCzk,700);
});

test("symbol-only manual CSV remains usable only when broker has NO fund ISIN",()=>{
  const h=[holding("f","SAME","etf",1000)];
  const r=calculateXRay(h,[row("SAME",null,"MSFT",MSFT,30)]);
  assert.equal(r.mappedCzk,300);
  assert.equal(r.unallocatedCzk,700);
});

test("two distinct known ETF ISINs with same ticker never cross-apply manual composition",()=>{
  const h=[holding("a","SAME","etf",1000,F1),
    holding("b","SAME","etf",2000,F2)];
  const c=[row("SAME",null,"MSFT",MSFT,40)];
  const r=calculateXRay(h,c);
  assert.equal(r.mappedCzk,0);
  assert.equal(r.denominatorCzk,3000);
  assert.equal(r.unallocatedCzk,3000);
});

test("structured ticker delimiters cannot make two different symbols share a fallback key",()=>{
  const a=row("SXR8",F1,"ABC",null,10);
  const b=row("SXR8",F1,"ABC|security:DEF",null,10);
  const r=calculateXRay([holding("f","SXR8","etf",1000,F1)],[a,b]);
  assert.equal(r.exposures.length,2);
  assert.equal(r.mappedCzk,200);
});
