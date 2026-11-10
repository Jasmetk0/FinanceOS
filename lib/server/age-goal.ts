import { getDb } from "@/lib/server/db";
import { ageOnDate, isValidBirthDate, monthsUntilAge } from "@/lib/simulator/age";

export interface AgeGoalSettings {
  birthDate: string | null;
  targetAge: number | null;
  targetMonthlyIncomeCzk: number | null;
  withdrawalRatePct: number | null;
}

const BIRTH_KEY = "user_birth_date";
const AGE_KEY = "fire_target_age";
const INCOME_KEY = "fire_target_monthly_income_czk";
const WITHDRAWAL_KEY = "fire_withdrawal_rate_pct";

export function getAgeGoalSettings(): AgeGoalSettings {
  const rows = getDb().prepare(
    "SELECT key, value FROM plan_settings WHERE key IN (?, ?, ?, ?)",
  ).all(BIRTH_KEY, AGE_KEY, INCOME_KEY, WITHDRAWAL_KEY);
  const values = new Map<string, string>(rows.map((row): [string, string] =>
    [String(row.key), String(row.value)]));
  const rawAge = values.get(AGE_KEY);
  const targetAge = rawAge === undefined ? null : Number(rawAge);
  const income = values.has(INCOME_KEY) ? Number(values.get(INCOME_KEY)) : null;
  const withdrawal = values.has(WITHDRAWAL_KEY) ? Number(values.get(WITHDRAWAL_KEY)) : null;
  return {
    birthDate: values.get(BIRTH_KEY) || null,
    targetAge: targetAge !== null && Number.isInteger(targetAge) &&
      targetAge >= 1 && targetAge <= 120 ? targetAge : null,
    targetMonthlyIncomeCzk: income !== null && Number.isFinite(income) && income >= 0 ? income : null,
    withdrawalRatePct: withdrawal !== null && Number.isFinite(withdrawal) &&
      withdrawal > 0 && withdrawal <= 100 ? withdrawal : null,
  };
}

/** Only user profile/goal metadata; never alters investments or allocations. */
export function saveAgeGoalSettings(settings: AgeGoalSettings): AgeGoalSettings {
  const today = new Date().toISOString().slice(0, 10);
  if (settings.birthDate !== null &&
      (typeof settings.birthDate !== "string" ||
       !isValidBirthDate(settings.birthDate, today))) {
    throw new RangeError("Zadej skutečné datum narození, které není v budoucnosti.");
  }
  if (settings.targetAge !== null &&
      (!Number.isInteger(settings.targetAge) ||
       settings.targetAge < 1 || settings.targetAge > 120)) {
    throw new RangeError("Cílový věk musí být celé číslo od 1 do 120.");
  }
  if (settings.targetMonthlyIncomeCzk !== null &&
      (!Number.isFinite(settings.targetMonthlyIncomeCzk) ||
       settings.targetMonthlyIncomeCzk < 0 || settings.targetMonthlyIncomeCzk > 1_000_000_000)) {
    throw new RangeError("Cílový měsíční příjem musí být nezáporný a nejvýše 1 miliarda Kč.");
  }
  if (settings.withdrawalRatePct !== null &&
      (!Number.isFinite(settings.withdrawalRatePct) ||
       settings.withdrawalRatePct <= 0 || settings.withdrawalRatePct > 100)) {
    throw new RangeError("Roční míra výběru musí být větší než 0 % a nejvýše 100 %.");
  }
  if (settings.birthDate !== null && settings.targetAge !== null) {
    const currentAge = ageOnDate(settings.birthDate, today);
    if (settings.targetAge <= currentAge ||
        monthsUntilAge(settings.birthDate, settings.targetAge, today) > 1200) {
      throw new RangeError("Cíl musí ležet v budoucnosti a nejvýše 100 let od dneška.");
    }
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const [key, value] of [
      [BIRTH_KEY, settings.birthDate],
      [AGE_KEY, settings.targetAge === null ? null : String(settings.targetAge)],
      [INCOME_KEY, settings.targetMonthlyIncomeCzk === null ? null : String(settings.targetMonthlyIncomeCzk)],
      [WITHDRAWAL_KEY, settings.withdrawalRatePct === null ? null : String(settings.withdrawalRatePct)],
    ] as Array<[string, string | null]>) {
      if (value === null) {
        db.prepare("DELETE FROM plan_settings WHERE key = ?").run(key);
      } else {
        db.prepare(
          "INSERT INTO plan_settings(key, value, updated_at) VALUES(?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        ).run(key, value, now);
      }
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getAgeGoalSettings();
}
