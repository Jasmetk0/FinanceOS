/**
 * Schema-only troubleshooting for PUBLIC ETF issuer holdings.
 * Truncates output, excludes individual issuer security positions from logs.
 * No broker or user data are accessed.
 */
import { ISHARES_FEEDS } from "../lib/xray/auto-ishares.ts";
import { parseDelimited } from "../lib/xray/import.ts";
import { SPYI_OFFICIAL_URL } from "../lib/xray/auto-spyi.ts";
import { parseXlsxGrid } from "../lib/xray/xlsx-grid.ts";
import { fetchVwceHoldings } from "../lib/xray/auto-vanguard.ts";

const MAX_BYTES=16*1024*1024;
const debug=async(name,action)=>{
  try {console.log("=== "+name+" ===");await action();}
  catch(e){console.log("ERROR "+(e instanceof Error?e.message:String(e)).slice(0,260));}
};
await debug("EIMI public CSV schema",async()=>{
  const url=ISHARES_FEEDS.find(x=>x.isin==="IE00BKM4GZ66")?.url;
  if(!url)throw Error("EIMI not allowlisted");
  const response=await fetch(url,{signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error("HTTP "+response.status);
  const raw=await response.text();
  if(raw.length>MAX_BYTES)throw Error("response too big");
  const rows=parseDelimited(raw,",");
  const headers=rows[1].map(x=>x.trim().toLowerCase());
  const ticker=headers.indexOf("ticker"),exchange=headers.indexOf("exchange"),
    name=headers.indexOf("name"),classCol=headers.indexOf("asset class");
  console.log({totalRows:rows.length,metadata:rows[0],headers:rows[1]});
  const same=rows.slice(2).filter(x=>(x[ticker]??"").trim()==="-")
    .map(x=>({ticker:x[ticker],name:(x[name]??"").slice(0,70),
      exchange:x[exchange],kind:x[classCol]}));
  console.log({placeholderTickerCount:same.length,examples:same.slice(0,8)});
});
await debug("SPDR official XLSX schema",async()=>{
  const response=await fetch(SPYI_OFFICIAL_URL,{signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error("HTTP "+response.status);
  const buf=new Uint8Array(await response.arrayBuffer());
  if(buf.length>MAX_BYTES)throw Error("response too big");
  const rows=parseXlsxGrid(buf);
  console.log({xlsxBytes:buf.length,rowCount:rows.length,
    first15Rows:rows.slice(0,15).map((r,i)=>({row:i+1,columns:r.slice(0,12).map(x=>x.slice(0,80))}))});
});
await debug("Vanguard real GPX page shapes",async()=>{
  let pages=0;
  const wrapper=async(url,options)=>{
    const response=await fetch(url,options);
    const raw=await response.clone().json();
    const d=raw?.data||{};
    const items=d?.borHoldings?.[0]?.holdings;
    pages++;
    console.log({page:pages,status:response.status,graphqlErrors:raw?.errors?.map(x=>x.message?.slice(0,100)),
      rootFields:Object.keys(d),fundName:d?.funds?.[0]?.profile?.fundFullName,
      totalHoldings:items?.totalHoldings,pageItems:items?.items?.length,
      cursor:Boolean(items?.lastItemKey),
      firstRowKeys:items?.items?.[0]?Object.keys(items.items[0]):[]});
    return response;
  };
  await fetchVwceHoldings("VWCE",true,wrapper);
});
