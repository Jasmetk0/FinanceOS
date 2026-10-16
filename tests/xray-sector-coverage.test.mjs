import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calculateXRay,validateXRayConstituents} from "../lib/xray/engine.ts";
import {parseIsharesHoldingsCsv,ISHARES_FEEDS} from "../lib/xray/auto-ishares.ts";
import {calculateXRaySectorExposure} from "../lib/xray/sector-exposure.ts";
import {normalizeIssuerSector} from "../lib/xray/sector-labels.ts";

const SXR8="IE00B5BMR087",SPYI="IE00B3YLTY66";
const VWCE="IE00BK5BQT80",LYMS="LU1829221024";
const MSFT="US5949181045",NVDA="US67066G1040",AAPL="US0378331005",BAC="US0605051046";
const date="2026-10-15";
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({
 id,symbol,name:symbol,assetClass,valueCzk,isin,canonicalKey:null,quantity:1,
 provider:"trading212",accountName:"Invest",
});
const xrow=(fundIsin,symbol,ticker,isin,weight,sector,source,extras={})=>({
 fundIsin,fundSymbol:symbol,securitySymbol:ticker,
 securityIsin:isin,securityName:ticker,weightPct:weight,
 kind:"stock",asOf:date,source,
 ...(sector?{sector}:{}),...extras,
});
const isharesSource="iShares official holdings (253743, positive market value; "+date+")";
const spyiSource="State Street official daily SPYI XLSX; "+date;
const vanguardSource="Vanguard EU official GPX holdings; "+date;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(){
 const lyms=Array.from({length:100},(_,i)=>xrow(LYMS,"LYMS","MODEL"+i,
   i===0?MSFT:null,0.99,null,"CNDX synthetic proxy; "+date,
   {exposureBasis:"reference-index-proxy"}));
 const holdings=[
   holding("sx","SXR8","etf",1000,SXR8),
   holding("sp","SPYI","etf",2000,SPYI),
   holding("vw","VWCE","etf",700,VWCE),
   holding("ly","LYMS","etf",500,LYMS),
   holding("ms","MSFT","stock",200,MSFT),
   holding("nv","NVDA","stock",100,NVDA),
   holding("crypto","BTC","crypto",50),
 ];
 const rows=[
   xrow(SXR8,"SXR8","MSFT",null,20,"Information Technology",isharesSource),
   xrow(SXR8,"SXR8","AAPL",null,30,"Consumer Discretionary",isharesSource),
   xrow(SPYI,"SPYI","MSFT",MSFT,10,"Information Technology",spyiSource),
   xrow(SPYI,"SPYI","NVDA",NVDA,20,"Information Technology",spyiSource),
   xrow(SPYI,"SPYI","BAC",BAC,10,"Financials",spyiSource),
   xrow(VWCE,"VWCE","MSFT",MSFT,20,null,vanguardSource),
   ...lyms,
 ];
 return {holdings,rows};
}

