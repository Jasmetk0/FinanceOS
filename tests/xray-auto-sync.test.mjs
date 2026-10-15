import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  issuerFeedForIsin, ISHARES_FEEDS, parseIsharesHoldingsCsv, fetchIsharesHoldings,
} from "../lib/xray/auto-ishares.ts";
import { combineConstituentSources } from "../lib/xray/auto-merge.ts";
import { calculateXRay } from "../lib/xray/engine.ts";

const feed=ISHARES_FEEDS[0];
const header="Fund Holdings as of,\"13/Oct/2026\"\n"+
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Market Currency\n";
const equity=(ticker, name, market, exchange="NASDAQ", location="United States")=>
  '"'+ticker+'","'+name+'","Information Technology","Equity","'+market+'","0.00","'+market+'","1.00","1.00","'+location+'","'+exchange+'","USD"\n';
const other=(ticker,name,market,kind="Cash")=>
  '"'+ticker+'","'+name+'","Cash and/or Derivatives","'+kind+'","'+market+'","0.00","'+market+'","1.00","1.00","United States","-","USD"\n';
const csv=header +
  equity("MSFT","MICROSOFT","400.00")+
  equity("NVDA","NVIDIA","200.00")+
  equity("AAPL","APPLE","100.00")+
  equity("AMZN","AMAZON","50.00")+
  equity("META","META PLATFORMS","50.00")+
  equity("GOOG","ALPHABET CLASS C","40.00")+
  equity("GOOGL","ALPHABET CLASS A","40.00")+
  equity("AMD","ADVANCED MICRO DEVICES","20.00")+
  equity("ORCL","ORACLE","20.00")+
  equity("TSLA","TESLA","20.00")+
  other("USD","USD CASH","40.00")+
  other("EUR","EUR/USD","-0.01","FX");

const holder=(id,symbol,kind,valueCzk,isin)=>({
  id,symbol,name:symbol,assetClass:kind,isin:isin??null,canonicalKey:null,
  valueCzk,quantity:1,accountName:"Invest",provider:"trading212"
});

test("fund selection is ISIN-only and cannot collide across trading venues",()=>{
  assert.equal(issuerFeedForIsin("ie00b5bmr087")?.productId,"253743");
  assert.equal(issuerFeedForIsin("IE00B4L5Y983")?.productId,"251882");
  assert.equal(issuerFeedForIsin("IE00B6R52259")?.productId,"251850");
  assert.equal(issuerFeedForIsin("IE00BKM4GZ66")?.productId,"264659");
  assert.equal(issuerFeedForIsin("IE00BF4RFH31")?.productId,"296576");
  assert.equal(issuerFeedForIsin("IE00B2QWCY14")?.productId,"251920");
  assert.equal(issuerFeedForIsin("IE00BZCQB185")?.productId,"297617");
  assert.equal(issuerFeedForIsin("IE000I8KRLL9")?.productId,"319084");
  assert.equal(issuerFeedForIsin("IE00B1XNHC34")?.productId,"251911");
  assert.equal(issuerFeedForIsin("IE00B53SZB19")?.productId,"253741");
  assert.equal(issuerFeedForIsin("ie00bf4rfh31")?.isin,"IE00BF4RFH31");
  assert.equal(issuerFeedForIsin("IE00BK5BQT80"),null);
  assert.equal(issuerFeedForIsin(""),null);
});

test("iShares official CSV uses precise market value instead of rounded 0.00% weights",()=>{
  const rows=parseIsharesHoldingsCsv(csv,feed,"SXR8");
  const msft=rows.find(r=>r.securitySymbol==="MSFT");
  const cash=rows.find(r=>r.securitySymbol.startsWith("OTHER-"));
  assert.equal(rows.length,11);
  assert.equal(rows[0].asOf,"2026-10-13");
  assert.equal(rows[0].fundIsin,feed.isin);
  assert.ok(msft.weightPct>39 && msft.weightPct<41);
  assert.equal(cash.kind,"other");
  assert.ok(Math.abs(rows.reduce((n,r)=>n+r.weightPct,0)-100)<1e-7);
  const portfolio=calculateXRay([
    holder("etf","SXR8","etf",1000,feed.isin),
    holder("stock","MSFT","stock",300,"US5949181045"),
  ],rows);
  assert.equal(portfolio.denominatorCzk,1300);
  assert.ok(portfolio.mappedCzk<1300);
  assert.ok(portfolio.mappedCzk>1250);
  assert.ok(Math.abs(portfolio.mappedCzk+portfolio.unallocatedCzk-1300)<1e-6);
  assert.ok(portfolio.exposures.find(e=>e.ticker==="MSFT").viaFundsCzk>390);
});

