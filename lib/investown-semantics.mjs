/**
 * Shared Investown accounting semantics.
 *
 * This module is plain ESM on purpose so the exact production rules can also
 * be executed by Node's test runner without a TypeScript loader.
 */

export const INVESTOWN_EXACT_TYPE_MAP = Object.freeze({
  "Vklad peněz": "deposit",
  "Výběr peněz": "withdrawal",
  "Výnos": "interest",
  "Částečný výnos": "interest",
  "Bonusový výnos": "interest",
  "Smluvní pokuta": "interest",
  "Smluvní pokuta z prodlení": "interest",
  "Zákonné úroky z prodlení": "interest",
  "Zákonný úrok z prodlení": "interest",
  "Odměna": "income",
  "Investice": "transfer",
  "Autoinvestice": "transfer",
  "Nabídka ke koupi": "transfer",
  "Vrácení nabídky": "transfer",
  "Splacení jistiny": "transfer",
  "Částečné splacení jistiny": "transfer",
  "Odstoupení": "transfer",
});

export const INVESTOWN_PRINCIPAL_IN_TYPES = new Set([
  "Investice",
  "Autoinvestice",
]);

export const INVESTOWN_PRINCIPAL_OUT_TYPES = new Set([
  "Splacení jistiny",
  "Částečné splacení jistiny",
  "Odstoupení",
]);

export const INVESTOWN_OFFER_LOCK_TYPES = new Set(["Nabídka ke koupi"]);
export const INVESTOWN_OFFER_UNLOCK_TYPES = new Set(["Vrácení nabídky"]);

export function normalizeInvestownText(value) {
  return String(value || "").trim();
}

export function investownIncomeCategory(row) {
  const text = [row?.type, row?.description, row?.projectType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("pozv") ||
    text.includes("referral") ||
    text.includes("invite")
  ) return "referral_reward";

  if (
    text.includes("kampa") ||
    text.includes("campaign") ||
    text.includes("promo")
  ) return "campaign_reward";

  return "external_reward";
}

export function classifyInvestownKind(row) {
  const exact = INVESTOWN_EXACT_TYPE_MAP[normalizeInvestownText(row?.type)];
  if (exact) return exact;

  const text = [row?.type, row?.description, row?.projectType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("vklad") ||
    text.includes("dobití") ||
    text.includes("dobiti") ||
    text.includes("příchozí platba") ||
    text.includes("prichozi platba") ||
    text.includes("deposit")
  ) return "deposit";

  if (
    text.includes("výběr") ||
    text.includes("vyber") ||
    text.includes("withdraw")
  ) return "withdrawal";

  if (
    text.includes("výnos") ||
    text.includes("vynos") ||
    text.includes("úrok") ||
    text.includes("urok") ||
    text.includes("pokuta") ||
    text.includes("interest")
  ) return "interest";

  if (
    text.includes("poplatek") ||
    text.includes("fee") ||
    text.includes("commission")
  ) return "fee";

  if (
    text.includes("bonus") ||
    text.includes("odměna") ||
    text.includes("odmena") ||
    text.includes("cashback") ||
    text.includes("referral")
  ) return "income";

  if (
    text.includes("investice") ||
    text.includes("investování") ||
    text.includes("investovani") ||
    text.includes("nákup") ||
    text.includes("nakup") ||
    text.includes("nabídka") ||
    text.includes("nabidka") ||
    text.includes("prodej") ||
    text.includes("tržiště") ||
    text.includes("trziste") ||
    text.includes("jistiny") ||
    text.includes("odstoupení") ||
    text.includes("odstoupeni") ||
    text.includes("principal") ||
    text.includes("repayment") ||
    text.includes("investment")
  ) return "transfer";

  return "adjustment";
}

export function investownPrincipalDelta(row) {
  const type = normalizeInvestownText(row?.type);
  if (
    !INVESTOWN_PRINCIPAL_IN_TYPES.has(type) &&
    !INVESTOWN_PRINCIPAL_OUT_TYPES.has(type)
  ) return 0;

  const amount = Number(row?.amount);
  if (!Number.isFinite(amount)) return 0;

  // All principal movements are the opposite side of the wallet movement:
  // investment cash out (-) creates principal (+), repayment cash in (+)
  // removes principal (-). Keeping the provider sign also makes reversals
  // correct automatically instead of turning them into another movement in
  // the original direction.
  return -amount;
}

export function investownReservationDelta(row) {
  const type = normalizeInvestownText(row?.type);
  if (
    !INVESTOWN_OFFER_LOCK_TYPES.has(type) &&
    !INVESTOWN_OFFER_UNLOCK_TYPES.has(type)
  ) return 0;

  const amount = Number(row?.amount);
  if (!Number.isFinite(amount)) return 0;

  // Offer locks/unlocks are likewise the opposite side of wallet cash.
  return -amount;
}

export function investownInterestBucket(type) {
  const normalized = normalizeInvestownText(type).toLowerCase();

  if (normalized === "výnos" || normalized === "částečný výnos") {
    return "ordinary";
  }
  if (normalized === "bonusový výnos") return "bonus";
  if (
    normalized.includes("pokuta") ||
    normalized.includes("prodlení") ||
    normalized.includes("prodleni")
  ) {
    return "penalty";
  }
  return "other";
}

export function isPerformanceExternalRewardCategory(category) {
  return (
    category === "card_cashback" ||
    category === "external_reward" ||
    category === "referral_reward" ||
    category === "campaign_reward"
  );
}

/**
 * Sum the parts of provider-reported realized cash gain without conflating
 * external promotional/referral rewards with investment performance.
 *
 * Rows: { kind, amountCzk, category? }
 */
export function summarizeInvestownPerformance(rows) {
  let interestCzk = 0;
  let externalRewardsCzk = 0;
  let otherInvestmentIncomeCzk = 0;
  let feesCzk = 0;

  for (const row of rows || []) {
    const amount = Number(row?.amountCzk);
    if (!Number.isFinite(amount)) continue;

    const kind = String(row?.kind || "");
    const category = String(row?.category || "");

    if (kind === "interest") {
      interestCzk += amount;
    } else if (kind === "income") {
      if (isPerformanceExternalRewardCategory(category)) {
        externalRewardsCzk += amount;
      } else {
        otherInvestmentIncomeCzk += amount;
      }
    } else if (kind === "fee") {
      // Statement amounts are signed cash impacts. A normal fee is negative
      // and therefore increases net fee cost; a positive fee correction/refund
      // reduces it.
      feesCzk -= amount;
    }
  }

  const investmentPnlCzk =
    interestCzk + otherInvestmentIncomeCzk - feesCzk;
  const totalGainCzk = investmentPnlCzk + externalRewardsCzk;

  return {
    interestCzk,
    externalRewardsCzk,
    otherInvestmentIncomeCzk,
    feesCzk,
    investmentPnlCzk,
    totalGainCzk,
  };
}
