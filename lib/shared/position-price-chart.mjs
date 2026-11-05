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
    // Trading currency and asset denomination are not always the quote unit.
    // Kraken's asset row may be in BTC while its holding is priced in EUR.
    if (!VERIFIED_CRYPTO_SYMBOLS.has(symbol)) return null;
    const quote = ["USD", "EUR", "GBP"].includes(currency) ? currency : "USD";
    return symbol + "-" + quote;
  }
  if (assetClass !== "stock" && assetClass !== "etf") return null;
  if (asset.provider !== "trading212") return null;

  const externalId = String(asset.externalId || "").trim().toUpperCase();
  const match = /^([A-Z0-9.]+)_([A-Z]{2})_EQ$/.exec(externalId);
  if (!match || !(match[2] in EQUITY_SUFFIX)) return null;
  const listing = String(asset.listingSymbol || match[1]).trim().toUpperCase();
  // Fail closed if the provider identifier and stored listing disagree.
  if (listing !== match[1]) return null;
  // Yahoo uses a dash for class shares traded in the US (e.g. BRK-B).
  const yahooListing = match[2] === "US" ? listing.replace(/\./g, "-") : listing;
  return yahooListing + EQUITY_SUFFIX[match[2]];
}

const formatters = new Map();

export function exchangeDate(input, timeZone = "UTC") {
  const millis = typeof input === "number" ? input : Date.parse(String(input));
  if (!Number.isFinite(millis) || millis < 0 || millis >= 253402300800000) {
    throw new Error("Neplatný timestamp tržních dat.");
  }
  if (!timeZone || timeZone === "UTC") return new Date(millis).toISOString().slice(0, 10);
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    if (formatters.size >= 40) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(millis))
    .map(part => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

/**
 * Imported date-only or timezone-less records have no verifiable timezone.
 * Keep their literal calendar date instead of silently shifting them across
 * midnight based on the machine running FinanceOS.
 */
export function tradeCalendarDate(occurredAt, timeZone = "UTC") {
  const text = String(occurredAt || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const day = text.slice(0, 10);
    const date = new Date(day + "T00:00:00.000Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
      throw new Error("Neplatné kalendářní datum obchodu.");
    }
    if (!isExactClockTime(text)) return day;
  }
  return exchangeDate(text, timeZone);
}

export function previousClose(prices, tradeDate, maxGapDays = 5) {
  const target = Date.parse(String(tradeDate).slice(0,10) + "T00:00:00.000Z");
  if (!Number.isFinite(target)) return null;
  let low = 0, high = prices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prices[middle].date <= tradeDate) low = middle + 1;
    else high = middle;
  }
  const price = prices[low - 1];
  const gap = price ? target - Date.parse(price.date + "T00:00:00.000Z") : Infinity;
  return gap >= 0 && gap <= maxGapDays * 86400000 && Number.isFinite(price.close) && price.close > 0
    ? price.close : null;
}

export function overlayTradePrice(trade, close, quoteCurrency) {
  const price = Number(trade.price);
  const currency = String(trade.priceCurrency || "").toUpperCase();
  const usable = trade.price !== null && Number.isFinite(price) && price > 0 &&
    currency === String(quoteCurrency || "").toUpperCase() &&
    price / close >= 0.7 && price / close <= 1.3;
  return { chartPrice: usable ? price : close, usedTradePrice: usable };
}

/**
 * A trade has an exact date/clock time in its source record, but the market
 * curve contains only daily closes. Place event markers using exchange-local
 * wall clock time, without arbitrary horizontal collision offsets. The
 * timestamp is expressed on the same day-based graph axis as daily closes.
 */
const clockFormatters = new Map();

