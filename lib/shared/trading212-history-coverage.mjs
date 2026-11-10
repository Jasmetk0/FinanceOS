/**
 * Pure provider history decisions, independent of SQLite and networking.
 * Page cursor values are committed separately, after transaction persistence.
 */

/** @param {string} cursorEnd @param {string} firstDate @param {number} windowDays */
export function trading212BackfillWindow(cursorEnd, firstDate, windowDays = 364) {
  const endMs = Date.parse(cursorEnd);
  const firstMs = Date.parse(firstDate);
  if (!Number.isFinite(endMs) || !Number.isFinite(firstMs) ||
      !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
    throw new RangeError("Invalid Trading 212 export history window.");
  }
  if (endMs <= firstMs) return null;
  return {
    timeFrom: new Date(Math.max(firstMs, endMs - windowDays * 86_400_000)).toISOString(),
    timeTo: new Date(endMs).toISOString(),
  };
}

/**
 * @param {{ kind: string; flowScope: string; apiCashComplete: boolean;
 *   possibleCoarseMatch: boolean; }} input
 */
export function canPromoteTrading212ExportCash(input) {
  return input.apiCashComplete && !input.possibleCoarseMatch &&
    input.flowScope === "external" &&
    ["deposit", "withdrawal", "income"].includes(input.kind);
}

/** @param {string|null} cursor @param {string} floor */
export function trading212BackfillComplete(cursor, floor) {
  return typeof cursor === "string" && cursor <= floor;
}
