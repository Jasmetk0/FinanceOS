import type {
  XRayExposure,XRayFundContribution,XRayFundCoverage,
} from "./engine.ts";

/**
 * One exposure is valued already by calculateXRay. This module *only*
 * explains that immutable attribution; it never recalculates fund holdings,
 * prices, FX rates or changes the portfolio denominator.
 */
export interface XRayFundAttribution extends XRayFundContribution {
  /** Entire value of the investor's position in this ETF (all accounts). */
  fundMarketValueCzk:number;
  /** What fraction of this ETF's NAV the constituent represents. */
  withinFundPct:number;
  /** This ETF's contribution to the security as % of analyzed portfolio. */
  portfolioPct:number;
  /** This ETF's contribution as % of this single security's exposure. */
  withinExposurePct:number;
}
export interface XRayExposureAttribution {
  directPortfolioPct:number;
  fundsPortfolioPct:number;
  estimatedProxyCzk:number;
  estimatedProxyPortfolioPct:number;
  estimatedProxyExposurePct:number;
  fundSlices:XRayFundAttribution[];
}

const tolerance=(n:number)=>Math.max(1e-6,Math.abs(n)*1e-10);
const pct=(part:number,whole:number)=>whole>0?100*part/whole:0;
function fundIdentity(row:{fundSymbol:string;fundIsin:string|null}):string{
  return row.fundIsin?"isin:"+row.fundIsin.trim().toUpperCase():
    "symbol:"+row.fundSymbol.trim().toUpperCase();
}

/** Ground attribution in the SAME fund NAV and portfolio denominator as X-Ray. */
export function explainExposureAttribution(
  exposure:XRayExposure,funds:XRayFundCoverage[],portfolioValueCzk:number,
):XRayExposureAttribution{
  if(!Number.isFinite(portfolioValueCzk)||portfolioValueCzk<0)
    throw new RangeError("Neplatná hodnota portfolia pro rozpis zdrojů.");
  const fundValues=new Map<string,number>();
  for(const fund of funds){
    if(!Number.isFinite(fund.valueCzk)||fund.valueCzk<0)
      throw new RangeError("Neplatná hodnota fondu při výpočtu rozpisu.");
    const key=fundIdentity({fundSymbol:fund.symbol,fundIsin:fund.isin});
    fundValues.set(key,(fundValues.get(key)??0)+fund.valueCzk);
  }
  const fundSlices=exposure.fundContributions.map(contribution=>{
    const fundMarketValueCzk=fundValues.get(fundIdentity(contribution));
    if(fundMarketValueCzk===undefined || fundMarketValueCzk<=0 ||
       !Number.isFinite(contribution.valueCzk) || contribution.valueCzk<0 ||
       contribution.valueCzk>fundMarketValueCzk+tolerance(fundMarketValueCzk))
      throw new RangeError("Rozpis akcie odkazuje na neplatné nebo chybějící ETF.");
    return {
      ...contribution,fundMarketValueCzk,
      withinFundPct:pct(contribution.valueCzk,fundMarketValueCzk),
      portfolioPct:pct(contribution.valueCzk,portfolioValueCzk),
      withinExposurePct:pct(contribution.valueCzk,exposure.totalCzk),
    };
  });
  const fundCzk=fundSlices.reduce((sum,item)=>sum+item.valueCzk,0);
  const directCzk=exposure.directContributions.reduce((sum,item)=>sum+item.valueCzk,0);
  const estimatedProxyCzk=fundSlices.filter(f=>f.exposureBasis==="reference-index-proxy")
    .reduce((sum,item)=>sum+item.valueCzk,0);
  if(Math.abs(fundCzk-exposure.viaFundsCzk)>tolerance(exposure.totalCzk) ||
     Math.abs(directCzk-exposure.directCzk)>tolerance(exposure.totalCzk) ||
     Math.abs(directCzk+fundCzk-exposure.totalCzk)>tolerance(exposure.totalCzk))
    throw new RangeError("Součet přímých a ETF příspěvků nesouhlasí s akciovou expozicí.");
  if(exposure.totalCzk>portfolioValueCzk+tolerance(portfolioValueCzk))
    throw new RangeError("Podíl akcie překračuje analyzované portfolio.");
  return {
    directPortfolioPct:pct(exposure.directCzk,portfolioValueCzk),
    fundsPortfolioPct:pct(exposure.viaFundsCzk,portfolioValueCzk),
    estimatedProxyCzk,
    estimatedProxyPortfolioPct:pct(estimatedProxyCzk,portfolioValueCzk),
    estimatedProxyExposurePct:pct(estimatedProxyCzk,exposure.totalCzk),
    fundSlices,
  };
}

export type XRayOwnershipFilter="all"|"direct-only"|"funds-only"|"both";
export function matchesXRayOwnership(
  exposure:Pick<XRayExposure,"directCzk"|"viaFundsCzk">,
  mode:XRayOwnershipFilter,
):boolean{
  switch(mode){
    case "all":return true;
    case "direct-only":return exposure.directCzk>0 && exposure.viaFundsCzk===0;
    case "funds-only":return exposure.viaFundsCzk>0 && exposure.directCzk===0;
    case "both":return exposure.directCzk>0 && exposure.viaFundsCzk>0;
  }
}
