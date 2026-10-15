// Read-only schema proof on exact allowlisted iShares files; no user data.
import {ISHARES_FEEDS} from "../lib/xray/auto-ishares.ts";
import {parseDelimited} from "../lib/xray/import.ts";
for (const isin of ["IE00B5BMR087","IE00BF4RFH31","IE00B53SZB19"]){
  const feed=ISHARES_FEEDS.find(f=>f.isin===isin);
  if(!feed)throw Error("No feed "+isin);
  try{
    const response=await fetch(feed.url,{headers:{"Accept":"text/csv,text/plain;q=0.9","User-Agent":"FinanceOS-Portfolio-XRay/1.0"},signal:AbortSignal.timeout(20000)});
    const body=await response.text();
    const lines=parseDelimited(body.replace(/^\uFEFF/,""),",");
    const head=lines[1]||[];
    const idxIsin=head.findIndex(x=>x.trim().toLowerCase()==="isin");
    const idxSedol=head.findIndex(x=>x.trim().toLowerCase()==="sedol");
    console.log("ISHARES_FULL_CSV_COLUMNS "+JSON.stringify({isin,status:response.status,bytes:body.length,
      count:lines.length,header:head,idxIsin,idxSedol,
      asOf:lines[0],examples:lines.slice(2,5).map(row=>({ticker:row[0],
        isin:idxIsin>=0?row[idxIsin]:null,sedol:idxSedol>=0?row[idxSedol]:null}))}));
  }catch(error){
    console.log("ISHARES_PROBE_ERROR "+JSON.stringify({isin,error:String(error)}));
  }
}
