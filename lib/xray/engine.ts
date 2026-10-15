/**
 * Portfolio X-Ray: conservative look-through of priced holdings.
 * No inferred ETF constituents. No double counting of a fund's market value.
 * The model reports economic exposure, not direct ownership or tax lots.
 */
import { buildSedolIsinCrosswalk, normalizedSedol, resolveSecurityIsin } from "./security-identity.ts";
import { fundInsightForIsin } from "./fund-insights.ts";

export interface XRayHolding {
  id: string;
  symbol: string;
  name: string;
  assetClass: string;
  isin: string | null;
  canonicalKey: string | null;
  quantity: number;
  valueCzk: number;
  provider: string;
  accountName: string;
  updatedAt?: string | null; // timestamp of locally stored position, not exchange quote time
}

export type ExposureKind = "stock" | "crypto" | "other";
/** Source semantics matter: a synthetic ETF's substitute basket is not index exposure. */
export type XRayExposureBasis = "fund-holdings" | "reference-index" | "reference-index-proxy" | "substitute-basket";
export interface XRayConstituent {
  fundSymbol: string;
  fundIsin: string | null;
  securitySymbol: string;
  securityIsin: string | null;
  securitySedol?: string | null; // checked separate share-class ID; never inferred from company name
  securityName: string;
  weightPct: number; // 0..100 of the fund's MARKET VALUE (not leverage/notional).
  kind: ExposureKind;
  exposureBasis?: XRayExposureBasis; // legacy data implies fund-holdings; NEVER index exposure
  asOf: string; // issuer as-of YYYY-MM-DD, may be empty if not reported
  source: string; // provenance: issuer URL, file label, etc.
}

export interface XRayFundContribution {
  /** Exchange listing labels can differ while the ISIN stays identical. */
  fundSymbol: string;
  fundIsin: string | null;
  valueCzk: number;
  exposureBasis?: "reference-index" | "reference-index-proxy"; // explicit distinction: index vs proxy
}

export interface XRayDirectContribution {
  account: string;
  valueCzk: number;
  quantity: number;
}

export interface XRayExposure {
  key: string;
  kind: "stock" | "crypto";
  ticker: string;
  name: string;
  directCzk: number;
  viaFundsCzk: number;
  totalCzk: number;
  weightPct: number;
  directQuantity: number;
  fundEquivalentQuantity: number | null;
  fundSymbols: string[];
  accounts: string[];
  fundContributions: XRayFundContribution[];
  directContributions: XRayDirectContribution[];
}
export interface XRayFundCoverage {
  symbol: string;
  isin: string | null;
  valueCzk: number;
  mappedPct: number;
  mappedCzk: number;
  unmappedCzk: number;
  source: string | null;
  asOf: string | null;
  note: string | null;
  exposureBasis?: "reference-index" | "reference-index-proxy";
}
/**
 * These buckets describe the available identity evidence, not provenance
 * authentication or live quotes. All amounts are values in CZK.
 */
