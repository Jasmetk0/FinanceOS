import test from "node:test";
import assert from "node:assert/strict";
import {deflateRawSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {
  INVESCO_ARCHIVE_FEEDS,invescoArchiveForIsin,parseInvescoArchiveAsOf,
  parseInvescoArchiveXlsx,fetchInvescoArchiveHoldings,
} from "../lib/xray/auto-invesco.ts";
import {calculateXRay} from "../lib/xray/engine.ts";

function zip(entries) {
  const local=[],central=[];let start=0;
  for(const [filename,xml] of Object.entries(entries)){
    const name=Buffer.from(filename),data=Buffer.from(xml),compressed=deflateRawSync(data);
    const first=Buffer.alloc(30);
    first.writeUInt32LE(0x04034b50,0);first.writeUInt16LE(8,8);
    first.writeUInt32LE(compressed.length,18);first.writeUInt32LE(data.length,22);first.writeUInt16LE(name.length,26);
    local.push(first,name,compressed);
    const index=Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(8,10);
    index.writeUInt32LE(compressed.length,20);index.writeUInt32LE(data.length,24);
    index.writeUInt16LE(name.length,28);index.writeUInt32LE(start,42);
    central.push(index,name);start+=first.length+name.length+compressed.length;
  }
  const center=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);
  end.writeUInt16LE(Object.keys(entries).length,10);
  end.writeUInt32LE(center.length,12);end.writeUInt32LE(start,16);
  return Buffer.concat([...local,center,end]);
}
const xmlSafe=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
function workbook({count=101,wrongHeader=false,badWeight=false,unknown=false}={}){
  const rows=[["Name","ISIN","Ticker","Type","Sector","Country","Currency",
    wrongHeader?"Weight ratio":"Weight %","Market value"]];
  for(let i=0;i<count;i++){
    rows.push([i===0?"MICROSOFT CORP":"Company "+i,
      i===0?"US5949181045":"US"+String(i+1).padStart(10,"0"),"","","","","USD",
      badWeight&&i===0?"-15":count===101?"0.98":"1",""]);
  }
  if(unknown)rows.push(["UNIDENTIFIED","", "", "", "", "", "USD", "0.03", ""]);
  else rows.push(["Cash and/or Derivatives","","","","","","USD","1.00",""]);
  const xml=rows.map((row,index)=>{
    const n=index+1;
    const cells=row.map((value,j)=>{
      const col=String.fromCharCode(65+j);
      return '<c r="'+col+n+'" t="inlineStr"><is><t>'+xmlSafe(value)+'</t></is></c>';
    }).join("");
    return '<row r="'+n+'">'+cells+'</row>';
  }).join("");
  return zip({"xl/worksheets/sheet1.xml":'<worksheet><sheetData>'+xml+'</sheetData></worksheet>'});
}
const [dist,acc]=INVESCO_ARCHIVE_FEEDS;
const html=isin=>'<html><head>Etf '+isin+'</head><div>Holdings as published by Invesco, holdings as at 1 October 2026: 102 rows archived by Rebalix.</div></html>';
const holding=(id,symbol,isin,valueCzk)=>({
 id,symbol,name:symbol,assetClass:"etf",isin,canonicalKey:null,
 valueCzk,quantity:1,provider:"trading212",accountName:"Invest"
});

test("EQQQ and EQAC are different allowlisted fund ISINs and the source is explicitly third-party",()=>{
  assert.equal(INVESCO_ARCHIVE_FEEDS.length,2);
  assert.equal(dist.isin,"IE0032077012");
  assert.equal(acc.isin,"IE00BFZXGZ54");
  assert.notEqual(dist.url,acc.url);
  for(const feed of INVESCO_ARCHIVE_FEEDS){
    assert.equal(new URL(feed.url).hostname,"rebalix.com");
    assert.equal(new URL(feed.pageUrl).hostname,"rebalix.com");
    assert.equal(new URL(feed.url).searchParams.get("isin"),feed.isin);
    assert.equal(invescoArchiveForIsin(feed.isin.toLowerCase())?.url,feed.url);
  }
  assert.equal(invescoArchiveForIsin("LYMS"),null);
});

test("archive dates are read from the exact fund's holdings statement rather than fetchedAt",()=>{
  const now=Date.parse("2026-10-15T12:00:00Z");
  assert.equal(parseInvescoArchiveAsOf(html(dist.isin),dist.isin,now),"2026-10-01");
  assert.throws(()=>parseInvescoArchiveAsOf(html(dist.isin),acc.isin,now),/ISIN/);
  assert.throws(()=>parseInvescoArchiveAsOf(html(dist.isin).replace("1 October","32 October"),dist.isin,now),/datum/);
  assert.throws(()=>parseInvescoArchiveAsOf(html(dist.isin).replace("2026","2027"),dist.isin,now),/ISIN|datum/);
  assert.throws(()=>parseInvescoArchiveAsOf('<p>'+dist.isin+'</p>Today 2026-10-15',dist.isin,now),/datum/);
});

