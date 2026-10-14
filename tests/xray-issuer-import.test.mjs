import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIssuerCsv } from "../lib/xray/issuer-import.ts";
import { calculateXRay } from "../lib/xray/engine.ts";

const opt = (override={})=>({
  fundSymbol:"VWCE",fundIsin:"IE00BK5BQT80",asOf:"2026-10-13",
  source:"issuer-vwce.csv",weightFormat:"percent",...override
});
const holding=(symbol,assetClass,value,isin=null)=>({
  id:"id-"+symbol,symbol,name:symbol,assetClass,isin,canonicalKey:null,
  quantity:1,valueCzk:value,provider:"trading212",accountName:"Invest"
});

test("parses issuer preamble, quoted CSV names and differentiates stock/cash/bonds",()=>{
  const csv='Holdings as at,2026-10-13\nVanguard factsheet\n\n'+
    '"Ticker","Name","ISIN","Asset Class","Weight (%)"\n'+
    '"MSFT","Microsoft, Corporation","US5949181045","Equity","8.25"\n'+
    '"AAPL","Apple Inc","US0378331005","Equity","6.5"\n'+
    '"CASH","US Dollars","","Cash","1.5"\n'+
    '"BOND","Treasury","","Fixed Income","2"\n';
  const p=parseIssuerCsv(csv,opt());
  assert.equal(p.headerLine,4);
  assert.equal(p.rows.length,4);
  assert.equal(p.rows[0].securityName,"Microsoft, Corporation");
  assert.equal(p.rows[0].securitySymbol,"MSFT");
  assert.equal(p.rows[0].kind,"stock");
  assert.equal(p.rows[2].kind,"other");
  assert.equal(p.rows[3].kind,"other");
  assert.ok(Math.abs(p.identifiedPct-14.75)<1e-8);
  assert.ok(Math.abs(p.otherPct-3.5)<1e-8);
  assert.ok(Math.abs(p.remainderPct-81.75)<1e-8);
  const r=calculateXRay([holding("MSFT","stock",100,"US5949181045"),holding("VWCE","etf",200,"IE00BK5BQT80")],p.rows);
  assert.equal(r.denominatorCzk,300);
  assert.equal(r.exposures.find(x=>x.ticker==="MSFT").totalCzk,116.5);
  assert.equal(r.funds[0].mappedPct,14.75);
  assert.ok(Math.abs(r.mappedCzk+r.unallocatedCzk-r.denominatorCzk)<1e-7);
});

test("semicolon issuer CSV handles Czech decimals and explicit 0–1 weight unit",()=>{
  const csv="Ticker;Name;ISIN;Asset Class;Weight (%)\n"+
    'NVDA;"Nvidia, Inc";US67066G1040;Equity;0,0425\n'+
    "CASH;Cash;;Cash;0,01\n";
  const p=parseIssuerCsv(csv,opt({weightFormat:"fraction"}));
  assert.equal(p.rows.length,2);
  assert.equal(p.rows[0].weightPct,4.25);
  assert.equal(p.rows[1].weightPct,1);
  assert.equal(p.identifiedPct,4.25);
  assert.equal(p.remainderPct,94.75);
});

test("ISIN without ticker is accepted for identifiable equity; absent equity identity fails",()=>{
  const good="Name,ISIN,Asset Class,Weight (%)\nMicrosoft,US5949181045,Equity,10";
  assert.equal(parseIssuerCsv(good,opt()).rows[0].securitySymbol,"US5949181045");
  const bad="Ticker,Name,ISIN,Asset Class,Weight (%)\n-,Mystery,,Equity,5";
  assert.throws(()=>parseIssuerCsv(bad,opt()),/Řádek 2: akcie nebo krypto nemá ticker ani ISIN/);
});

test("zero/invalid dates, missing asset classes, ambiguous footers and wrong totals fail closed",()=>{
  const base="Ticker,Name,ISIN,Asset Class,Weight (%)\nMSFT,Microsoft,US5949181045,Equity,70\n";
  assert.throws(()=>parseIssuerCsv(base,opt({asOf:"2026-02-30"})),/Neplatné kalendářní datum/);
  assert.throws(()=>parseIssuerCsv(base,opt({asOf:""})),/YYYY-MM-DD/);
  assert.throws(()=>parseIssuerCsv(base,opt({weightFormat:"fraction"})),/mimo interval/);
  assert.throws(()=>parseIssuerCsv(base+"NVDA,Nvidia,US67066G1040,Equity,35\n",opt()),/překračuje 100/);
  assert.throws(()=>parseIssuerCsv(base+"Holdings may change\n",opt()),/počet sloupců/);
  assert.throws(()=>parseIssuerCsv(base.replace("Equity","Unknown Instrument"),opt()),/Neznámý typ/);
  assert.throws(()=>parseIssuerCsv("Ticker,Name,Weight (%)\nMSFT,Microsoft,10",opt()),/Nenašel jsem tabulku/);
});

test("a previous aggregated X-Ray export is rejected as not an issuer constituent table",()=>{
  const report="index,category,company,ticker,value,weight,direct_value,etf_value,quantity_direct\n"+
    "0,Akcie,Microsoft,MSFT,20132,0.06016,12302,7830,1";
  assert.throws(()=>parseIssuerCsv(report,opt()),/Nenašel jsem tabulku/);
});

test("native import workflow visibly supports preview and does not edit accounting ledger",()=>{
  const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const ui=read("components/xray-issuer-import.tsx");
  const page=read("components/portfolio-xray.tsx");
  assert.ok(ui.includes("parseIssuerCsv(await file.text()"));
  assert.ok(ui.includes("Potvrdit import pro"));
  assert.ok(page.includes("<XRayIssuerImport"));
  assert.ok(page.includes("await writeRows(next)"));
  assert.ok(!ui.includes('fetch('));
  assert.ok(!ui.includes('updateDb('));
});