export interface XRayIdentityCoverage {
  isinCzk: number;       // explicit ISIN in broker or issuer source
  bridgedCzk: number;    // SEDOL mapped to explicit issuer ISIN
  sedolOnlyCzk: number;  // security-level SEDOL without verified ISIN bridge
  tickerOnlyCzk: number; // weak ticker/canonical fallback, NOT proven same share class
  cryptoCzk: number;     // symbol-based crypto positions/exposures (no chain ID)
  unmappedCzk: number;   // fund residual, cash, fixed income, no issuer snapshot
  totalCzk: number;
}
export interface XRayResult {
  identityCoverage: XRayIdentityCoverage;
  denominatorCzk: number;
  directCzk: number;
  fundsCzk: number;
  mappedCzk: number;
  unallocatedCzk: number;
  mappedPct: number;
  exposures: XRayExposure[];
  funds: XRayFundCoverage[];
  warnings: string[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const cryptoSymbol = (symbol: string) => ({ XBT: "BTC", XXBT: "BTC", XDG: "DOGE", XXDG: "DOGE" })[norm(symbol) as "XBT" | "XXBT" | "XDG" | "XXDG"] ?? norm(symbol);
const strongIsin = (isin: string | null | undefined) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(norm(isin));
const MONEY_EPSILON = 1e-6;
const TOTAL_TOLERANCE = 1e-7;

/**
 * Vanguard identifies many stock lines as TICKER@SEDOL. That string is an
 * INTERNAL collision-safe identifier, not the exchange ticker a person
 * should see. Keep the immutable exposure key (ISIN/SEDOL) untouched, but
 * remove a suffix in the display label ONLY if it agrees with a separately
 * supplied checksum-valid securitySedol. Never strip arbitrary @ text.
 */
export function displayXRayTicker(symbol: string, securitySedol?: string | null): string {
  const match = /^([A-Z0-9.^-]{1,24})@([0-9A-Z]{7})$/i.exec(symbol.trim());
  if (!match) return symbol;
  const fromSuffix = normalizedSedol(match[2]);
  const fromMetadata = normalizedSedol(securitySedol);
  // Old browser-cached Vanguard rows had no separate securitySedol field;
  // preserve their readable display without changing their identity key.
  if (!fromSuffix || (securitySedol && fromSuffix !== fromMetadata)) return symbol;
  return match[1].toUpperCase();
}

function assertHoldings(rows: XRayHolding[]) {
  if (!Array.isArray(rows) || rows.length > 30_000) throw new RangeError("Neplatný počet pozic.");
  for (const h of rows) {
    if (!h || typeof h.id !== "string" || !h.id || typeof h.symbol !== "string" ||
        !Number.isFinite(h.quantity) || !Number.isFinite(h.valueCzk) ||
        h.valueCzk < 0 || h.quantity < 0) {
      throw new RangeError("Neplatná nebo záporná investiční pozice. Výpočet byl zastaven.");
    }
  }
}

export function validateXRayConstituents(rows: XRayConstituent[]) {
  if (!Array.isArray(rows) || rows.length > 200_000) {
    throw new RangeError("Soubor je příliš velký nebo není seznamem podkladových aktiv.");
  }
  const seen = new Set<string>();
  const weights = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r.fundSymbol !== "string" || typeof r.securitySymbol !== "string" ||
        typeof r.securityName !== "string" || typeof r.kind !== "string" ||
        !["stock", "crypto", "other"].includes(r.kind) ||
        (r.exposureBasis !== undefined && !["fund-holdings", "reference-index", "reference-index-proxy", "substitute-basket"].includes(r.exposureBasis)) ||
        !Number.isFinite(r.weightPct) || r.weightPct < 0 || r.weightPct > 100 ||
        (r.fundIsin && !strongIsin(r.fundIsin)) ||
        (r.securityIsin && !strongIsin(r.securityIsin)) ||
        (r.securitySedol && !normalizedSedol(r.securitySedol)) ||
        (r.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)) ||
        !norm(r.fundSymbol) || !norm(r.securitySymbol) ||
        !r.securityName.trim() || r.securityName.length > 150 ||
        typeof r.source !== "string" || r.source.length > 600) {
      throw new RangeError("Neplatný podklad fondu na řádku " + (i + 2) + ".");
    }
    const fund = r.fundIsin ? "isin:" + norm(r.fundIsin) : "symbol:" + norm(r.fundSymbol);
    const security = r.securityIsin ? "isin:" + norm(r.securityIsin) : r.kind + ":" + norm(r.securitySymbol);
    const dedupe = fund + "|" + security;
    if (seen.has(dedupe)) throw new RangeError("Duplicitní podklad " + r.securitySymbol + " ve fondu " + r.fundSymbol + ". Sluč duplicity v souboru.");
    seen.add(dedupe);
    weights.set(fund, (weights.get(fund) ?? 0) + r.weightPct);
    if ((weights.get(fund) ?? 0) > 100 + TOTAL_TOLERANCE) {
      throw new RangeError("Součet vah fondu " + r.fundSymbol + " překračuje 100 %. Zkontroluj procenta, deriváty nebo duplicitní řádky.");
    }
  }
}

