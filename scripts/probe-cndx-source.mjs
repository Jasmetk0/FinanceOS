import {issuerFeedForIsin,fetchIsharesHoldings} from "../lib/xray/auto-ishares.ts";
import {cndxAsLymsProxy,CNDX_ISIN} from "../lib/xray/auto-lyms-proxy.ts";
const feed=issuerFeedForIsin(CNDX_ISIN);
if(!feed)throw Error("CNDX missing allowlist");
const result=await fetchIsharesHoldings(feed,"CNDX",true);
const rows=cndxAsLymsProxy(result.rows,"LYMS");
console.log(JSON.stringify({feed:feed.url,rows:result.rows.length,asOf:rows[0].asOf,
  positiveStocks:rows.length,estimatedStockPct:rows.reduce((s,r)=>s+r.weightPct,0),
  kind:rows[0].exposureBasis,cached:result.cached}));
