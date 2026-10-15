import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay, validateXRayConstituents } from "../lib/xray/engine.ts";
import { parseIssuerCsv } from "../lib/xray/issuer-import.ts";
import { parseXRayCompositionCsv } from "../lib/xray/import.ts";

const LYMS="LU1829221024",EQQQ="IE0032077012",MSFT="US5949181045";
const holding=(id,symbol,kind,valueCzk,isin)=>({
  id,symbol,name:symbol,assetClass:kind,isin,canonicalKey:null,
  valueCzk,quantity:1,provider:"trading212",accountName:"Invest",
});
const constituent=(symbol,weightPct,basis,isin=null,fundIsin=LYMS)=>({
  fundSymbol:fundIsin===LYMS?"LYMS":"EQQQ",
  fundIsin,securitySymbol:symbol,securityName:"Security "+symbol,
  securityIsin:isin,weightPct,kind:"stock",asOf:"2026-10-14",
  source:"User-supplied complete benchmark snapshot",
  ...(basis ? {exposureBasis:basis}: {}),
});

test("legacy holdings CSV for Amundi synthetic fund never masquerades as reference index",()=>{
  const rows=[constituent("MSFT",40,undefined,MSFT),constituent("NVDA",60,undefined,"US67066G1040")];
  const result=calculateXRay([holding("lyms","LYMS","etf",25116,LYMS)],rows);
  assert.equal(result.mappedCzk,0);
  assert.equal(result.unallocatedCzk,25116);
  assert.equal(result.exposures.length,0);
  assert.match(result.funds[0].note,/náhradní swapový koš/);
  assert.match(result.warnings.join(" "),/Indexová expozice/);
});

test("even a complete real substitute basket cannot become synthetic benchmark exposure",()=>{
  const rows=Array.from({length:100},(_,i)=>constituent("H"+i,1,"substitute-basket"));
  const result=calculateXRay([holding("fund","LYMS","etf",2000,LYMS)],rows);
  assert.equal(result.mappedCzk,0);
  assert.equal(result.funds[0].mappedPct,0);
});

test("top-ten reference-index weights fail closed rather than suggesting full coverage",()=>{
  const rows=Array.from({length:10},(_,i)=>constituent("N"+i,10,"reference-index"));
  const result=calculateXRay([holding("fund","LYMS","etf",1000,LYMS)],rows);
  assert.equal(result.mappedCzk,0);
  assert.equal(result.unallocatedCzk,1000);
  assert.match(result.funds[0].note,/alespoň 90/);
});

test("complete labelled benchmark has economic (not physically held) stock exposure with correct attribution",()=>{
  const rows=Array.from({length:100},(_,i)=>constituent(
    i===0?"MSFT":"N"+i,1,"reference-index",i===0?MSFT:null
  ));
  const r=calculateXRay([
    holding("fund","LYMS","etf",10000,LYMS),
    holding("direct","MSFT","stock",500,MSFT),
  ],rows);
  const msft=r.exposures.find(e=>e.key==="stock|isin:"+MSFT);
  assert.ok(msft);
  assert.equal(msft.directCzk,500);
  assert.equal(msft.viaFundsCzk,100);
  assert.equal(msft.totalCzk,600);
  assert.deepEqual(msft.fundContributions,[{
    fundSymbol:"LYMS",fundIsin:LYMS,valueCzk:100,exposureBasis:"reference-index",
  }]);
  assert.equal(r.funds[0].exposureBasis,"reference-index");
  assert.equal(r.mappedCzk,10500);
  assert.equal(r.unallocatedCzk,0);
  assert.equal(r.denominatorCzk,10500);
  assert.match(r.warnings.join(" "),/nejsou fyzicky drženy/);
});

test("synthetic and physical snapshot bases cannot be combined into a valid index mapping",()=>{
  const rows=Array.from({length:100},(_,i)=>constituent("N"+i,1,
    i===0?"substitute-basket":"reference-index"));
  const r=calculateXRay([holding("fund","LYMS","etf",1000,LYMS)],rows);
  assert.equal(r.mappedCzk,0);
  assert.equal(r.unallocatedCzk,1000);
});

test("reference index for a physical fund is not silently treated as the fund holdings",()=>{
  const rows=Array.from({length:100},(_,i)=>constituent("N"+i,1,"reference-index",null,EQQQ));
  const r=calculateXRay([holding("fund","EQQQ","etf",1000,EQQQ)],rows);
  assert.equal(r.mappedCzk,0);
  assert.match(r.funds[0].note,/Fyzické ETF/);
});

test("standard X-Ray CSV can declare a benchmark source, invalid declaration is refused",()=>{
  const csv="fund_symbol,fund_isin,security_symbol,security_name,weight_pct,kind,as_of,exposure_basis\n"+
    "LYMS,LU1829221024,NVDA,NVIDIA,8,stock,2026-10-14,reference-index\n";
  const parsed=parseXRayCompositionCsv(csv,"nasdaq-snapshot.csv");
  assert.equal(parsed[0].exposureBasis,"reference-index");
  assert.throws(()=>parseXRayCompositionCsv(csv.replace("reference-index","unverified-basket"),"bad.csv"),
    /Neplatný podklad/);
  assert.throws(()=>validateXRayConstituents([{...parsed[0],exposureBasis:"other"}]),/Neplatný/);
});

test("native issuer CSV for LYMS rejects ambiguous swap basket up front",()=>{
  const csv="Ticker,Name,Asset Class,Weight (%)\nMSFT,Microsoft,Equity,100\n";
  assert.throws(()=>parseIssuerCsv(csv,{
    fundSymbol:"LYMS",fundIsin:LYMS,asOf:"2026-10-14",
    source:"issuer-basket.csv",weightFormat:"percent",
  }),/Syntetické ETF/);
});

test("UI distinguishes benchmark stock values and source from physically held ETF constituents",()=>{
  const detail=readFileSync(new URL("../components/xray-exposure-breakdown.tsx",import.meta.url),"utf8");
  const parent=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
  assert.ok(detail.includes('item.exposureBasis==="reference-index"'));
  assert.ok(parent.includes('f.exposureBasis==="reference-index"'));
});
