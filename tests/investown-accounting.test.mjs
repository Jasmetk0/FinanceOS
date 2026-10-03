import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyInvestownKind,
  investownIncomeCategory,
  investownPrincipalDelta,
  investownReservationDelta,
  isPerformanceExternalRewardCategory,
  summarizeInvestownPerformance,
} from "../lib/investown-semantics.mjs";

test("Investown recognizes every currently observed statement transaction family", () => {
  const expected = new Map([
    ["Vklad peněz", "deposit"],
    ["Výběr peněz", "withdrawal"],
    ["Výnos", "interest"],
    ["Částečný výnos", "interest"],
    ["Bonusový výnos", "interest"],
    ["Smluvní pokuta", "interest"],
    ["Smluvní pokuta z prodlení", "interest"],
    ["Zákonné úroky z prodlení", "interest"],
    ["Zákonný úrok z prodlení", "interest"],
    ["Odměna", "income"],
    ["Investice", "transfer"],
    ["Autoinvestice", "transfer"],
    ["Nabídka ke koupi", "transfer"],
    ["Vrácení nabídky", "transfer"],
    ["Splacení jistiny", "transfer"],
    ["Částečné splacení jistiny", "transfer"],
    ["Odstoupení", "transfer"],
  ]);

  for (const [type, kind] of expected) {
    assert.equal(
      classifyInvestownKind({ type }),
      kind,
      type + " should classify as " + kind,
    );
  }

  // Provider wording can evolve. Safe semantic fallbacks remain recognized,
  // while genuinely unknown rows stay visible for audit.
  assert.equal(
    classifyInvestownKind({ type: "Smluvní pokuta za prodlení partnera" }),
    "interest",
  );
  assert.equal(
    classifyInvestownKind({ type: "Poplatek za službu" }),
    "fee",
  );
  assert.equal(
    classifyInvestownKind({ type: "Úplně nový nepopsaný typ" }),
    "adjustment",
  );
});

test("Investown referral and campaign rewards are external rewards, not investment return", () => {
  assert.equal(
    investownIncomeCategory({
      type: "Odměna",
      description: "Referral bonus",
    }),
    "referral_reward",
  );
  assert.equal(
    investownIncomeCategory({
      type: "Odměna",
      description: "Promo kampaň",
    }),
    "campaign_reward",
  );
  assert.equal(
    investownIncomeCategory({
      type: "Odměna",
      description: "Jiná odměna",
    }),
    "external_reward",
  );

  for (const category of [
    "card_cashback",
    "external_reward",
    "referral_reward",
    "campaign_reward",
  ]) {
    assert.equal(isPerformanceExternalRewardCategory(category), true);
  }
  assert.equal(isPerformanceExternalRewardCategory("interest"), false);
});

test("Investown principal and secondary-market reservation movements are internal", () => {
  assert.equal(
    investownPrincipalDelta({ type: "Investice", amount: -1_000 }),
    1_000,
  );
  assert.equal(
    investownPrincipalDelta({ type: "Autoinvestice", amount: -750 }),
    750,
  );
  assert.equal(
    investownPrincipalDelta({ type: "Splacení jistiny", amount: 400 }),
    -400,
  );
  assert.equal(
    investownPrincipalDelta({
      type: "Částečné splacení jistiny",
      amount: 125.5,
    }),
    -125.5,
  );
  assert.equal(
    investownPrincipalDelta({ type: "Odstoupení", amount: 200 }),
    -200,
  );
  assert.equal(
    investownPrincipalDelta({ type: "Splacení jistiny", amount: -400 }),
    400,
    "negative repayment correction restores principal",
  );

  assert.equal(
    investownReservationDelta({ type: "Nabídka ke koupi", amount: -300 }),
    300,
  );
  assert.equal(
    investownReservationDelta({ type: "Vrácení nabídky", amount: 300 }),
    -300,
  );
  assert.equal(
    investownReservationDelta({ type: "Vrácení nabídky", amount: -300 }),
    300,
    "negative unlock correction restores reservation",
  );
});

test("Investown accounting keeps investment P/L, external rewards and total gain separate", () => {
  const summary = summarizeInvestownPerformance([
    { kind: "interest", amountCzk: 100, category: "Výnos" },
    { kind: "interest", amountCzk: 5, category: "Bonusový výnos" },
    { kind: "income", amountCzk: 1_000, category: "referral_reward" },
    { kind: "income", amountCzk: 1_000, category: "referral_reward" },
    { kind: "income", amountCzk: 50, category: "campaign_reward" },
    { kind: "fee", amountCzk: -4, category: "Poplatek" },
  ]);

  assert.deepEqual(summary, {
    interestCzk: 105,
    externalRewardsCzk: 2_050,
    otherInvestmentIncomeCzk: 0,
    feesCzk: 4,
    investmentPnlCzk: 101,
    totalGainCzk: 2_151,
  });
});

test("Investown non-promotional income can contribute to investment P/L", () => {
  const summary = summarizeInvestownPerformance([
    { kind: "interest", amountCzk: 25, category: "Výnos" },
    { kind: "income", amountCzk: 10, category: "other_investment_income" },
    { kind: "fee", amountCzk: -2, category: "fee" },
  ]);

  assert.equal(summary.externalRewardsCzk, 0);
  assert.equal(summary.otherInvestmentIncomeCzk, 10);
  assert.equal(summary.feesCzk, 2);
  assert.equal(summary.investmentPnlCzk, 33);
  assert.equal(summary.totalGainCzk, 33);

  const refund = summarizeInvestownPerformance([
    { kind: "interest", amountCzk: 25, category: "Výnos" },
    { kind: "fee", amountCzk: 3, category: "fee" },
  ]);
  assert.equal(refund.feesCzk, -3);
  assert.equal(refund.investmentPnlCzk, 28);
});


test("Investown full-statement aggregate keeps penalties positive and referral rewards separate", () => {
  const summary = summarizeInvestownPerformance([
    { kind: "interest", amountCzk: 3506.90, category: "Výnos" },
    { kind: "interest", amountCzk: 18.23, category: "Částečný výnos" },
    { kind: "interest", amountCzk: 123.94, category: "Bonusový výnos" },
    { kind: "interest", amountCzk: 9.45, category: "Smluvní pokuta" },
    { kind: "interest", amountCzk: 1.37, category: "Zákonné úroky z prodlení" },
    { kind: "income", amountCzk: 1000, category: "referral_reward" },
    { kind: "income", amountCzk: 1000, category: "referral_reward" },
  ]);

  assert.equal(summary.interestCzk, 3659.89);
  assert.equal(summary.investmentPnlCzk, 3659.89);
  assert.equal(summary.externalRewardsCzk, 2000);
  assert.equal(summary.totalGainCzk, 5659.89);

  const ownerCapitalCzk = 63293.43 - 10317.88;
  const expectedValueCzk = ownerCapitalCzk + summary.totalGainCzk;
  assert.equal(Number(ownerCapitalCzk.toFixed(2)), 52975.55);
  assert.equal(Number(expectedValueCzk.toFixed(2)), 58635.44);
});