test("issuer reader keeps distinct equity identities when same ticker has different companies",()=>{
  const rewritten=csv.replace(equity("ORCL","ORACLE","20.00"),
    equity("SAP","SAP SE","10.00","Xetra","Germany")+
    equity("SAP","SAPUTO","10.00","Toronto Stock Exchange","Canada"));
  const rows=parseIsharesHoldingsCsv(rewritten,feed,"SXR8");
  const sap=rows.filter(r=>r.securitySymbol.startsWith("SAP@"));
  assert.equal(sap.length,2);
  assert.notEqual(sap[0].securitySymbol,sap[1].securitySymbol);
});

test("real EM IMI feed can distinguish unrelated equity rows with issuer ticker '-'",()=>{
  const altered=csv.replace(equity("ORCL","ORACLE","20.00"),
    equity("-","HEG LTD","10.00","National Stock Exchange Of India","India")+
    equity("-","IGL SPIRITS LTD","10.00","National Stock Exchange Of India","India"));
  const r=parseIsharesHoldingsCsv(altered,ISHARES_FEEDS[3],"EIMI");
  const unnamed=r.filter(x=>x.securitySymbol.startsWith("-@"));
  assert.equal(unnamed.length,2);
  assert.notEqual(unnamed[0].securitySymbol,unnamed[1].securitySymbol);
  assert.ok(unnamed.every(x=>x.securityIsin===null));
  assert.ok(Math.abs(r.reduce((n,x)=>n+x.weightPct,0)-100)<1e-7);
});

test("invalid issuer feed, dates, unexpected row and negatives fail closed",()=>{
  assert.throws(()=>parseIsharesHoldingsCsv("<html>no data</html>",feed,"SXR8"),/Neplatný/);
  assert.throws(()=>parseIsharesHoldingsCsv(csv.replace("13/Oct/2026","31/Feb/2026"),feed,"SXR8"),/datum/);
  assert.throws(()=>parseIsharesHoldingsCsv(csv+"TICKER,EXTRA\n",feed,"SXR8"),/Neznámý/);
  assert.throws(()=>parseIsharesHoldingsCsv(csv.replace('-0.01','-50.00'),feed,"SXR8"),/významné záporné/);
});

test("the verified public issuer endpoint is read with no Trading 212 credentials",async()=>{
  let called;
  const stub=async(url,init)=>{
    called={url,init};
    return new Response(csv,{status:200,headers:{"content-type":"text/plain"}});
  };
  const result=await fetchIsharesHoldings(feed,"SXR8",true,stub);
  assert.equal(result.rows.length,11);
  assert.equal(called.url,feed.url);
  assert.equal(called.init.headers.Authorization,undefined);
  assert.equal(result.cached,false);
  const again=await fetchIsharesHoldings(feed,"CSPX",false,async()=>{throw Error("should be cached")});
  assert.equal(again.cached,true);
  assert.equal(again.rows[0].fundSymbol,"CSPX");
  await assert.rejects(fetchIsharesHoldings({...feed,isin:"IE00AAAAAAA0"},"X",true,stub),/Neautorizovaný/);
});

test("complete automatic snapshot wins over single-row newer manual; other funds remain intact",()=>{
  const official=parseIsharesHoldingsCsv(csv,feed,"SXR8");
  const older=[{...official[0],source:"manual-old",asOf:"2026-10-01",weightPct:3}];
  const newer=[{...official[0],source:"manual-new",asOf:"2026-10-14",weightPct:4}];
  const another=[{...official[0],fundIsin:"IE00ZZZZZZZ1",fundSymbol:"OTHER",asOf:"2026-10-10",source:"manual-other"}];
  const first=combineConstituentSources([...older,...another],official);
  assert.equal(first.filter(r=>r.fundIsin===feed.isin).length,official.length);
  assert.equal(first.filter(r=>r.fundSymbol==="OTHER").length,1);
  const second=combineConstituentSources([...newer,...another],official);
  assert.equal(second.filter(r=>r.fundIsin===feed.isin).length,official.length);
  assert.ok(second.filter(r=>r.fundIsin===feed.isin).every(r=>r.source===official[0].source));
  assert.equal(second.filter(r=>r.fundSymbol==="OTHER").length,1);
});

test("route remains local-only and X-Ray triggers automatic refresh",()=>{
  const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const route=read("app/api/xray/auto/route.ts");
  assert.ok(route.includes("localOnly(request)"));
  assert.ok(route.includes("getXRayHoldings()"));
  assert.ok(route.includes("fetchIsharesHoldings("));
  const ui=read("components/portfolio-xray.tsx");
  assert.ok(ui.includes("<XRayAutoSync onUpdate={setAutomaticRows}"));
  assert.ok(ui.includes("combineConstituentSources"));
  const sync=read("components/xray-auto-sync.tsx");
  assert.ok(sync.includes('fetch("/api/xray/auto"'));
  assert.ok(sync.includes("refresh(Boolean(refreshSignal?.force),controller.signal)"));
});


