// Conservative Yahoo mapping: never guess an exchange for a bare equity ticker.
// A similarly named security on another exchange can have a different price.
const EQUITY_SUFFIX = Object.freeze({
  US: "", UK: ".L", GB: ".L", DE: ".DE", FR: ".PA",
  NL: ".AS", IT: ".MI", ES: ".MC", CH: ".SW",
  PL: ".WA", SE: ".ST", DK: ".CO", NO: ".OL",
  FI: ".HE", BE: ".BR", AT: ".VI", CA: ".TO",
  AU: ".AX", JP: ".T", HK: ".HK",
});

const VERIFIED_CRYPTO_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOT", "AVAX", "LINK",
  "DOGE", "LTC", "BCH", "ATOM", "UNI", "AAVE", "ETC",
  "USDC", "USDT", "POL", "TRX",
]);

export function yahooTickerForAsset(asset) {
  const symbol = String(asset.symbol || "").trim().toUpperCase();
  const currency = String(asset.currency || "").trim().toUpperCase();
  const assetClass = String(asset.assetClass || "").toLowerCase();
  if (assetClass === "crypto") {
    return currency === "USD" && VERIFIED_CRYPTO_SYMBOLS.has(symbol)
      ? symbol + "-USD" : null;
  }
  if (assetClass !== "stock" && assetClass !== "etf") return null;
  if (asset.provider !== "trading212") return null;

  const externalId = String(asset.externalId || "").trim().toUpperCase();
  const match = /^([A-Z0-9.]+)_([A-Z]{2})_EQ$/.exec(externalId);
  if (!match || !(match[2] in EQUITY_SUFFIX)) return null;
  const listing = String(asset.listingSymbol || match[1]).trim().toUpperCase();
  // Fail closed if the provider identifier and stored listing disagree.
  if (listing !== match[1]) return null;
  return listing + EQUITY_SUFFIX[match[2]];
}

export function parseYahooDailyChart(chartResult, expectedCurrency) {
  const actualCurrency = String(chartResult?.meta?.currency || "");
  const requested = String(expectedCurrency || "").toUpperCase();
  // The quote unit matters: GBp (pence) is NOT GBP (pounds).
  const normalized = actualCurrency === "GBp" || actualCurrency.toUpperCase() === "GBX"
    ? "GBX" : actualCurrency.toUpperCase();
  if (!normalized || normalized !== requested) {
    throw new Error("Cenový zdroj uvádí měnu " + (actualCurrency || "neznámou") + ", ale pozice má " + requested + ". Graf nelze bezpečně spojit.");
  }

  const times = chartResult?.timestamp;
  const closes = chartResult?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(times) || !Array.isArray(closes) || times.length !== closes.length) {
    throw new Error("Cenový zdroj nevrátil použitelná denní data.");
  }

  const values = new Map();
  for (let i = 0; i < times.length; i++) {
    const timestamp = Number(times[i]);
    const close = closes[i] === null ? NaN : Number(closes[i]);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp >= 253402300800 || !Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    values.set(date, { date, close });
  }
  return [...values.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function eligibleTradeMarker(trade) {
  const kind = String(trade.kind || "").toLowerCase();
  const occurredAt = String(trade.occurredAt || "");
  if ((kind !== "buy" && kind !== "sell") || !/^\d{4}-\d\d-\d\d/.test(occurredAt)) {
    return false;
  }
  return !Number.isNaN(new Date(occurredAt).getTime());
}