/**
 * One coverage row per verified ETF ISIN even when the investor owns that
 * security through multiple broker accounts / trading venues. This is a
 * PRESENTATION aggregation only; individual holdings are still allocated
 * independently by calculateXRay, preserving value and source tracing.
 */
function aggregateFundCoverage(rows:XRayFundCoverage[]): XRayFundCoverage[] {
  const groups = new Map<string, XRayFundCoverage[]>();
  for(const row of rows){
    const key=row.isin?"isin:"+norm(row.isin):"ticker:"+norm(row.symbol);
    const existing=groups.get(key)??[];
    existing.push(row);
    groups.set(key,existing);
  }
  const result:XRayFundCoverage[]=[];
  for(const group of groups.values()){
    const valueCzk=group.reduce((total,r)=>total+r.valueCzk,0);
    const mappedCzk=group.reduce((total,r)=>total+r.mappedCzk,0);
    const unmappedCzk=group.reduce((total,r)=>total+r.unmappedCzk,0);
    const sources=[...new Set(group.map(r=>r.source))];
    const dates=[...new Set(group.map(r=>r.asOf))];
    const notes=[...new Set(group.map(r=>r.note).filter((v):v is string=>Boolean(v)))];
    result.push({
      symbol:[...new Set(group.map(r=>r.symbol))].sort().join(" / "),
      isin:group[0].isin,
      valueCzk,mappedCzk,unmappedCzk,
      mappedPct:valueCzk?mappedCzk/valueCzk*100:0,
      source:sources.length===1?sources[0]:null,
      asOf:dates.length===1?dates[0]:null,
      note:notes.join(" ")||null,
      ...(group.every(r=>r.exposureBasis==="reference-index") ? {exposureBasis:"reference-index" as const} :
        group.every(r=>r.exposureBasis==="reference-index-proxy") ? {exposureBasis:"reference-index-proxy" as const} : {}),
    });
  }
  return result.sort((a,b)=>b.unmappedCzk-a.unmappedCzk || b.valueCzk-a.valueCzk);
}