test("all expanded iShares feeds are fixed, unique, official issuer URLs",()=>{
  assert.equal(ISHARES_FEEDS.length,10);
  assert.equal(new Set(ISHARES_FEEDS.map(f=>f.isin)).size,10);
  assert.equal(new Set(ISHARES_FEEDS.map(f=>f.productId)).size,10);
  for(const feed of ISHARES_FEEDS){
    assert.equal(new URL(feed.url).hostname,"www.ishares.com");
    assert.ok(feed.url.includes("/products/"+feed.productId+"/"));
    assert.ok(feed.url.endsWith("/latest-holdings.csv"));
    assert.ok(/^IE[0-9A-Z]{10}$/.test(feed.isin));
  }
});

test("extra Type column in real IUS3 feed does not shift asset class or market value",()=>{
  const withType=csv.split("\n").map((line,i)=>{
    if(i===1)return line.replace("Ticker,Name,Sector,","Ticker,Name,Type,Sector,");
    if(i<2||!line.startsWith('"'))return line;
    const secondQuoteEnd=line.indexOf('","',line.indexOf('","')+3);
    if(secondQuoteEnd<0)throw new Error("Invalid synthetic issuer fixture");
    return line.slice(0,secondQuoteEnd+2) + '"'+
      (line.includes('"Cash and/or Derivatives"')?"CASH":"EQUITY")+
      '",' + line.slice(secondQuoteEnd+2);
  }).join("\n");
  const smallcap=ISHARES_FEEDS.find(f=>f.isin==="IE00B2QWCY14");
  assert.ok(smallcap);
  const result=parseIsharesHoldingsCsv(withType,smallcap,"IUS3");
  assert.equal(result.length,11);
  assert.equal(result.find(r=>r.securitySymbol==="MSFT")?.kind,"stock");
  assert.ok(result.find(r=>r.securitySymbol==="MSFT")?.weightPct>39);
  assert.equal(result.find(r=>r.securitySymbol.startsWith("OTHER-"))?.kind,"other");
});

test("different issuer ISINs never share snapshots even if listings use the same symbol",()=>{
  const wsml=ISHARES_FEEDS.find(f=>f.isin==="IE00BF4RFH31");
  const india=ISHARES_FEEDS.find(f=>f.isin==="IE00BZCQB185");
  assert.ok(wsml&&india);
  const a=parseIsharesHoldingsCsv(csv,wsml,"DUP");
  const b=parseIsharesHoldingsCsv(csv,india,"DUP");
  const merged=calculateXRay([
    holder("world","DUP","etf",2872,wsml.isin),
    holder("india","DUP","etf",68,india.isin),
  ],[...a,...b]);
  assert.equal(merged.funds.length,2);
  assert.equal(merged.funds[0].isin,wsml.isin);
  assert.equal(merged.funds[1].isin,india.isin);
  assert.ok(Math.abs(merged.mappedCzk+merged.unallocatedCzk-2940)<1e-6);
  assert.equal(merged.exposures.some(x=>x.directCzk>0),false);
});


test("new SEMI and INRG funds use genuine issuer holdings and preserve unknown residual",()=>{
  const semi=issuerFeedForIsin("IE000I8KRLL9");
  const inrg=issuerFeedForIsin("IE00B1XNHC34");
  assert.ok(semi&&inrg);
  const holdings=[
    holder("semis","SEMI","etf",507,semi.isin),
    holder("energy","INRG","etf",210,inrg.isin),
  ];
  const parsed=[
    ...parseIsharesHoldingsCsv(csv,semi,"SEMI"),
    ...parseIsharesHoldingsCsv(csv,inrg,"INRG"),
  ];
  const result=calculateXRay(holdings,parsed);
  assert.equal(result.denominatorCzk,717);
  assert.equal(result.funds.length,2);
  assert.equal(result.funds.find(f=>f.isin===semi.isin)?.source?.includes("319084"),true);
  assert.equal(result.funds.find(f=>f.isin===inrg.isin)?.source?.includes("251911"),true);
  assert.ok(Math.abs(result.mappedCzk+result.unallocatedCzk-717)<1e-6);
  assert.ok(result.mappedCzk<717);
  assert.ok(result.unallocatedCzk>0);
});

test("failed new issuer request leaves source data untouched and never sends broker key",async()=>{
  const newFund=issuerFeedForIsin("IE000I8KRLL9");
  assert.ok(newFund);
  await assert.rejects(
    fetchIsharesHoldings(newFund,"SEMI",true,async(url,init)=>{
      assert.equal(url,newFund.url);
      assert.equal(init.headers.Authorization,undefined);
      return new Response("<html>blocked</html>",{status:200});
    }),/Neplatný/,
  );
});
