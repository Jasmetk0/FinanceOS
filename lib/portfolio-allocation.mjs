/**
 * Read-only allocation views based on the most recent known account and
 * holding values. This is NOT ETF look-through exposure.
 * Positive exposures are intentionally charted separately from liabilities
 * or negative reconciliation residuals.
 */
function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function aggregate(rows, getKey, getLabel, getValue, getHref = () => null) {
  const byKey = new Map();
  for (const row of rows) {
    const amountCzk = positive(getValue(row));
    if (!amountCzk) continue;
    const key = String(getKey(row));
    if (!key) continue;
    const current = byKey.get(key);
    if (current) current.amountCzk += amountCzk;
    else byKey.set(key, {
      id: key, label: String(getLabel(row)), amountCzk,
      href: getHref(row),
    });
  }
  return [...byKey.values()].sort(
    (a, b) => b.amountCzk - a.amountCzk || a.label.localeCompare(b.label, "cs"),
  );
}

export function getPortfolioAllocationViews({ allocation, accounts, holdings }) {
  return {
    classes: aggregate(allocation, row => row.label, row => row.label, row => row.valueCzk),
    platforms: aggregate(accounts, row => row.provider, row => row.provider, row => row.valueCzk),
    positions: aggregate(
      holdings,
      row => row.assetId || row.symbol,
      row => row.symbol || row.name || "Neznámý instrument",
      row => row.valueCzk,
      row => {
        if (!row.symbol || !["stock", "etf", "crypto"].includes(row.assetClass)) return null;
        return "/investments/" + encodeURIComponent(row.symbol) +
          "?asset=" + encodeURIComponent(row.assetId);
      },
    ),
  };
}

/** Show at most limit segments and preserve the exact value of every tail item. */
export function compactAllocationSlices(groups, limit = 9) {
  const sorted = [...groups].filter(item => positive(item.amountCzk) > 0)
    .sort((a, b) => b.amountCzk - a.amountCzk);
  const count = Number.isSafeInteger(limit) && limit >= 2 ? limit : 9;
  if (sorted.length <= count) return sorted;
  const direct = sorted.slice(0, count - 1);
  const rest = sorted.slice(count - 1);
  return [...direct, {
    id: "__other__",
    label: "Ostatní pozice",
    amountCzk: rest.reduce((sum, item) => sum + item.amountCzk, 0),
    href: null,
    groupedCount: rest.length,
  }];
}

export function allocationCoverage(groups, knownNetWorthCzk) {
  const chartedCzk = groups.reduce((sum, item) => sum + positive(item.amountCzk), 0);
  const netWorth = Number(knownNetWorthCzk);
  return {
    chartedCzk,
    differenceCzk: Number.isFinite(netWorth) ? chartedCzk - netWorth : null,
    // Small rounding differences are immaterial; larger mismatches deserve a
    // visible disclaimer rather than a fabricated balancing slice.
    mismatch: Number.isFinite(netWorth) &&
      Math.abs(chartedCzk - netWorth) > Math.max(10, Math.abs(netWorth) * .005),
  };
}
