import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalCryptoIdentity,
  canonicalSecurityIdentity,
  normalizeCurrencyAmount,
  quantitiesApproximatelyEqual,
} from "../lib/shared/finance-normalization.mjs";

test("GBX is converted from pence to GBP before FX conversion", () => {
  assert.deepEqual(normalizeCurrencyAmount(12345, "GBX"), {
    amount: 123.45,
    currency: "GBP",
  });
});

test("ordinary currencies preserve their amount", () => {
  assert.deepEqual(normalizeCurrencyAmount(123.45, "eur"), {
    amount: 123.45,
    currency: "EUR",
  });
});

test("Trading 212 historical aliases keep listing identity but use canonical symbol", () => {
  assert.deepEqual(
    canonicalSecurityIdentity("IPOE_US_EQ", "US83406F1021"),
    {
      listingSymbol: "IPOE",
      canonicalSymbol: "SOFI",
      isin: "US83406F1021",
      canonicalKey: "isin:US83406F1021",
    },
  );
});

test("security identity falls back to canonical symbol when ISIN is unavailable", () => {
  assert.deepEqual(canonicalSecurityIdentity("FB_US_EQ", ""), {
    listingSymbol: "FB",
    canonicalSymbol: "META",
    isin: null,
    canonicalKey: "symbol:META",
  });
});

test("Kraken provider aliases retain listing symbol while sharing canonical crypto identity", () => {
  assert.deepEqual(canonicalCryptoIdentity("BTC", "XBT.B"), {
    listingSymbol: "XBT.B",
    canonicalSymbol: "BTC",
    isin: null,
    canonicalKey: "crypto:BTC",
  });
});


test("cost-basis quantity coverage rejects materially missing ledger quantity", () => {
  assert.equal(quantitiesApproximatelyEqual(1, 1.000000001), true);
  assert.equal(quantitiesApproximatelyEqual(1, 0.9), false);
});


test("Trading 212 metadata shortName overrides provider-decorated ticker", () => {
  assert.deepEqual(
    canonicalSecurityIdentity(
      "VWCED_EQ",
      "IE00BK5BQT80",
      "VWCE",
    ),
    {
      listingSymbol: "VWCED_EQ",
      canonicalSymbol: "VWCE",
      isin: "IE00BK5BQT80",
      canonicalKey: "isin:IE00BK5BQT80",
    },
  );
});

test("metadata shortName also repairs historical ticker changes without ISIN", () => {
  assert.deepEqual(
    canonicalSecurityIdentity("ARNC_US_EQ", "", "HWM"),
    {
      listingSymbol: "ARNC",
      canonicalSymbol: "HWM",
      isin: null,
      canonicalKey: "symbol:HWM",
    },
  );
});
