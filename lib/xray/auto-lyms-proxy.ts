/**
 * LYMS economic exposure can be approximated from iShares CNDX's PUBLIC,
 * independently held Nasdaq-100 portfolio. It is not Nasdaq XNDXNNR
 * benchmark weights and not Amundi's physical substitute swap basket.
 *
 * The difference is always visible on every constituent and in X-Ray.
 * This estimate fails closed on missing/stale/partial CNDX holdings.
 */
import { issuerFeedForIsin, fetchIsharesHoldings } from "./auto-ishares.ts";
import { validateXRayConstituents, type XRayConstituent } from "./engine.ts";

export const LYMS_ISIN = "LU1829221024";
export const CNDX_ISIN = "IE00B53SZB19";
export const CNDX_PROXY_URL =
  "https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf/latest-holdings.csv";

type FetchIshares = typeof fetchIsharesHoldings;

/**
 * The published stock basket is similar, but not identical to index weights;
 * leave CNDX cash/derivatives as an unallocated LYMS residual.
 */
export function cndxAsLymsProxy(rows:XRayConstituent[],lymsSymbol:string,nowMs=Date.now()):XRayConstituent[]{
  if(!lymsSymbol.trim())throw new RangeError("Chybí obchodní symbol syntetického LYMS.");
  validateXRayConstituents(rows);
  if(rows.length<90||rows.some(r=>r.fundIsin!==CNDX_ISIN || r.exposureBasis==="reference-index" ||
    r.exposureBasis==="reference-index-proxy" || r.exposureBasis==="substitute-basket"))
    throw new RangeError("iShares CNDX neposkytl platný, jednoznačný seznam skutečných podkladů.");
  const dates=[...new Set(rows.map(r=>r.asOf))];
  if(dates.length!==1||!/^\d{4}-\d{2}-\d{2}$/.test(dates[0]))
    throw new RangeError("CNDX nemá jednotné datum podkladů.");
  const timestamp=Date.parse(dates[0]+"T00:00:00Z");
  const ageDays=(nowMs-timestamp)/86_400_000;
  if(!Number.isFinite(ageDays)||ageDays< -1||ageDays>14)
    throw new RangeError("CNDX proxy snapshot je starší než 14 dní nebo má datum v budoucnosti.");
  const equity=rows.filter(r=>r.kind==="stock" && r.weightPct>0);
  const sum=equity.reduce((a,b)=>a+b.weightPct,0);
  if(equity.length<90||sum<98||sum>100.000001)
    throw new RangeError("CNDX nemá úplné akciové podklady pro přibližný model LYMS (min. 90 pozic, 98 %).");
  const transformed=equity.map(r=>({
    ...r,fundIsin:LYMS_ISIN,fundSymbol:lymsSymbol.trim().toUpperCase(),
    kind:"stock" as const,exposureBasis:"reference-index-proxy" as const,
    source:"ODHAD ekonomické expozice LYMS podle iShares CNDX "+
      "(IE00B53SZB19, 253741), NE Nasdaq XNDXNNR, ani akcie LYMS; "+
      dates[0]+"; "+CNDX_PROXY_URL,
  }));
  validateXRayConstituents(transformed);
  return transformed;
}

export async function fetchLymsProxyHoldings(
 symbol:string,force=false,fetchIshares:FetchIshares=fetchIsharesHoldings,
){
  const fund=issuerFeedForIsin(CNDX_ISIN);
  if(!fund||fund.url!==CNDX_PROXY_URL)
    throw new RangeError("Oficiální iShares CNDX zdroj není ve whitelistu.");
  const fetched=await fetchIshares(fund,"CNDX",force);
  const rows=cndxAsLymsProxy(fetched.rows,symbol);
  return {
    rows,fetchedAt:fetched.fetchedAt,cached:fetched.cached,sourceUrl:CNDX_PROXY_URL,
    sourceKind:"proxy-model" as const,
  };
}
