/**
 * Portfolio X-Ray: conservative look-through of priced holdings.
 * No inferred ETF constituents. No double counting of a fund's market value.
 * The model reports economic exposure, not direct ownership or tax lots.
 */
import { buildSedolIsinCrosswalk, normalizedSedol, resolveSecurityIsin } from "./security-identity.ts";

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
export interface XRayConstituent {
  fundSymbol: string;
  fundIsin: string | null;
  securitySymbol: string;
  securityIsin: string | null;
  securitySedol?: string | null; // checked separate share-class ID; never inferred from company name
  securityName: string;
  weightPct: number; // 0..100 of the fund's MARKET VALUE (not leverage/notional).
  kind: ExposureKind;
  asOf: string; // issuer as-of YYYY-MM-DD, may be empty if not reported
  source: string; // provenance: issuer URL, file label, etc.
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

  // Symbol-only matching to ISIN is allowed only when exactly one distinct ISIN
  // exists for the symbol across both direct holdings and imported holdings.
  // Only exact SEDOL-to-ISIN pairs from the same official issuer constituent
  // are trusted. Different SEDOLs can represent different listings/classes.
  const crosswalk = buildSedolIsinCrosswalk(compositions);
  const isinBySymbol = new Map<string, Set<string>>();
  const register = (symbol: string, isin: string | null, kind: string) => {
    if (kind !== "stock" || !strongIsin(isin)) return;
    const s = norm(symbol);
    if (!isinBySymbol.has(s)) isinBySymbol.set(s, new Set());
    isinBySymbol.get(s)?.add(norm(isin));
  };
  for (const h of stocks) register(h.symbol, h.isin, "stock");
  for (const c of compositions) register(c.securitySymbol, resolveSecurityIsin(c,crosswalk), c.kind);
  const stockKey = (symbol: string, isin: string | null, canonicalKey?: string | null) => {
    if (strongIsin(isin)) return "isin:" + norm(isin);
    if (canonicalKey?.startsWith("isin:") && strongIsin(canonicalKey.slice(5))) return "isin:" + canonicalKey.slice(5).toUpperCase();
    const candidates = isinBySymbol.get(norm(symbol));
    return candidates?.size === 1 ? "isin:" + [...candidates][0] : "symbol:" + norm(symbol);
  };

  type Mutable = Omit<XRayExposure, "weightPct" | "totalCzk" | "fundSymbols" | "accounts"> & { fundSymbols: Set<string>; accounts: Set<string> };
  const exposed = new Map<string, Mutable>();
  const add = (key: string, kind: "stock" | "crypto", ticker: string, name: string, directValue: number, viaFund: number, quantity: number, account?: string, fund?: string) => {
    const id = kind + "|" + key;
    let item = exposed.get(id);
    if (!item) {
      item = { key: id, kind, ticker, name, directCzk: 0, viaFundsCzk: 0, directQuantity: 0, fundEquivalentQuantity: null, fundSymbols: new Set(), accounts: new Set() };
      exposed.set(id, item);
    }
    item.directCzk += directValue;
    item.viaFundsCzk += viaFund;
    item.directQuantity += quantity;
    if (account) item.accounts.add(account);
    if (fund) item.fundSymbols.add(fund);
    // Prefer direct identity labels over issuer-supplied abbreviations.
    if (directValue > 0 && name) { item.name = name; item.ticker = ticker; }
  };

  for (const h of direct) {
    const kind = h.assetClass === "crypto" ? "crypto" : "stock";
    const key = kind === "crypto" ? "crypto:" + cryptoSymbol(h.symbol) : stockKey(h.symbol, h.isin, h.canonicalKey);
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
  const coverage: XRayFundCoverage[] = [];
  for (const h of funds) {
    const candidates = h.isin ? byIsin.get(norm(h.isin)) : undefined;
    const tickerOnly = bySymbol.get(norm(h.symbol));
    const ambiguousTicker = (etfIsinsBySymbol.get(norm(h.symbol))?.size ?? 0) > 1;
    const holdingsList = candidates ?? (!ambiguousTicker ? tickerOnly : undefined);
    if (ambiguousTicker && !candidates && tickerOnly) warnings.add("ETF " + h.symbol + " má více ISIN. Import bez ISIN nelze bezpečně přiřadit.");
    if (!holdingsList?.length) {
      coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: 0, mappedCzk: 0, unmappedCzk: h.valueCzk, source: null, asOf: null, note: "Chybí rozklad ETF" });
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
    let mapped = 0;
    for (const c of holdingsList) {
      if (c.kind === "other" || c.weightPct === 0) continue;
      const part = h.valueCzk * c.weightPct / 100;
      const key = c.kind === "crypto" ? "crypto:" + cryptoSymbol(c.securitySymbol) :
        stockKey(c.securitySymbol, resolveSecurityIsin(c,crosswalk));
      add(key, c.kind, c.securitySymbol, c.securityName, 0, part, 0, undefined, h.symbol);
      if(c.kind==="crypto") identityCoverage.cryptoCzk+=part;
      else if(strongIsin(c.securityIsin)) identityCoverage.isinCzk+=part;
      else if(strongIsin(resolveSecurityIsin(c,crosswalk))) identityCoverage.bridgedCzk+=part;
      else if(normalizedSedol(c.securitySedol)) identityCoverage.sedolOnlyCzk+=part;
      else identityCoverage.tickerOnlyCzk+=part;
      mapped += part;
    }
    coverage.push({ symbol: h.symbol, isin: h.isin, valueCzk: h.valueCzk, mappedPct: mapped / h.valueCzk * 100, mappedCzk: mapped, unmappedCzk: Math.max(0, h.valueCzk - mapped), source: holdingsList[0].source || null, asOf: dates[0] ?? null, note: mapped === 0 ? "Rozklad neobsahuje akcie nebo kryptoměny" : null });
  }

  const exposures = [...exposed.values()].map((item): XRayExposure => {
    const totalCzk = item.directCzk + item.viaFundsCzk;
    // A derived equivalent share count is only meaningful for the SAME security
    // with a nonzero direct reference price, never for ADR or another share class.
    const fundEquivalentQuantity = item.directQuantity > 0 && item.directCzk > 0
      ? item.viaFundsCzk / (item.directCzk / item.directQuantity) : null;
    return {
      ...item, totalCzk,
      weightPct: denominatorCzk ? totalCzk / denominatorCzk * 100 : 0,
      fundEquivalentQuantity,
      fundSymbols: [...item.fundSymbols].sort(),
      accounts: [...item.accounts].sort(),
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
  const fundCoverage = coverage.sort((a, b) => b.unmappedCzk - a.unmappedCzk);
  return {
    identityCoverage,
    denominatorCzk, directCzk, fundsCzk, mappedCzk, unallocatedCzk,
    mappedPct: denominatorCzk ? mappedCzk / denominatorCzk * 100 : 0,
    exposures, funds: fundCoverage, warnings: [...warnings],
  };
}
