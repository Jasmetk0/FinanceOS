/**
 * Calendar-based ages for financial goals. Dates are YYYY-MM-DD and are
 * calculated in UTC, independent of the machine's timezone and DST.
 * Feb 29 birthdays are celebrated on Feb 28 in non-leap years.
 */
function parts(value: string): [number, number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const actual = new Date(Date.UTC(year, month - 1, day));
  return actual.getUTCFullYear() === year &&
    actual.getUTCMonth() === month - 1 &&
    actual.getUTCDate() === day ? [year, month, day] : null;
}

export function isCalendarDate(value: string): boolean {
  return parts(value) !== null;
}

export function isValidBirthDate(value: string, today: string): boolean {
  const birthday = parts(value);
  const reference = parts(today);
  return Boolean(birthday && reference && birthday[0] >= 1900 &&
    value <= today);
}

export function birthdayAtAge(birthDate: string, age: number): string {
  const birth = parts(birthDate);
  if (!birth || !Number.isInteger(age) || age < 0 || age > 150) {
    throw new RangeError("Neplatné datum narození nebo cílový věk.");
  }
  const year = birth[0] + age;
  const month = birth[1];
  const day = month === 2 && birth[2] === 29 &&
    !isCalendarDate(String(year).padStart(4, "0") + "-02-29")
    ? 28 : birth[2];
  return [String(year).padStart(4, "0"), String(month).padStart(2, "0"),
    String(day).padStart(2, "0")].join("-");
}

export function ageOnDate(birthDate: string, date: string): number {
  const birth = parts(birthDate);
  const current = parts(date);
  if (!birth || !current || date < birthDate) {
    throw new RangeError("Neplatné datum při výpočtu věku.");
  }
  let age = current[0] - birth[0];
  if (date < birthdayAtAge(birthDate, age)) age--;
  return age;
}

/** Count month-end contributions due before the target day (rounded up).
 * A partial final month is included and explicitly labelled an approximation. */
export function monthsUntilDate(fromDate: string, toDate: string): number {
  const from = parts(fromDate);
  const to = parts(toDate);
  if (!from || !to || toDate < fromDate) {
    throw new RangeError("Cílový den musí být dnes nebo v budoucnosti.");
  }
  const calendarMonths = (to[0] - from[0]) * 12 + to[1] - from[1];
  return Math.max(0, calendarMonths + (to[2] > from[2] ? 1 : 0));
}

export function monthsUntilAge(birthDate: string, age: number, today: string): number {
  return monthsUntilDate(today, birthdayAtAge(birthDate, age));
}
