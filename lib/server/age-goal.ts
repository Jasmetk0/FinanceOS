import { getDb } from "@/lib/server/db";
import { ageOnDate, isValidBirthDate, monthsUntilAge } from "@/lib/simulator/age";

export interface AgeGoalSettings {
  birthDate: string | null;
  targetAge: number | null;
}

const BIRTH_KEY = "user_birth_date";
const AGE_KEY = "fire_target_age";

export function getAgeGoalSettings(): AgeGoalSettings {
  const rows = getDb().prepare(
    "SELECT key, value FROM plan_settings WHERE key IN (?, ?)",
  ).all(BIRTH_KEY, AGE_KEY);
  const values = new Map(rows.map((row) => [String(row.key), String(row.value)]));
  const rawAge = values.get(AGE_KEY);
  const targetAge = rawAge === undefined ? null : Number(rawAge);
  return {
    birthDate: values.get(BIRTH_KEY) || null,
    targetAge: targetAge !== null && Number.isInteger(targetAge) &&
      targetAge >= 1 && targetAge <= 120 ? targetAge : null,
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
