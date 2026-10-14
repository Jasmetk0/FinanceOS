import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { parseXlsxGrid } from "../lib/xray/xlsx-grid.ts";
import { SPYI_ISIN, SPYI_OFFICIAL_URL, parseSpyiXlsx, fetchSpyiHoldings } from "../lib/xray/auto-spyi.ts";
import { calculateXRay } from "../lib/xray/engine.ts";

function xlsx(entries) {
  const locals=[],central=[];
  let position=0;
  for(const [filename,xml] of Object.entries(entries)){
    const name=Buffer.from(filename);
    const bytes=Buffer.from(xml);
    const compressed=deflateRawSync(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);
    local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    locals.push(local,name,compressed);
    const directory=Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(8,10);
    directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(bytes.length,24);
    directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(position,42);
    central.push(directory,name);
    position+=local.length+name.length+compressed.length;
  }
  const center=Buffer.concat(central);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(Object.keys(entries).length,8);
  end.writeUInt16LE(Object.keys(entries).length,10);
  end.writeUInt32LE(center.length,12);end.writeUInt32LE(position,16);
  return Buffer.concat([...locals,center,end]);
}
function xmlCell(value,col,row,numeric=false){
  const attr=numeric?'':' t="inlineStr"';
  const body=numeric?'<v>'+value+'</v>':'<is><t>'+value+'</t></is>';
  return '<c r="'+col+row+'"'+attr+'>'+body+'</c>';
}
function fixture({badDate=false,missingHeader=false,badWeight=false,addCash=true,shared=false}={}){
  const rows=[];
  rows.push([ "Holdings as of",badDate?"31 Feb 2026":"13 Oct 2026" ]);
  rows.push(["SPDR MSCI ACWI IMI UCITS ETF"]);
  rows.push(["Official daily holdings"]);
  rows.push(["ISIN","SEDOL","Security Name","Currency","Number of Shares","Percent of Fund","Trade Country Name","Local Price","Sector Classification","Industry Classification","Base Market Value"]);
  for(let i=0;i<12;i++){
    const isin='US'+String(i+1).padStart(10,'0');
    rows.push([isin,"","Company "+i,"USD","10",badWeight&&i===0?"-5":"8","United States","100","Information Technology","Software","1000"]);
  }
  if(addCash)rows.push(["","","Cash EUR","EUR","100","4","Ireland","1","Cash","","4"]);
  const col=n=>String.fromCharCode(65+n);
  const source=rows.map((fields,index)=>{
    const n=index+1;
    return '<row r="'+n+'">'+fields.map((value,j)=>xmlCell(
      missingHeader && index===3 && j===5?"MISNAMED":value,col(j),n,index>3&&[4,5,7,10].includes(j)
    )).join('')+'</row>';
  }).join('');
  const xml='<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+source+'</sheetData></worksheet>';
  return xlsx({"xl/worksheets/sheet1.xml":xml,...(shared?{"xl/sharedStrings.xml":'<sst><si><t>Unused</t></si></sst>'}:{})});
}
const holding=(id,symbol,assetClass,valueCzk,isin=null)=>({id,symbol,name:symbol,assetClass,quantity:1,
  valueCzk,isin,canonicalKey:null,provider:"trading212",accountName:"Invest"});

test("XLSX spreadsheet XML reader decompresses and preserves safe numeric/text cells",()=>{
  const rows=parseXlsxGrid(fixture());
  assert.equal(rows[0][0],"Holdings as of");
  assert.equal(rows[3][5],"Percent of Fund");
  assert.equal(rows[4][0],"US0000000001");
  assert.equal(rows[4][5],"8");
  assert.equal(rows.length,17);
});

test("SPYI XLSX ISIN weights produce exact X-Ray allocation and direct holdings merge",()=>{
  const rows=parseSpyiXlsx(fixture(),"SPYI");
  assert.equal(rows.length,13);
  assert.equal(rows[0].fundIsin,SPYI_ISIN);
  assert.equal(rows[0].asOf,"2026-10-13");
  assert.equal(rows[0].securityIsin,"US0000000001");
  assert.ok(Math.abs(rows.reduce((acc,r)=>acc+r.weightPct,0)-100)<1e-8);
  assert.equal(rows[12].kind,"other");
  const r=calculateXRay([
    holding("fund","SPYI","etf",1000,SPYI_ISIN),
    holding("share","Company","stock",100,"US0000000001"),
  ],rows);
  assert.equal(r.denominatorCzk,1100);
  assert.equal(r.exposures.find(x=>x.key.includes("US0000000001")).totalCzk,180);
  assert.equal(r.unallocatedCzk,40);
  assert.equal(r.mappedCzk,1060);
});

test("SPYI reader fails closed on invalid source instead of inventing ETF constituents",()=>{
  assert.throws(()=>parseSpyiXlsx(fixture({badDate:true}),"SPYI"),/datum/);
  assert.throws(()=>parseSpyiXlsx(fixture({missingHeader:true}),"SPYI"),/nepodporovanou/);
  assert.throws(()=>parseSpyiXlsx(fixture({badWeight:true}),"SPYI"),/záporné/);
  assert.throws(()=>parseSpyiXlsx(fixture({addCash:false}),"SPYI"),/neúplné|neúplný|jednotky/);
  assert.throws(()=>parseXlsxGrid(Buffer.from("not a ZIP")),/XLSX/);
});

test("automated SPYI issuer fetch uses exact discovered official URL, no broker credentials and caches by ISIN",async()=>{
  let called;
  const stub=async(url,init)=>{
    called={url,init};
    return new Response(fixture(),{status:200,headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}});
  };
  const one=await fetchSpyiHoldings("SPYI",true,stub);
  assert.equal(one.rows.length,13);
  assert.equal(called.url,SPYI_OFFICIAL_URL);
  assert.equal(called.init.headers.Authorization,undefined);
  assert.equal(one.cached,false);
  const next=await fetchSpyiHoldings("IMIE",false,async()=>{throw Error("Unexpected network")});
  assert.equal(next.cached,true);
  assert.equal(next.rows[0].fundSymbol,"IMIE");
});

test("endpoint automatically matches SPYI by exact ISIN and keeps other holdings working",()=>{
  const code=readFileSync(new URL("../app/api/xray/auto/route.ts",import.meta.url),"utf8");
  assert.ok(code.includes("isin === SPYI_ISIN"));
  assert.ok(code.includes("fetchSpyiHoldings(f.symbol,force)"));
  assert.ok(code.includes("issuerFeedForIsin(isin)"));
  assert.ok(!code.includes("apiSecret"));
});
