/** One-time public feed shape probe for X-Ray source investigation; NO broker data. */
import {parseXlsxGrid} from "../lib/xray/xlsx-grid.ts";
const funds=["IE0032077012","IE00BFZXGZ54"];
for (const isin of funds) {
  const url="https://rebalix.com/api/etf/composizione?isin="+isin+"&lang=en";
  try {
    const response=await fetch(url,{headers:{"Accept":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},signal:AbortSignal.timeout(15_000)});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const grid=parseXlsxGrid(bytes);
    console.log(JSON.stringify({isin,status:response.status,url:response.url,bytes:bytes.length,
      sheetRows:grid.length,first:grid.slice(0,9).map(row=>row.slice(0,13)),
      last:grid.slice(-2).map(row=>row.slice(0,8))}));
  } catch(error){
    console.log(JSON.stringify({isin,error:error instanceof Error?error.message:String(error)}));
  }
}