test("sector table preserves full portfolio NAV without filling unclassified Vanguard, crypto and LYMS proxy",()=>{
 const {holdings,rows}=fixture(),report=calculateXRay(holdings,rows);
 const result=calculateXRaySectorExposure(report,rows);
 close(report.denominatorCzk,4550);
 close(result.classifiedCzk,1740);
 close(result.issuerClassifiedCzk,1300);
 close(result.verifiedIsinClassifiedCzk,140);
 close(result.directUnclassifiedCzk,50);
 close(result.fundUnclassifiedCzk,2760);
 close(result.unclassifiedCzk,2810);
 close(result.modelProxyUnclassifiedCzk,495);
 close(result.classifiedCzk+result.unclassifiedCzk,result.denominatorCzk);
 assert.equal(result.directMatchedIsins,2);
 assert.equal(result.sectors.length,3);
 const it=result.sectors.find(x=>x.sector==="Information Technology");
 assert.ok(it);
 close(it.viaEtfCzk,940);
 close(it.viaIssuerCzk,800);
 close(it.viaVerifiedIsinCzk,140);
 close(it.directCzk,300);
 close(it.totalCzk,1240);
 close(it.portfolioPct,100*1240/4550);
 const discretionary=result.sectors.find(x=>x.sector==="Consumer Discretionary");
 close(discretionary.viaEtfCzk,300);
 const financial=result.sectors.find(x=>x.sector==="Financials");
 close(financial.viaEtfCzk,200);
 const vwce=result.funds.find(f=>f.isin===VWCE);
 const lyms=result.funds.find(f=>f.isin===LYMS);
 assert.equal(vwce.classifiedCzk,140);
 assert.equal(vwce.issuerClassifiedCzk,0);
 assert.equal(vwce.verifiedIsinClassifiedCzk,140);
 assert.equal(lyms.classifiedCzk,0);
 close(result.funds.reduce((v,f)=>v+f.issuerClassifiedCzk+f.verifiedIsinClassifiedCzk,0),result.issuerClassifiedCzk+result.verifiedIsinClassifiedCzk);
 close(report.mappedCzk+report.unallocatedCzk,result.denominatorCzk);
});
test("direct holding with unverified ticker or no issuer ISIN remains unclassified",()=>{
 const {holdings,rows}=fixture();
 const adjusted=holdings.map(h=>h.symbol==="MSFT"?{...h,isin:null,canonicalKey:null}:h);
 const result=calculateXRaySectorExposure(calculateXRay(adjusted,rows),rows);
 close(result.classifiedCzk,1540);
 close(result.directUnclassifiedCzk,250);
 assert.equal(result.directMatchedIsins,1);
});
test("conflicting issuer sectors for same ISIN do not classify the direct position",()=>{
 const {holdings,rows}=fixture();
 const wrong=rows.map(r=>r.fundIsin===SPYI&&r.securityIsin===MSFT?
   {...r,sector:"Financials"}:r);
 // SXR8 has no security ISIN, so use another issuer-backed share with exact ISIN.
 const withConflictingIsin=wrong.map(r=>r.fundIsin===SXR8&&r.securitySymbol==="MSFT"?
   {...r,securityIsin:MSFT}:r);
 const result=calculateXRaySectorExposure(
   calculateXRay(holdings,withConflictingIsin),withConflictingIsin);
 assert.equal(result.directMatchedIsins,1);
 close(result.directUnclassifiedCzk,250);
 close(result.classifiedCzk,1400);
});
test("stale source rows or mismatched as-of cannot claim coverage of a rejected fund",()=>{
 const {holdings,rows}=fixture();
 const report=calculateXRay(holdings,rows);
 const bad=rows.map(r=>r.fundIsin===SXR8?{...r,asOf:"2026-10-14"}:r);
 const r=calculateXRaySectorExposure(report,bad);
 const fund=r.funds.find(x=>x.isin===SXR8);
 assert.equal(fund.classifiedCzk,0);
 close(r.classifiedCzk,1240);
 close(r.fundUnclassifiedCzk,3260);
});
test("physical issuer rows without Sector retain their stock NAV but sector remains unknown",()=>{
 const {holdings,rows}=fixture();
 const noSector=rows.map(row=>({...row,sector:null}));
 const sector=calculateXRaySectorExposure(calculateXRay(holdings,noSector),noSector);
 assert.equal(sector.sectors.length,0);
 assert.equal(sector.classifiedCzk,0);
 close(sector.unclassifiedCzk,4550);
});
test("a standalone direct stock or crypto receives no fabricated sector without issuer evidence",()=>{
 const report=calculateXRay([
   holding("s","NVDA","stock",100,NVDA),
   holding("btc","BTC","crypto",200),
 ],[]);
 const result=calculateXRaySectorExposure(report,[]);
 close(result.unclassifiedCzk,300);
 assert.equal(result.directMatchedIsins,0);
 assert.equal(result.sectors.length,0);
});
test("sector-specific classification never invents new positions or changes unmapped NAV",()=>{
 const {holdings,rows}=fixture();
 const original=calculateXRay(holdings,rows);
 const classified=calculateXRaySectorExposure(original,rows);
 assert.equal(original.exposures.length,105);
 assert.equal(original.denominatorCzk,classified.denominatorCzk);
 assert.ok(original.unallocatedCzk>0);
 assert.ok(classified.unclassifiedCzk>=original.unallocatedCzk);
 const changed={...original,funds:original.funds.map(f=>f.isin===SXR8?
   {...f,mappedCzk:f.mappedCzk-50,unmappedCzk:f.unmappedCzk+50}:f)};
 assert.throws(()=>calculateXRaySectorExposure(changed,rows),/převýšily/);
});
test("invalid sector values in snapshots fail closed and non-GICS labels are never guessed",()=>{
 const {rows}=fixture();
 assert.throws(()=>validateXRayConstituents([
   {...rows[0],sector:"Tech / AI"},
 ]),/Neplatný podklad/);
 assert.equal(normalizeIssuerSector("Technology"),null);
 assert.equal(normalizeIssuerSector("Unassigned"),null);
 assert.equal(normalizeIssuerSector("Cash and/or Derivatives"),null);
 assert.equal(normalizeIssuerSector("healthcare"),"Health Care");
 assert.equal(normalizeIssuerSector("  information  technology "),"Information Technology");
});
test("official iShares CSV sector column survives parsing and missing or unsupported sectors do not become stocks",()=>{
 const feed=ISHARES_FEEDS[0];
 const line=(ticker,sector,market)=>[
  ticker,ticker,sector,"Equity",market,"0.00",market,"1","1",
  "United States","NASDAQ","USD",
 ].map(s=>'"'+String(s)+'"').join(",");
 const top="Fund Holdings as of,\"15/Oct/2026\"\n"+
   "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Market Currency\n";
 const rows=Array.from({length:10},(_,i)=>line("S"+i,
    i<3?"Information Technology":i<6?"Financials":"Unassigned",100));
 const parsed=parseIsharesHoldingsCsv(top+rows.join("\n")+"\n",feed,"SXR8");
 assert.equal(parsed.length,10);
 assert.equal(parsed.filter(r=>r.sector==="Information Technology").length,3);
 assert.equal(parsed.filter(r=>r.sector==="Financials").length,3);
 assert.equal(parsed.filter(r=>!r.sector).length,4);
});
test("sector UI reads verified source data and discloses proxy & unclassified denominators",()=>{
 const ui=readFileSync(new URL("../components/xray-sector-coverage.tsx",import.meta.url),"utf8");
 const parent=readFileSync(new URL("../components/portfolio-xray.tsx",import.meta.url),"utf8");
 assert.ok(parent.includes("calculateXRaySectorExposure(report.data,effectiveRows)"));
 assert.ok(parent.includes("<XRaySectorCoverage result={sectorReport.result}/>"));
 assert.ok(ui.includes("result.fundUnclassifiedCzk"));
 assert.ok(ui.includes("result.directUnclassifiedCzk"));
 assert.ok(ui.includes("result.modelProxyUnclassifiedCzk"));
 assert.ok(ui.includes("result.denominatorCzk"));
 assert.ok(ui.includes("Neznámé / neklasifikované"));
 assert.ok(ui.includes("result.issuerClassifiedCzk"));
 assert.ok(ui.includes("result.verifiedIsinClassifiedCzk"));
 assert.ok(ui.includes("aria-expanded={showOrigin}"));
 assert.ok(ui.includes("Ověřený ISIN"));
});
