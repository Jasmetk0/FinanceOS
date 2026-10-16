import test from "node:test";
import assert from "node:assert/strict";
import {calculateXRay} from "../lib/xray/engine.ts";
import {calculateXRaySectorExposure} from "../lib/xray/sector-exposure.ts";

const SPYI="IE00B3YLTY66",VWCE="IE00BK5BQT80",LYMS="LU1829221024";
const MSFT="US5949181045",NVDA="US67066G1040",SEDOL="B1YW440",DATE="2026-10-15";
const issuer="State Street official daily SPYI XLSX; "+DATE;
const vanguard="Vanguard EU official GPX holdings; "+DATE;
const h=(id,symbol,type,valueCzk,isin)=>({
 id,symbol,name:symbol,assetClass:type,valueCzk,isin,
 quantity:1,provider:"trading212",accountName:"Invest",canonicalKey:null,
});
const r=(fundIsin,fundSymbol,securitySymbol,securityIsin,securitySedol,weightPct,sector,source,basis)=>({
 fundIsin,fundSymbol,securitySymbol,securityName:securitySymbol,
 securityIsin,securitySedol,weightPct,kind:"stock",asOf:DATE,source,
 ...(sector?{sector}:{}),...(basis?{exposureBasis:basis}:{}),
});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const base=()=>[
 r(SPYI,"SPYI","MSFT",MSFT,SEDOL,10,"Information Technology",issuer),
 r(SPYI,"SPYI","NVDA",NVDA,null,10,"Information Technology",issuer),
 r(VWCE,"VWCE","MSFT@"+SEDOL,null,SEDOL,20,null,vanguard),
 r(VWCE,"VWCE","MYSTERY",null,null,30,null,vanguard),
];
const owned=()=>[h("sp","SPYI","etf",1000,SPYI),h("vw","VWCE","etf",2000,VWCE),
  h("msft","MSFT","stock",100,MSFT)];
test("Vanguard exact SEDOL↔ISIN matches official SPYI classified stock without guessing name",()=>{
 const rows=base(),portfolio=calculateXRay(owned(),rows);
 const sectors=calculateXRaySectorExposure(portfolio,rows);
 const it=sectors.sectors.find(s=>s.sector==="Information Technology");
 assert.ok(it);
 near(it.viaEtfCzk,600); // SPYI 200 + Vanguard 400
 near(it.directCzk,100);
 near(sectors.classifiedCzk,700);
 near(sectors.unclassifiedCzk,2400);
 near(sectors.denominatorCzk,3100);
 near(sectors.classifiedCzk+sectors.unclassifiedCzk,sectors.denominatorCzk);
 near(sectors.funds.find(f=>f.isin===VWCE).classifiedCzk,400);
 assert.equal(sectors.directMatchedIsins,1);
});
test("ticker-only Vanguard row never borrows sector from same-named SPYI stock",()=>{
 const rows=base().map(x=>x.fundIsin===VWCE && x.securitySedol?
   {...x,securitySedol:null,securitySymbol:"MSFT"}:x);
 const out=calculateXRaySectorExposure(calculateXRay(owned(),rows),rows);
 near(out.funds.find(f=>f.isin===VWCE).classifiedCzk,0);
 near(out.classifiedCzk,300);
});
test("a SPYI reference not actually owned cannot lend a sector",()=>{
 const holdings=owned().filter(x=>x.isin!==SPYI);
 const rows=base();
 const out=calculateXRaySectorExposure(calculateXRay(holdings,rows),rows);
 assert.equal(out.funds.find(f=>f.isin===VWCE).classifiedCzk,0);
 assert.equal(out.directMatchedIsins,0);
});
test("conflicting GICS classifications for the same exact ISIN fail closed for other funds",()=>{
 const rows=[
  ...base(),
  r("IE00B5BMR087","SXR8","MSFT",MSFT,null,5,"Financials",
    "iShares official holdings (253743, positive market value; "+DATE+")"),
 ];
 const holdings=[...owned(),h("sx","SXR8","etf",1000,"IE00B5BMR087")];
 const out=calculateXRaySectorExposure(calculateXRay(holdings,rows),rows);
 assert.equal(out.directMatchedIsins,0);
 near(out.funds.find(f=>f.isin===VWCE).classifiedCzk,0);
});
test("modelled LYMS proxy cannot borrow physical fund sector even with exact ISIN",()=>{
 const proxy=Array.from({length:100},(_,i)=>r(LYMS,"LYMS",
   i===0?"MSFT":"MODEL"+i,i===0?MSFT:null,0.99,null,
   "CNDX synthetic proxy; "+DATE,"reference-index-proxy"));
 const rows=[...base(),...proxy];
 const holdings=[...owned(),h("ly","LYMS","etf",1000,LYMS)];
 const out=calculateXRaySectorExposure(calculateXRay(holdings,rows),rows);
 near(out.funds.find(f=>f.isin===LYMS).classifiedCzk,0);
 near(out.modelProxyUnclassifiedCzk,990);
});
test("a selected manual sector label cannot attest issuer classification",()=>{
 const rows=base().map(x=>x.fundIsin===SPYI?
 {...x,source:"manual-import.csv"}:x);
 const out=calculateXRaySectorExposure(calculateXRay(owned(),rows),rows);
 near(out.funds.find(f=>f.isin===VWCE).classifiedCzk,0);
});