export function chartExecutionTimestamp(occurredAt, timeZone = "UTC") {
  const original = String(occurredAt || "");
  const instant = Date.parse(original);
  if (!Number.isFinite(instant)) return null;
  const day = tradeCalendarDate(original, timeZone);
  const atMidnight = Date.parse(day + "T00:00:00.000Z");
  if (!Number.isFinite(atMidnight)) return null;
  const localClock = original.match(/(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/);
  // Missing hour: date-only transaction at noon, not a fabricated 00:00.
  if (!localClock) return atMidnight + 12 * 3600000;
  if (!isExactClockTime(original)) {
    // A timezone-less timestamp is not a UTC instant. Keep the original
    // displayed local clock, and explicitly mark its timezone as unknown.
    const hours = Number(localClock[1]), minutes = Number(localClock[2]);
    const seconds = Number(localClock[3] || 0);
    return atMidnight + ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    if (clockFormatters.size >= 40) clockFormatters.clear();
    clockFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return atMidnight + ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
}

/**
 * Distinguish cash actually denominated in CZK from a model conversion.
 * Brokerage transaction imports use amount_czk calculated from historical
 * CNB fixing; it is NOT necessarily the amount debited by the bank.
 */
export function describeTradeCzk(trade) {
  const amount = trade.amount == null ? NaN : Number(trade.amount);
  const czk = trade.amountCzk == null ? NaN : Number(trade.amountCzk);
  const currency = String(trade.amountCurrency || "").toUpperCase();
  if (currency === "CZK" && Number.isFinite(amount) && amount !== 0) {
    return { value: Math.abs(amount), quality: "recorded" };
  }
  if (Number.isFinite(czk) && czk !== 0) {
    return { value: Math.abs(czk), quality: "cnb-converted" };
  }
  return { value: null, quality: "unavailable" };
}

export function isExactClockTime(occurredAt) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i
    .test(String(occurredAt || ""));
}

/**
 * On London-listed instruments, Yahoo may quote penny units (GBp/GBX)
 * while the brokerage stores the same listing in pounds (GBP). A pence
 * amount is exactly 1/100 of a pound, not an FX conversion.
 *
 * We only allow the transformation if Yahoo explicitly confirms the SAME
 * requested .L symbol. A bare ticker, other exchanges and all other
 * currencies must not be guessed or converted.
 */
export function yahooListingQuoteScale(actualCurrency, expectedCurrency, expectedTicker, returnedTicker) {
  const normalize = (value) => {
    const raw = String(value || "").trim();
    return raw === "GBp" || raw.toUpperCase() === "GBX" || raw.toUpperCase() === "GBPENCE"
      ? "GBX" : raw.toUpperCase();
  };
  const actual = normalize(actualCurrency);
  const expected = normalize(expectedCurrency);
  if (!actual || !expected) return null;
  if (actual === expected) return 1;
  const requested = String(expectedTicker || "").trim().toUpperCase();
  const returned = String(returnedTicker || "").trim().toUpperCase();
  if (!requested.endsWith(".L") || !/^[A-Z0-9.]+\.L$/.test(requested) ||
    !returned || returned !== requested) return null;
  if (actual === "GBX" && expected === "GBP") return 0.01;
  if (actual === "GBP" && expected === "GBX") return 100;
  return null;
}

export function parseYahooDailyChart(chartResult, expectedCurrency, expectedTicker) {
  const actualCurrency = String(chartResult?.meta?.currency || "");
  const receivedTicker = String(chartResult?.meta?.symbol || "").toUpperCase();
  if (expectedTicker && receivedTicker && receivedTicker !== String(expectedTicker).toUpperCase()) {
    throw new Error("Cenový zdroj vrátil jiný instrument než požadovaný ticker.");
  }
  const tz = String(chartResult?.meta?.exchangeTimezoneName || "UTC");
  // Validate the timezone once, even for a source with zero prices.
  exchangeDate(0, tz);
  const requested = String(expectedCurrency || "").toUpperCase();
  const scale = yahooListingQuoteScale(actualCurrency, requested, expectedTicker, receivedTicker);
  if (scale === null) {
    throw new Error("Cenový zdroj uvádí měnu " + (actualCurrency || "neznámou") +
      ", ale pozice má " + requested + ". Automatický převod bez potvrzené burzovní kotace nelze bezpečně provést.");
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
    const date = exchangeDate(timestamp * 1000, tz);
    values.set(date, { date, close: close * scale });
  }
  return [...values.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function eligibleTradeMarker(trade) {
  const kind = String(trade.kind || "").toLowerCase();
  const occurredAt = String(trade.occurredAt || "");
  if ((kind !== "buy" && kind !== "sell") || !/^\d{4}-\d\d-\d\d/.test(occurredAt)) {
    return false;
  }
  const day = occurredAt.slice(0, 10);
  const date = new Date(day + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day &&
    !Number.isNaN(new Date(occurredAt).getTime());
}
