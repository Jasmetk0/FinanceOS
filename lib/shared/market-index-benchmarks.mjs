import { parseYahooDailyChart } from "./position-price-chart.mjs";

/**
 * Allowlisted, identifiable *index levels*. Never map these to a held ETF,
 * a portfolio position, or an index future. Tickers independently checked
 * against Yahoo Finance quote pages or its world-indices listing.
 * FTSE All-World: AW01.FGI (USD price index, NOT the VWCE ETF).
 */
export const MARKET_INDICES = Object.freeze([
  { id: "sp500", name: "S&P 500", ticker: "^GSPC", region: "USA",
    currency: "USD", basis: "price", note: "Velké americké společnosti; cenový index bez dividend." },
  { id: "nasdaq100", name: "Nasdaq-100", ticker: "^NDX", region: "USA",
    currency: "USD", basis: "price", note: "100 velkých nefinančních titulů na Nasdaq; není to Nasdaq Composite." },
  { id: "ftseallworld", name: "FTSE All-World", ticker: "AW01.FGI", region: "Globální",
    currency: "USD", basis: "price", note: "Globální large a mid-cap index; není to cena ETF VWCE. Dostupná historie zdroje může být kratší." },
  { id: "nasdaqcomposite", name: "Nasdaq Composite", ticker: "^IXIC", region: "USA",
    currency: "USD", basis: "price", note: "Široký index titulů kotovaných na burze Nasdaq, nikoli Nasdaq-100." },
  { id: "dowjones", name: "Dow Jones", ticker: "^DJI", region: "USA",
    currency: "USD", basis: "price", note: "Cenově vážený index 30 amerických společností." },
  { id: "russell2000", name: "Russell 2000", ticker: "^RUT", region: "USA",
    currency: "USD", basis: "price", note: "Menší americké společnosti (small caps)." },
  { id: "eurostoxx50", name: "EURO STOXX 50", ticker: "^STOXX50E", region: "Eurozóna",
    currency: "EUR", basis: "price", note: "50 velkých titulů eurozóny; indexové body, ne investovatelný instrument." },
  { id: "dax", name: "DAX", ticker: "^GDAXI", region: "Německo",
    currency: "EUR", basis: "performance", note: "Pozor: běžný DAX je performance index se započtením reinvestovaných dividend." },
  { id: "ftse100", name: "FTSE 100", ticker: "^FTSE", region: "Velká Británie",
    currency: "GBP", basis: "price", note: "Velké britské společnosti; cenový index bez dividend." },
  { id: "nikkei225", name: "Nikkei 225", ticker: "^N225", region: "Japonsko",
    currency: "JPY", basis: "price", note: "Cenově vážený index japonského trhu." },
]);

export const DEFAULT_MARKET_INDICES = Object.freeze(["sp500", "nasdaq100"]);

export function marketIndexById(id) {
  return MARKET_INDICES.find(index => index.id === id) ?? null;
}

export function normalizeMarketSelection(raw, limit = 4) {
  if (raw == null) return [...DEFAULT_MARKET_INDICES];
  const candidates = Array.isArray(raw) ? raw : String(raw).slice(0, 256).split(",");
  const valid = [];
  for (const item of candidates) {
    const id = String(item).trim().toLowerCase();
    if (!marketIndexById(id) || valid.includes(id)) continue;
    valid.push(id);
    if (valid.length >= limit) break;
  }
  return valid.length ? valid : [...DEFAULT_MARKET_INDICES];
}

export function parseMarketIndexChart(payload, index) {
  if (!index || !marketIndexById(index.id) || marketIndexById(index.id).ticker !== index.ticker) {
    throw new Error("Neznámá identita burzovního indexu.");
  }
  const series = parseYahooDailyChart(payload, index.currency, index.ticker);
  if (series.length > 4000) throw new Error("Nadměrně velká cenová historie.");
  return series;
}

export function indexPeriodStart(range, endIso) {
  if (range === "MAX") return "0000-01-01";
  const date = new Date(endIso.slice(0, 10) + "T12:00:00.000Z");
  if (!Number.isFinite(date.getTime())) return "0000-01-01";
  if (range === "1M") date.setUTCMonth(date.getUTCMonth() - 1);
  else if (range === "3M") date.setUTCMonth(date.getUTCMonth() - 3);
  else if (range === "1R") date.setUTCFullYear(date.getUTCFullYear() - 1);
  else if (range === "3R") date.setUTCFullYear(date.getUTCFullYear() - 3);
  else if (range === "5R") date.setUTCFullYear(date.getUTCFullYear() - 5);
  return date.toISOString().slice(0, 10);
}

/**
 * Cross-market benchmark comparison uses only shared close *dates*.
 * Aligning both start AND end avoids fake relative outperformance caused by
 * missing quote days, timezones, or a source with a short available history.
 * 100 is the same mathematical base for each index; NO FX conversion or
 * dividend reinvestment is inferred.
 */
export function buildMarketIndexComparison(rows, startDate) {
  const available = rows.filter(row => Array.isArray(row.points) && row.points.length);
  if (!available.length) return { dates: [], lines: [], reason: "Pro vybrané indexy nejsou dostupné cenové body." };
  const maps = available.map(row => new Map(row.points
    .filter(p => p.date >= startDate && Number.isFinite(p.close) && p.close > 0)
    .map(p => [p.date, p.close])));
  const common = [...maps[0].keys()]
    .filter(date => maps.every(map => map.has(date)))
    .sort();
  if (common.length < 2) {
    return { dates: [], lines: [], reason: "Vybrané indexy nemají alespoň dva společné obchodní dny ve zvoleném období. Zkus jiný rozsah nebo méně indexů." };
  }
  const lines = available.map((row, i) => {
    const baseline = maps[i].get(common[0]);
    const values = common.map(date => Number((maps[i].get(date) / baseline * 100).toFixed(8)));
    return { id: row.id, name: row.name, ticker: row.ticker,
      currency: row.currency, basis: row.basis, baseline,
      start: common[0], end: common.at(-1),
      values, returnPct: (values.at(-1) / 100 - 1) * 100 };
  });
  return { dates: common, lines, reason: null };
}
