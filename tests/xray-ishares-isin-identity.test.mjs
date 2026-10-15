import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {ISHARES_FEEDS,parseIsharesHoldingsCsv} from "../lib/xray/auto-ishares.ts";
import {calculateXRay} from "../lib/xray/engine.ts";
import {normalizedSedol} from "../lib/xray/security-identity.ts";

const feed=ISHARES_FEEDS.find(f=>f.isin==="IE00B5BMR087");
const spyi="IE00B3YLTY66";
const msft="US5949181045";
const originalHeader="Fund Holdings as of,\"14/Oct/2026\"";
const columns=["Ticker","Name","Sector","Asset Class","Market Value","Weight (%)",
  "Notional Value","Shares","Price","Location","Exchange","Market Currency"];
const makeRow=(ticker,name,value,exchange="NASDAQ",location="United States",
  type="Equity",extra=[])=>[
  ticker,name,"Technology",type,String(value),"0.00",String(value),"1.00","1.00",
  location,exchange,"USD",...extra,
];
const asCsv=(rows,extras=[])=>[
  originalHeader,[...columns,...extras].join(","),
  ...rows.map(x=>x.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")),
].join("\n")+"\n";
const holding=(id,symbol,cls,valueCzk,isin=null)=>({
  id,symbol,name:symbol,assetClass:cls,valueCzk,isin,
  quantity:1,canonicalKey:null,provider:"trading212",accountName:"Invest",
});
const base=()=>[
  makeRow("MSFT","MICROSOFT",400),
  makeRow("NVDA","NVIDIA",200),
  makeRow("AAPL","APPLE",100),
  makeRow("AMZN","AMAZON",50),
  makeRow("META","META PLATFORMS",50),
  makeRow("GOOG","ALPHABET C",40),
  makeRow("GOOGL","ALPHABET A",40),
  makeRow("AMD","AMD",20),
  makeRow("ORCL","ORACLE",20),
  makeRow("TSLA","TESLA",20),
  makeRow("USD","USD CASH",40,"-","United States","Cash"),
];
test("actual iShares 2026 latest-holdings.csv schema without ISIN remains supported and non-inferred",()=>{
  const r=parseIsharesHoldingsCsv(asCsv(base()),feed,"SXR8");
  assert.equal(r.length,11);
  assert.ok(r.every(x=>x.securityIsin===null));
  assert.ok(r.every(x=>x.securitySedol==null));
  assert.ok(Math.abs(r.reduce((a,b)=>a+b.weightPct,0)-100)<1e-7);
});
test("optional issuer ISIN/SEDOL metadata merges only precisely identified shares across ETF and direct account",()=>{
  const r=base().map(row=>[...row,row[0]==="MSFT"?msft:row[0]==="NVDA"?"US67066G1040":"",
    row[0]==="MSFT"?"2588173":row[0]==="NVDA"?"2379504":""]);
  const parsed=parseIsharesHoldingsCsv(asCsv(r,["ISIN","SEDOL"]),feed,"SXR8");
  const microsoft=parsed.find(r=>r.securitySymbol==="MSFT");
  assert.ok(microsoft);
  assert.equal(microsoft.securityIsin,msft);
  assert.equal(microsoft.securitySedol,"2588173");
  assert.ok(parsed.filter(r=>r.kind==="stock"&&r.securityIsin).length>=2);
  const result=calculateXRay([
    holding("direct","MSFT","stock",100,msft),
    holding("etf","SXR8","etf",1000,feed.isin),
    holding("spyi","SPYI","etf",500,spyi),
  ],[
    ...parsed,
    {fundSymbol:"SPYI",fundIsin:spyi,securitySymbol:"MSFT",
      securityIsin:msft,securitySedol:"2588173",securityName:"MICROSOFT",
      kind:"stock",weightPct:20,asOf:"2026-10-14",
      source:"State Street official daily SPYI XLSX; 2026-10-14"},
  ]);
  const exp=result.exposures.find(x=>x.key==="stock|isin:"+msft);
  assert.ok(exp);
  assert.equal(exp.directCzk,100);
  assert.ok(exp.viaFundsCzk>500);
  assert.equal(exp.fundContributions.length,2);
  assert.ok(Math.abs(result.denominatorCzk-result.mappedCzk-result.unallocatedCzk)<1e-7);
});
test("same ticker + same company name on two exchanges without IDs must remain distinct",()=>{
  const rows=base();
  rows[7]=makeRow("ABC","SAME CO",10,"Nasdaq","United States");
  rows[8]=makeRow("ABC","SAME CO",10,"Toronto Stock Exchange","Canada");
  const r=parseIsharesHoldingsCsv(asCsv(rows),feed,"SXR8");
  const two=r.filter(x=>x.securitySymbol.startsWith("ABC@"));
  assert.equal(two.length,2);
  assert.notEqual(two[0].securitySymbol,two[1].securitySymbol);
  assert.ok(two.every(x=>x.securityIsin===null));
});
test("different issuer-provided ISINs never collide even when tickers and company names are equal",()=>{
  const rows=base().map(row=>[...row,row[0]==="MSFT"?msft:"",
    row[0]==="MSFT"?"2588173":""]);
  rows.push(makeRow("MSFT","MICROSOFT",20,"Toronto Stock Exchange","Canada",
    "Equity",["CA0000000001",""]));
  // Distinct ISINs win over the matching ticker and label.
  const parsed=parseIsharesHoldingsCsv(asCsv(rows,["ISIN","SEDOL"]),feed,"SXR8");
  const two=parsed.filter(x=>x.securitySymbol==="MSFT");
  assert.equal(two.length,2);
  assert.notEqual(two[0].securityIsin,two[1].securityIsin);
  const result=calculateXRay([holding("fund","SXR8","etf",1000,feed.isin)],parsed);
  assert.equal(result.exposures.filter(x=>x.ticker==="MSFT").length,2);
});
test("one verified ISIN across two exchange listings aggregates value, but drops nonunique SEDOL",()=>{
  const rows=base().map(row=>[...row,row[0]==="MSFT"?msft:"",
    row[0]==="MSFT"?"2588173":""]);
  rows.push(makeRow("MSFT","MICROSOFT",20,"Toronto Stock Exchange","Canada",
    "Equity",[msft,"2379504"]));
  const parsed=parseIsharesHoldingsCsv(asCsv(rows,["ISIN","SEDOL"]),feed,"SXR8");
  const matches=parsed.filter(r=>r.securityIsin===msft);
  assert.equal(matches.length,1);
  assert.equal(matches[0].securitySedol,null);
  assert.ok(matches[0].weightPct>0);
});
test("malformed supplied ISIN or invalid SEDOL must not silently become ticker-based stock",()=>{
  const rows=base().map(row=>[...row,row[0]==="MSFT"?"BAD-ISIN":"", ""]);
  assert.throws(()=>parseIsharesHoldingsCsv(asCsv(rows,["ISIN","SEDOL"]),feed,"SXR8"),/poškozený ISIN\/SEDOL/);
  rows[0][12]=msft;rows[0][13]="2588174";
  assert.equal(normalizedSedol("2588174"),null);
  assert.throws(()=>parseIsharesHoldingsCsv(asCsv(rows,["ISIN","SEDOL"]),feed,"SXR8"),/poškozený ISIN\/SEDOL/);
});
test("duplicate issuer ISIN attached to two different company names fails closed",()=>{
 const rows=base().map(row=>[...row,row[0]==="MSFT"||row[0]==="NVDA"?msft:""]);
 assert.throws(()=>parseIsharesHoldingsCsv(asCsv(rows,["ISIN"]),feed,"SXR8"),/rozdílné akcie/);
});
test("iShares CSV no longer identifies two unrelated exchange listings merely by ticker",()=>{
 const code=readFileSync(new URL("../lib/xray/auto-ishares.ts",import.meta.url),"utf8");
 assert.ok(code.includes("normalizedIsin(rawIsin)"));
 assert.ok(code.includes("normalizedSedol(rawSedol)"));
 assert.ok(code.includes("row.exchange.toUpperCase()"));
 assert.ok(code.includes("row.location.toUpperCase()"));
});
