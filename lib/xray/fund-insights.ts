/**
 * Fund structure is NOT a holdings snapshot. This verified, ISIN-only catalog
 * explains how to interpret an unresolved ETF/ETC/ETP in Portfolio X-Ray.
 *
 * Never use this metadata to invent individual stocks or to derive leveraged
 * underlying value from a fund's current market value.
 */
export type XRayProductStructure =
  "synthetic-equity" | "physical-equity" | "physical-gold" | "leveraged-crypto";

export interface XRayFundInsight {
  isin: string;
  structure: XRayProductStructure;
  label: string;
  explanation: string;
  issuerUrl: string;
}

const ENTRIES: readonly XRayFundInsight[] = [
  {
    isin:"LU1829221024",structure:"synthetic-equity",
    label:"Syntetické akciové ETF · Nasdaq-100",
    explanation:"Amundi replikuje index swapem. Akcie v náhradním koši nejsou totéž co ekonomická expozice vůči Nasdaq-100. Bez ověřeného indexového rozkladu se expozice nepřiřazuje konkrétním akciím.",
    issuerUrl:"https://www.amundietf.com/amundi/bel/en/instit/LU1829221024",
  },
  {
    isin:"IE0032077012",structure:"physical-equity",
    label:"Fyzické akciové ETF · Nasdaq-100 (Dist)",
    explanation:"Invesco drží fyzicky replikované akciové portfolio. Pro automatický rozklad je potřeba úplný, datovaný seznam podkladů emitenta, nikoli pouze top 10.",
    issuerUrl:"https://www.invesco.com/uk/en/financial-products/etfs/invesco-eqqq-nasdaq-100-ucits-etf-dist.html",
  },
  {
    isin:"IE00BFZXGZ54",structure:"physical-equity",
    label:"Fyzické akciové ETF · Nasdaq-100 (Acc)",
    explanation:"Akumulační třída Invesco EQQQ používá fyzickou replikaci. Samotná podobnost indexu neopravňuje FinanceOS kopírovat váhy jiného ETF bez ověřeného zdroje.",
    issuerUrl:"https://www.invesco.com/be/en/financial-products/etfs/invesco-eqqq-nasdaq-100-ucits-etf-acc.html",
  },
  {
    isin:"IE00B4ND3602",structure:"physical-gold",
    label:"Fyzicky kryté zlato · ETC",
    explanation:"iShares Physical Gold ETC poskytuje expozici vůči zlatu, nikoli vůči akciím těžařů. Nulový akciový rozklad neznamená chybějící seznam akcií.",
    issuerUrl:"https://www.blackrock.com/cz/individualni-investori/produkty/258441/ishares-physical-gold-etc",
  },
  {
    isin:"JE00BN2CJ301",structure:"physical-gold",
    label:"Fyzicky kryté zlato · ETC",
    explanation:"WisdomTree Core Physical Gold je ETC kryté alokovaným zlatem. Nelze jej rozložit na akcie ani zaměnit kusy ETC za počet uncí bez aktuálního nároku na kov.",
    issuerUrl:"https://www.wisdomtree.eu/en-gb/products/ucits-etfs-unleveraged-etps/commodities/wisdomtree-core-physical-gold",
  },
  {
    isin:"GB00BTWSDN84",structure:"leveraged-crypto",
    label:"Pákové Bitcoin ETP · 3× denní expozice",
    explanation:"Leverage Shares BTC3 sleduje přibližně 3× DENNÍ změnu Bitcoinu přes futures a hotovost. Není to spotový Bitcoin; tržní hodnotu ETP nelze přičíst ke kryptoměnám ani vynásobit třemi jako držené BTC.",
    issuerUrl:"https://crypto.leverageshares.com/etps/leverage-shares-3x-long-bitcoin-etp/",
  },
];

const BY_ISIN = new Map(ENTRIES.map(item=>[item.isin,item]));

/** Unknown or ticker-only products are deliberately never guessed. */
export function fundInsightForIsin(isin: string | null | undefined): XRayFundInsight | null {
  return BY_ISIN.get((isin ?? "").trim().toUpperCase()) ?? null;
}
