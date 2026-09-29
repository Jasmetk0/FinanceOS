const TICKER_ALIASES = Object.freeze({
  IPOE: "SOFI",
  FB: "META",
  IIVI: "COHR",
  DWAC: "DJT",
});

export function normalizeCurrencyAmount(amount, currency) {
  const numeric = Number(amount);
  const rawCurrency = String(currency || "").trim().toUpperCase();

  if (!Number.isFinite(numeric)) {
    return { amount: numeric, currency: rawCurrency };
  }

  if (rawCurrency === "GBX") {
    return { amount: numeric / 100, currency: "GBP" };
  }

  return { amount: numeric, currency: rawCurrency };
}

export function canonicalSecurityIdentity(providerSymbol, isin) {
  const listingSymbol = String(providerSymbol || "")
    .trim()
    .replace(/_[A-Z]+_EQ$/i, "")
    .toUpperCase();
  const normalizedIsin = String(isin || "").trim().toUpperCase() || null;
  const canonicalSymbol = TICKER_ALIASES[listingSymbol] || listingSymbol || "UNKNOWN";

  return {
    listingSymbol,
    canonicalSymbol,
    isin: normalizedIsin,
    canonicalKey: normalizedIsin
      ? "isin:" + normalizedIsin
      : "symbol:" + canonicalSymbol,
  };
}

export function canonicalCryptoIdentity(symbol, rawSymbol) {
  const canonicalSymbol = String(symbol || "").trim().toUpperCase();
  const listingSymbol = String(rawSymbol || symbol || "").trim().toUpperCase();

  return {
    listingSymbol,
    canonicalSymbol,
    isin: null,
    canonicalKey: "crypto:" + canonicalSymbol,
  };
}

export { TICKER_ALIASES };
