/** One-time public feed shape probe for X-Ray source investigation; NO broker data. */
import {parseXlsxGrid} from "../lib/xray/xlsx-grid.ts";
import {parseInvescoArchiveXlsx,parseInvescoArchiveAsOf,invescoArchiveForIsin} from "../lib/xray/auto-invesco.ts";
const funds=["IE0032077012","IE00BFZXGZ54"];
for (const isin of funds) {
  const url="https://rebalix.com/api/etf/composizione?isin="+isin+"&lang=en";
  try {
    const response=await fetch(url,{headers:{"Accept":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},signal:AbortSignal.timeout(15_000)});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const grid=parseXlsxGrid(bytes);
    const page=await fetch("https://rebalix.com/en/etf/"+isin,{signal:AbortSignal.timeout(15_000)});
    const html=await page.text();
    const needle=["Holdings as published by Invesco","holdings as at","Full portfolio declared by Invesco","1 October 2026"];
    console.log(JSON.stringify({isin,pageStatus:page.status,htmlBytes:html.length,
      snippets:needle.map(v=>({term:v,index:html.indexOf(v),around:html.indexOf(v)>=0?
        html.slice(Math.max(0,html.indexOf(v)-150),html.indexOf(v)+270):null}))}));
    const dated=parseInvescoArchiveAsOf(html,isin);
    const parsed=parseInvescoArchiveXlsx(bytes,invescoArchiveForIsin(isin),isin==="IE0032077012"?"EQQQ":"EQAC",dated);
    console.log(JSON.stringify({isin,date:dated,parsedRows:parsed.length,
      stocks:parsed.filter(r=>r.kind==="stock").length,
      cash:parsed.filter(r=>r.kind==="other").length,
      totalWeight:parsed.reduce((a,r)=>a+r.weightPct,0)}));
    console.log(JSON.stringify({isin,status:response.status,url:response.url,bytes:bytes.length,
      sheetRows:grid.length,first:grid.slice(0,9).map(row=>row.slice(0,13)),
      last:grid.slice(-2).map(row=>row.slice(0,8))}));
  } catch(error){
    console.log(JSON.stringify({isin,error:error instanceof Error?error.message:String(error)}));
  }
}
