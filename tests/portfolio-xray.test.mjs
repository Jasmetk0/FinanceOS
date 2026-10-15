import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateXRay, validateXRayConstituents } from "../lib/xray/engine.ts";
import { parseXRayCompositionCsv } from "../lib/xray/import.ts";

function holding(id, symbol, assetClass, valueCzk, quantity, isin = null) {
  return { id, symbol, assetClass, valueCzk, quantity, isin, name: symbol, canonicalKey: null, provider: "trading212", accountName: "Invest" };
}
function part(fundSymbol, securitySymbol, weightPct, kind="stock", securityIsin=null, fundIsin=null) {
  return { fundSymbol, fundIsin, securitySymbol, securityIsin, securityName: securitySymbol, weightPct, kind, asOf: "2026-10-14", source: "issuer" };
}

test("total portfolio value is conserved and missing ETF composition stays visibly unmapped", () => {
  const holdings = [
    holding("msft","MSFT","stock",100,1,"US5949181045"),
    holding("nvda","NVDA","stock",50,2,"US67066G1040"),
    holding("btc","BTC","crypto",40,0.01),
    holding("fund","FUND","etf",200,1,"IE00B0000000"),
    holding("missing","OTHER","etf",100,1),
    holding("p2p","P2P","p2p",1000,10),
  ];
  const compositions = [
    part("FUND","MSFT",20,"stock","US5949181045","IE00B0000000"),
    part("FUND","NVDA",10,"stock","US67066G1040","IE00B0000000"),
    part("FUND","CASH",5,"other",null,"IE00B0000000"),
  ];
  const report=calculateXRay(holdings,compositions);
  assert.equal(report.denominatorCzk,490);
  assert.equal(report.directCzk,190);
  assert.equal(report.fundsCzk,300);
  assert.equal(report.mappedCzk,250);
  assert.equal(report.unallocatedCzk,240);
  assert.ok(Math.abs(report.denominatorCzk-report.mappedCzk-report.unallocatedCzk)<1e-7);
  assert.equal(report.exposures.length,3);
  assert.equal(report.exposures[0].ticker,"MSFT");
  assert.equal(report.exposures[0].directCzk,100);
  assert.equal(report.exposures[0].viaFundsCzk,40);
  assert.equal(report.exposures[0].fundEquivalentQuantity,0.4);
  assert.equal(report.funds.find(r=>r.symbol==="OTHER").mappedPct,0);
  assert.equal(report.funds.find(r=>r.symbol==="FUND").unmappedCzk,140);
});

test("two brokers holding the same ISIN merge while different shares do not", () => {
  const holdings=[
    holding("a","MSFT","stock",100,1,"US5949181045"),
    holding("b","MSFT","stock",200,2,"US5949181045"),
    holding("c","ABC","stock",300,3,"US0000000001"),
    holding("d","ABC","stock",400,4,"US0000000002"),
  ];
  const r=calculateXRay(holdings,[]);
  assert.equal(r.exposures.length,3);
  assert.equal(r.exposures.find(x=>x.ticker==="MSFT").totalCzk,300);
  assert.equal(r.exposures.filter(x=>x.ticker==="ABC").length,2);
});

test("ticker-only direct position NEVER inherits an ISIN merely from matching ETF ticker", () => {
  const h=[holding("one","NVDA","stock",100,1),holding("etf","FUND","etf",200,1)];
  const c=[part("FUND","NVDA",10,"stock","US67066G1040")];
  const r=calculateXRay(h,c);
  assert.equal(r.exposures.length,2);
  assert.equal(r.exposures.find(x=>x.key==="stock|position:one").directCzk,100);
  assert.equal(r.exposures.find(x=>x.key==="stock|isin:US67066G1040").viaFundsCzk,20);
  assert.equal(r.exposures.find(x=>x.key==="stock|position:one").fundEquivalentQuantity,null);
  assert.equal(r.denominatorCzk,300);
  assert.equal(r.unallocatedCzk,180);
  assert.match(r.warnings.join(" "),/nemá ISIN/);
});

test("ambiguous ISIN ticker never silently merges different securities", () => {
  const h=[holding("a","ABC","stock",100,1),holding("f","FUND","etf",100,1)];
  const c=[part("FUND","ABC",10,"stock","US0000000001"),part("FUND","ABC",20,"stock","US0000000002")];
  const r=calculateXRay(h,c);
  assert.equal(r.exposures.length,3);
  assert.equal(r.mappedCzk,130);
});

test("crypto aliases normalize and do not double-count stock tickers", () => {
  const r=calculateXRay([
    holding("btc","BTC","crypto",100,0.01),
    holding("xbt","XBT","crypto",50,0.005),
    holding("stock","BTC","stock",70,1),
  ],[]);
  assert.equal(r.exposures.length,2);
  assert.equal(r.exposures.find(x=>x.kind==="crypto").totalCzk,150);
  assert.equal(r.exposures.find(x=>x.kind==="stock").totalCzk,70);
});

test("ambiguous fund ticker composition is not applied to multiple ISINs", () => {
  const h=[
    holding("f1","FUND","etf",100,1,"IE00B0000000"),
    holding("f2","FUND","etf",200,1,"IE00C0000000"),
  ];
  const r=calculateXRay(h,[part("FUND","MSFT",30)]);
  assert.equal(r.exposures.length,0);
  assert.equal(r.unallocatedCzk,300);
  assert.match(r.warnings.join(" "),/více ISIN/);
});

test("overweight funds, duplicated rows and invalid holdings fail closed", () => {
  assert.throws(()=>validateXRayConstituents([part("F","A",75),part("F","B",30)]),/překračuje 100/);
  assert.throws(()=>validateXRayConstituents([part("F","A",20),part("F","A",20)]),/Duplicitní/);
  assert.throws(()=>calculateXRay([holding("a","ABC","stock",-10,1)],[]),/záporná/);
});

test("CSV handles quoted commas, semicolon decimals and rejects missing required columns atomically", () => {
  const csv="fund_symbol;fund_isin;security_symbol;security_isin;security_name;weight_pct;kind;as_of;source\r\n"+
    'FUND;IE00B0000000;MSFT;US5949181045;"Microsoft, Corp";12,5;stock;2026-10-14;issuer\r\n'+
    "FUND;IE00B0000000;CASH;;Cash;87,5;other;2026-10-14;issuer\r\n";
  const parsed=parseXRayCompositionCsv(csv,"issuer.csv");
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].securityName,"Microsoft, Corp");
  assert.equal(parsed[0].weightPct,12.5);
  assert.throws(()=>parseXRayCompositionCsv("fund_symbol,security_symbol,weight_pct\nF,A,20\n","test.csv"),/povinný/);
  assert.throws(()=>parseXRayCompositionCsv(csv.replace("87,5","88,5"),"bad.csv"),/překračuje 100/);
  assert.throws(()=>parseXRayCompositionCsv(csv.replace("12,5","bad"),"bad.csv"),/Řádek 2/);
});

test("X-Ray reads actual local holdings and does not embed user exports or API credentials", () => {
  const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const page=read("app/xray/page.tsx");
  const server=read("lib/server/xray.ts");
  const client=read("components/portfolio-xray.tsx");
  const nav=read("components/app-shell.tsx");
  assert.ok(page.includes("getXRayLiveSnapshot()"));
  assert.ok(server.includes("a.canonical_key"));
  assert.ok(server.includes("a.isin"));
  assert.ok(client.includes("indexedDB.open"));
  assert.ok(client.includes("validateXRayConstituents(merged)"));
  assert.ok(nav.includes('href: "/xray"'));
  assert.ok(!client.includes('fetch('));
});