export function calculateXRay(holdings: XRayHolding[], compositions: XRayConstituent[]): XRayResult {
  assertHoldings(holdings);
  validateXRayConstituents(compositions);
  const inScope = holdings.filter((h) =>
    (h.assetClass === "stock" || h.assetClass === "etf" || h.assetClass === "crypto") && h.valueCzk > 0);
  const stocks = inScope.filter((h) => h.assetClass === "stock");
  const crypto = inScope.filter((h) => h.assetClass === "crypto");
  const funds = inScope.filter((h) => h.assetClass === "etf");
  const direct = [...stocks, ...crypto];
  const directCzk = direct.reduce((total, h) => total + h.valueCzk, 0);
  const fundsCzk = funds.reduce((total, h) => total + h.valueCzk, 0);
  const denominatorCzk = directCzk + fundsCzk;
  const identityCoverage: XRayIdentityCoverage = {
    isinCzk:0,bridgedCzk:0,sedolOnlyCzk:0,
    tickerOnlyCzk:0,cryptoCzk:0,unmappedCzk:0,totalCzk:denominatorCzk,
  };

  // A shared ticker does NOT establish a common share class. For example,
  // different exchanges and security types reuse tickers. Only exact ISIN
  // or a checksum-validated SEDOL/ISIN crosswalk can merge direct positions
  // with ETF constituents. Otherwise keep the economic exposures distinct.
  const crosswalk = buildSedolIsinCrosswalk(compositions);
  const directStockKey = (holding: XRayHolding): string => {
    const isin = strongIsin(holding.isin) ? norm(holding.isin) :
      holding.canonicalKey?.startsWith("isin:") && strongIsin(holding.canonicalKey.slice(5))
        ? norm(holding.canonicalKey.slice(5)) : null;
    // Even two broker rows bearing the same ticker are not guaranteed to
    // represent the same security without a trusted instrument ID.
    return isin ? "isin:" + isin : "position:" + holding.id;
  };
  const constituentStockKey = (row: XRayConstituent): string => {
    const isin = resolveSecurityIsin(row,crosswalk);
    if (strongIsin(isin)) return "isin:" + norm(isin);
    const sedol = normalizedSedol(row.securitySedol);
    if (sedol) return "sedol:" + sedol;
    // No verified identifier: scope the ticker to its PARTICULAR fund
    // rather than merging same-symbol securities across different issuers.
    const fundKey = row.fundIsin ? "isin:" + norm(row.fundIsin) :
      "symbol:" + norm(row.fundSymbol);
    return "fund:" + JSON.stringify([fundKey, norm(row.securitySymbol)]);
  };

  type FundSource = { symbols: Set<string>; isin: string | null; valueCzk: number; exposureBasis?: "reference-index" | "reference-index-proxy" };
  type Mutable = Omit<XRayExposure, "weightPct" | "totalCzk" |
    "fundSymbols" | "accounts" | "fundContributions" | "directContributions"> & {
      fundSymbols: Set<string>;
      accounts: Set<string>;
      fundsByIdentity: Map<string, FundSource>;
      directByAccount: Map<string, XRayDirectContribution>;
    };
  const exposed = new Map<string, Mutable>();
  const add = (key: string, kind: "stock" | "crypto", ticker: string, name: string, directValue: number,
    viaFund: number, quantity: number, account?: string, fund?: string, fundIsin?: string | null,
    exposureBasis?: "reference-index" | "reference-index-proxy") => {
    const id = kind + "|" + key;
    let item = exposed.get(id);
    if (!item) {
      item = {
        key: id, kind, ticker, name, directCzk: 0, viaFundsCzk: 0,
        directQuantity: 0, fundEquivalentQuantity: null, fundSymbols: new Set(),
        accounts: new Set(), fundsByIdentity: new Map(), directByAccount: new Map(),
      };
      exposed.set(id, item);
    }
    item.directCzk += directValue;
    item.viaFundsCzk += viaFund;
    item.directQuantity += quantity;
    if (account) {
      item.accounts.add(account);
      const entry = item.directByAccount.get(account) ?? {account, valueCzk:0, quantity:0};
      entry.valueCzk += directValue;
      entry.quantity += quantity;
      item.directByAccount.set(account,entry);
    }
    if (fund && viaFund > 0) {
      item.fundSymbols.add(fund);
      // Aggregate exchange listings of the SAME verified ETF ISIN.
      // A symbol-only fund can aggregate only with that same symbol.
      const fundKey = fundIsin ? "isin:" + norm(fundIsin) : "symbol:" + norm(fund);
      const entry = item.fundsByIdentity.get(fundKey) ?? {
        symbols:new Set<string>(), isin:fundIsin ? norm(fundIsin) : null, valueCzk:0,
        ...(exposureBasis ? {exposureBasis} : {}),
      };
      entry.symbols.add(fund);
      entry.valueCzk += viaFund;
      item.fundsByIdentity.set(fundKey,entry);
    }
    // Prefer direct identity labels over issuer-supplied abbreviations.
    if (directValue > 0 && name) { item.name = name; item.ticker = ticker; }
  };

  for (const h of direct) {
    const kind = h.assetClass === "crypto" ? "crypto" : "stock";
    const key = kind === "crypto" ? "crypto:" + cryptoSymbol(h.symbol) : directStockKey(h);
    // Without an identifiable symbol or ISIN, keep the individual source row separate.
    const resolved = key.endsWith(":") || key.endsWith(":UNKNOWN") ? "position:" + h.id : key;
    add(resolved, kind, h.symbol, h.name, h.valueCzk, 0, h.quantity, h.provider + " · " + h.accountName);
    if(kind==="crypto") identityCoverage.cryptoCzk+=h.valueCzk;
    else if(strongIsin(h.isin) ||
      (h.canonicalKey?.startsWith("isin:") && strongIsin(h.canonicalKey.slice(5))))
      identityCoverage.isinCzk+=h.valueCzk;
    else identityCoverage.tickerOnlyCzk+=h.valueCzk;
  }

  const byIsin = new Map<string, XRayConstituent[]>();
  const bySymbol = new Map<string, XRayConstituent[]>();
  for (const c of compositions) {
    if (c.fundIsin) {
      const k = norm(c.fundIsin);
      const group = byIsin.get(k);
      if (group) group.push(c);
      else byIsin.set(k, [c]);
    } else {
      const k = norm(c.fundSymbol);
      const group = bySymbol.get(k);
      if (group) group.push(c);
      else bySymbol.set(k, [c]);
    }
  }
  // Do not apply ticker-only files when the same ticker represents multiple ETFs.
  const etfIsinsBySymbol = new Map<string, Set<string>>();
  for (const h of funds) {
    const s = norm(h.symbol);
    if (!etfIsinsBySymbol.has(s)) etfIsinsBySymbol.set(s, new Set());
    etfIsinsBySymbol.get(s)?.add(norm(h.isin) || "unknown");
  }
  const warnings = new Set<string>();
  const directMissingIdentity = stocks.filter((h) =>
    !strongIsin(h.isin) &&
    !(h.canonicalKey?.startsWith("isin:") && strongIsin(h.canonicalKey.slice(5)))
  ).length;
  if (directMissingIdentity > 0) warnings.add(
    directMissingIdentity + " přímo držených akciových pozic nemá ISIN. " +
    "Kvůli ochraně před chybným sloučením jsou vedené odděleně od ETF a jiných účtů."
  );
  const coverage: XRayFundCoverage[] = [];
  for (const h of funds) {
    const candidates = h.isin ? byIsin.get(norm(h.isin)) : undefined;
    const tickerOnly = bySymbol.get(norm(h.symbol));
    const ambiguousTicker = (etfIsinsBySymbol.get(norm(h.symbol))?.size ?? 0) > 1;
    // Known ETF ISIN must match the declared ISIN in its issuer snapshot.
    // A symbol-only manual CSV is never sufficient to identify a different
    // fund that happens to use the same exchange ticker.
    const holdingsList = candidates ?? (!h.isin && !ambiguousTicker ? tickerOnly : undefined);
    if (h.isin && !candidates && tickerOnly) {
      warnings.add("ETF " + h.symbol + " (" + h.isin + ") nelze přiřadit k CSV bez fund_isin. Doplň ISIN fondu; neověřený rozklad zůstává nezapočten.");
    }
    if (ambiguousTicker && !candidates && tickerOnly) warnings.add("ETF " + h.symbol + " má více ISIN. Import bez ISIN nelze bezpečně přiřadit.");
    if (!holdingsList?.length) {
      coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: 0, mappedCzk: 0, unmappedCzk: h.valueCzk, source: null, asOf: null, note: fundInsightForIsin(h.isin)?.explanation ?? "Chybí rozklad ETF" });
      continue;
    }
    // Dates/sources from different snapshots for a single fund can produce
    // a fictitious allocation. Fail closed rather than combining them.
    const dates = [...new Set(holdingsList.map((c) => c.asOf).filter(Boolean))];
    if (dates.length > 1) {
      warnings.add("Fond " + h.symbol + " má různé datumy rozkladu. Použij jeden snapshot.");
      coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: 0, mappedCzk: 0, unmappedCzk: h.valueCzk, source: null, asOf: null, note: "Nejednotné datum složení" });
      continue;
    }
    const sources = [...new Set(holdingsList.map((c) => c.source).filter(Boolean))];
    if (sources.length > 1) {
      warnings.add("Fond " + h.symbol + " kombinuje podklady z různých zdrojů. Sjednoť soubor emitenta.");
      coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: 0, mappedCzk: 0, unmappedCzk: h.valueCzk, source: null, asOf: dates[0] ?? null, note: "Nesmíšený zdroj nelze ověřit" });
      continue;
    }
    // For synthetic funds the physical substitute basket is a DIFFERENT
    // portfolio from the benchmark's economic stock exposure. Legacy CSV,
    // even when labelled "official holdings", must never be treated as NDX.
    const isSynthetic = fundInsightForIsin(h.isin)?.structure === "synthetic-equity";
    const bases = new Set(holdingsList.map(c=>c.exposureBasis ?? "fund-holdings"));
    const declaredIndex = bases.size===1 && bases.has("reference-index");
    const declaredProxy = bases.size===1 && bases.has("reference-index-proxy");
    const indexedWeight = holdingsList.reduce((sum,c)=>sum+c.weightPct,0);
    const indexComplete = holdingsList.length>=90 && indexedWeight>=98 &&
      indexedWeight<=100+TOTAL_TOLERANCE && holdingsList.every(c=>c.kind==="stock") &&
      dates.length===1 && Boolean(dates[0]);
    // A proxy is an explicitly LESS accurate economic model, never a
    // Nasdaq / Amundi-reported benchmark portfolio. Reject old cached proxy
    // snapshots entirely, rather than silently passing them off as current.
    const proxyDate=dates[0] ? Date.parse(dates[0]+"T00:00:00Z") : NaN;
    const proxyAgeDays=(Date.now()-proxyDate)/86_400_000;
    const proxyFresh=Number.isFinite(proxyAgeDays) && proxyAgeDays>=-1 && proxyAgeDays<=14;
    if ((isSynthetic && (!(declaredIndex || declaredProxy) || !indexComplete ||
          (declaredProxy && !proxyFresh))) ||
        (!isSynthetic && (bases.has("reference-index") || bases.has("reference-index-proxy")))) {
      const reason=isSynthetic
        ? "Syntetické ETF: náhradní swapový koš nelze vydávat za referenční index. " +
          "Indexová/proxy expozice vyžaduje výslovně označený úplný snapshot " +
          "(alespoň 90 akciových řádků, váhy nejméně 98 % a datum). " +
          "Modelový proxy rozklad musí být maximálně 14 dní starý."
        : "Fyzické ETF nemůže používat podklady označené jako referenční index nebo proxy.";
      warnings.add(h.symbol+": "+reason);
      coverage.push({symbol:h.symbol,isin:h.isin,valueCzk:h.valueCzk,mappedPct:0,
        mappedCzk:0,unmappedCzk:h.valueCzk,source:holdingsList[0].source||null,
        asOf:dates[0]??null,note:reason});
      continue;
    }
    const basis: "reference-index" | "reference-index-proxy" | undefined = isSynthetic ?
      declaredProxy ? "reference-index-proxy" : "reference-index" : undefined;
    if (basis==="reference-index-proxy") {
      warnings.add(h.symbol+": ODHAD ekonomické expozice podle fyzicky replikujícího ETF CNDX. " +
        "Jde o proxy, nikoliv skutečné váhy indexu XNDXNNR, ani skutečné akcie LYMS.");
    } else if (basis) warnings.add(h.symbol+": Ekonomická expozice dle indexu; akcie nejsou fyzicky drženy fondem.");
    let mapped = 0;
    for (const c of holdingsList) {
      if (c.kind === "other" || c.weightPct === 0 || c.exposureBasis==="substitute-basket") continue;
      const part = h.valueCzk * c.weightPct / 100;
      const key = c.kind === "crypto" ? "crypto:" + cryptoSymbol(c.securitySymbol) :
        constituentStockKey(c);
      add(key, c.kind, c.kind === "stock" ? displayXRayTicker(c.securitySymbol, c.securitySedol) : c.securitySymbol,
        c.securityName, 0, part, 0, undefined, h.symbol, h.isin, basis);
      if(c.kind==="crypto") identityCoverage.cryptoCzk+=part;
      else if(strongIsin(c.securityIsin)) identityCoverage.isinCzk+=part;
      else if(strongIsin(resolveSecurityIsin(c,crosswalk))) identityCoverage.bridgedCzk+=part;
      else if(normalizedSedol(c.securitySedol)) identityCoverage.sedolOnlyCzk+=part;
      else identityCoverage.tickerOnlyCzk+=part;
      mapped += part;
    }
    coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: mapped / h.valueCzk * 100, mappedCzk: mapped, unmappedCzk: Math.max(0, h.valueCzk - mapped), source: holdingsList[0].source || null, asOf: dates[0] ?? null, note: mapped === 0 ? (fundInsightForIsin(h.isin)?.explanation ?? "Rozklad neobsahuje akcie nebo kryptoměny") :
      basis==="reference-index-proxy" ?
        "ODHAD podle akciových vah CNDX; NENÍ to oficiální skladba indexu XNDXNNR ani swapový koš LYMS." :
      basis ? "Ekonomická expozice podle referenčního indexu, nikoliv skutečné akcie ve swapovém koši." : null,
      ...(basis ? {exposureBasis:basis} : {}) });
  }

  const exposures = [...exposed.values()].map((item): XRayExposure => {
    const totalCzk = item.directCzk + item.viaFundsCzk;
    // A derived equivalent share count is only meaningful for the SAME security
    // with a nonzero direct reference price, never for ADR or another share class.
    const fundEquivalentQuantity = item.viaFundsCzk > 0 && item.directQuantity > 0 && item.directCzk > 0
      ? item.viaFundsCzk / (item.directCzk / item.directQuantity) : null;
    const fundContributions = [...item.fundsByIdentity.values()].map((fund) => ({
      fundSymbol:[...fund.symbols].sort().join(" / "),
      fundIsin:fund.isin,
      valueCzk:fund.valueCzk,
      ...(fund.exposureBasis ? {exposureBasis:fund.exposureBasis} : {}),
    })).sort((a,b)=>b.valueCzk-a.valueCzk || a.fundSymbol.localeCompare(b.fundSymbol));
    const directContributions = [...item.directByAccount.values()]
      .sort((a,b)=>b.valueCzk-a.valueCzk || a.account.localeCompare(b.account));
    const sumFunds=fundContributions.reduce((v,f)=>v+f.valueCzk,0);
    const sumDirect=directContributions.reduce((v,d)=>v+d.valueCzk,0);
    const tolerance=Math.max(MONEY_EPSILON,totalCzk*1e-10);
    if (Math.abs(sumFunds-item.viaFundsCzk)>tolerance ||
        Math.abs(sumDirect-item.directCzk)>tolerance) {
      throw new RangeError("Rozpis zdrojů X-Ray nesouhlasí s celkovou hodnotou pozice.");
    }
    return {
      key:item.key,kind:item.kind,ticker:item.ticker,name:item.name,
      directCzk:item.directCzk,viaFundsCzk:item.viaFundsCzk,
      directQuantity:item.directQuantity,totalCzk,
      weightPct: denominatorCzk ? totalCzk / denominatorCzk * 100 : 0,
      fundEquivalentQuantity,
      fundSymbols: [...item.fundSymbols].sort(),
      accounts: [...item.accounts].sort(),
      fundContributions,directContributions,
    };
  }).sort((a, b) => b.totalCzk - a.totalCzk || a.ticker.localeCompare(b.ticker));
  const mappedCzk = exposures.reduce((sum, row) => sum + row.totalCzk, 0);
  const unallocatedCzk = Math.max(0, denominatorCzk - mappedCzk);
  identityCoverage.unmappedCzk=unallocatedCzk;
  const covered=[identityCoverage.isinCzk,identityCoverage.bridgedCzk,
    identityCoverage.sedolOnlyCzk,identityCoverage.tickerOnlyCzk,identityCoverage.cryptoCzk]
    .reduce((a,b)=>a+b,0);
  // Buckets are derived from the *same* direct and fund allocation events.
  // Any discrepancy is a regression: never present misleading coverage.
  if(Math.abs(covered-mappedCzk)>Math.max(MONEY_EPSILON,denominatorCzk*1e-10)) {
    throw new RangeError("Kontrola identity a výpočtu X-Ray nesouhlasí. Výstup nebyl použit.");
  }
  if (mappedCzk > denominatorCzk + MONEY_EPSILON) {
    throw new RangeError("Rozklad překročil hodnotu původního portfolia. Zkontroluj strukturu fondů.");
  }
  const fundCoverage = aggregateFundCoverage(coverage);
  return {
    identityCoverage,
    denominatorCzk, directCzk, fundsCzk, mappedCzk, unallocatedCzk,
    mappedPct: denominatorCzk ? mappedCzk / denominatorCzk * 100 : 0,
    exposures, funds: fundCoverage, warnings: [...warnings],
  };
}