test("public full XLSX yields stable ISIN identities, other cash and no fabricated ticker",()=>{
  const rows=parseInvescoArchiveXlsx(workbook(),dist,"EQQQ","2026-10-01");
  assert.equal(rows.length,102);
  assert.equal(rows.filter(r=>r.kind==="stock").length,101);
  assert.equal(rows.filter(r=>r.kind==="other").length,1);
  assert.equal(rows[0].securitySymbol,"US5949181045");
  assert.equal(rows[0].securityIsin,"US5949181045");
  assert.equal(rows[0].asOf,"2026-10-01");
  assert.ok(rows.every(r=>r.source.includes("Rebalix archiv")));
  assert.equal(rows.reduce((sum,r)=>sum+r.weightPct,0).toFixed(2),"99.98");
});

test("full EQQQ and EQAC holdings merge same underlying stock only on verified security ISIN",()=>{
  const a=parseInvescoArchiveXlsx(workbook(),dist,"EQQQ","2026-10-01");
  const b=parseInvescoArchiveXlsx(workbook(),acc,"EQAC","2026-10-01");
  const r=calculateXRay([
    holding("eqqq1","EQQQ",dist.isin,6601),
    holding("eqqq2","EQQQ",dist.isin,666),
    holding("eqac","EQAC",acc.isin,6804),
  ],[...a,...b]);
  assert.equal(r.denominatorCzk,14071);
  assert.equal(r.funds.length,2);
  assert.ok(r.mappedCzk>0);
  assert.equal(r.identityCoverage.cryptoCzk,0);
  assert.ok(Math.abs(r.mappedCzk+r.unallocatedCzk-14071)<1e-7);
  assert.equal(r.exposures.find(e=>e.key==="stock|isin:US5949181045").fundContributions.length,2);
  assert.equal(r.funds.find(f=>f.isin===dist.isin).valueCzk,7267);
  assert.equal(r.funds.find(f=>f.isin===acc.isin).valueCzk,6804);
});

test("unsafe archive structure, weights and incomplete holdings fail closed",()=>{
  for(const opts of [{count:10},{wrongHeader:true},{badWeight:true},{unknown:true}]){
    assert.throws(()=>parseInvescoArchiveXlsx(workbook(opts),dist,"EQQQ","2026-10-01"),/Invesco|archiv|podklad/);
  }
  assert.throws(()=>parseInvescoArchiveXlsx(workbook(),{...dist,url:"https://evil.test"},"EQQQ","2026-10-01"),/Neověřený/);
  assert.throws(()=>parseInvescoArchiveXlsx(Buffer.from("not-xlsx"),dist,"EQQQ","2026-10-01"),/XLSX/);
});

test("fetch has two fixed public links, date and Excel validation, no broker key; caches per exact ISIN",async()=>{
  const called=[];
  const stub=async(url,init)=>{
    called.push({url,init});
    if(url===dist.pageUrl)return new Response(html(dist.isin),{status:200});
    if(url===dist.url)return new Response(workbook(),{status:200,headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}});
    throw Error("Unexpected URL");
  };
  const first=await fetchInvescoArchiveHoldings(dist,"EQQQ",true,stub);
  assert.equal(first.rows.length,102);
  assert.equal(first.rows[0].asOf,"2026-10-01");
  assert.equal(first.sourceUrl,dist.url);
  assert.ok(called.every(x=>!x.init.headers.Authorization));
  assert.deepEqual(new Set(called.map(x=>x.url)),new Set([dist.pageUrl,dist.url]));
  const second=await fetchInvescoArchiveHoldings(dist,"EQQD",false,async()=>{throw Error("Network should be cached");});
  assert.equal(second.cached,true);
  assert.equal(second.rows[0].fundSymbol,"EQQD");
  assert.equal(second.rows[0].fundIsin,dist.isin);
});

test("diagnostic UI has no six-source hard-coded guard; archive link is not called official",()=>{
  const ui=readFileSync(new URL("../components/xray-issuer-diagnostics.tsx",import.meta.url),"utf8");
  const sync=readFileSync(new URL("../components/xray-auto-sync.tsx",import.meta.url),"utf8");
  const route=readFileSync(new URL("../app/api/xray/auto/route.ts",import.meta.url),"utf8");
  assert.ok(!ui.includes("result.sources.length!==6"));
  assert.ok(!ui.includes("všech 6 zdrojů"));
  assert.ok(ui.includes("result.healthy+result.limited+result.failed!==result.sources.length"));
  assert.ok(sync.includes("Veřejný archiv · NE přímý zdroj emitenta"));
  assert.ok(route.includes("fetchInvescoArchiveHoldings"));
});
