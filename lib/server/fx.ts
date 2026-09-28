type Rates = Record<string, number>;
type YearRates = Map<string, Rates>;

const CURRENT_CACHE_MS = 30 * 60 * 1000;
const CNB_BASE =
  "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing";

let currentCache: { fetchedAt: number; rates: Rates } | null = null;
const yearCache = new Map<number, Promise<YearRates>>();

function parseDaily(text: string): Rates {
  const lines = text.trim().split(/\r?\n/);
  const rates: Rates = { CZK: 1 };

  for (const line of lines.slice(2)) {
    const [country, currency, amountRaw, code, rateRaw] = line.split("|");
    if (!country || !currency || !amountRaw || !code || !rateRaw) continue;

    const amount = Number(amountRaw.replace(",", "."));
    const rate = Number(rateRaw.replace(",", "."));
    if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0) continue;

    rates[code.toUpperCase()] = rate / amount;
  }

  return rates;
}

function parseCnbDate(raw: string): string | null {
  const value = raw.trim();

  const numeric = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (numeric) {
    const [, day, month, year] = numeric;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const named = value.match(/^(\d{1,2})\.([A-Za-z]{3})\.(\d{4})$/);
  if (!named) return null;

  const [, day, monthName, year] = named;
  const months: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const month = months[
    monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()
  ];
  return month ? `${year}-${month}-${day.padStart(2, "0")}` : null;
}

function parseYear(text: string): YearRates {
  const result: YearRates = new Map();
  let header: Array<{ code: string; amount: number }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("Date|")) {
      header = line
        .split("|")
        .slice(1)
        .map((column) => {
          const match = column.trim().match(/^(\d+)\s+([A-Z]{3})$/);
          return {
            amount: match ? Number(match[1]) : 1,
            code: match ? match[2] : "",
          };
        });
      continue;
    }

    if (!header.length) continue;
    const cells = line.split("|");
    const date = parseCnbDate(cells[0] ?? "");
    if (!date) continue;

    const rates: Rates = { CZK: 1 };
    for (let index = 0; index < header.length; index += 1) {
      const { code, amount } = header[index];
      if (!code || !amount) continue;
      const rawRate = cells[index + 1];
      if (!rawRate) continue;
      const rate = Number(rawRate.replace(",", "."));
      if (!Number.isFinite(rate)) continue;
      rates[code] = rate / amount;
    }

    result.set(date, rates);
  }

  return result;
}

async function fetchYear(year: number): Promise<YearRates> {
  const existing = yearCache.get(year);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(`${CNB_BASE}/year.txt?year=${year}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`CNB yearly FX request failed with ${response.status}.`);
    }
    return parseYear(await response.text());
  })();

  yearCache.set(year, promise);
  try {
    return await promise;
  } catch (error) {
    yearCache.delete(year);
    throw error;
  }
}

function isoDate(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date for FX conversion.");
  }
  return date.toISOString().slice(0, 10);
}

function previousDate(date: string): string {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function historicalRates(at: string | Date): Promise<Rates> {
  const target = isoDate(at);
  let cursor = target;

  // CNB rates remain valid across weekends/holidays. Search backwards for the
  // most recently published fixing, crossing into the previous year if needed.
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const year = Number(cursor.slice(0, 4));
    const rates = await fetchYear(year);
    const exact = rates.get(cursor);
    if (exact) return exact;
    cursor = previousDate(cursor);
  }

  throw new Error(`No CNB fixing found near ${target}.`);
}

export async function getCzkRates(at?: string | Date): Promise<Rates> {
  if (at) return historicalRates(at);

  if (
    currentCache &&
    Date.now() - currentCache.fetchedAt < CURRENT_CACHE_MS
  ) {
    return currentCache.rates;
  }

  const response = await fetch(`${CNB_BASE}/daily.txt`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`CNB FX request failed with ${response.status}.`);
  }

  const rates = parseDaily(await response.text());
  currentCache = { fetchedAt: Date.now(), rates };
  return rates;
}

export async function toCzk(
  amount: number,
  currency: string,
  at?: string | Date,
): Promise<number> {
  const code = currency.toUpperCase();
  if (code === "CZK") return amount;

  const rates = await getCzkRates(at);
  const rate = rates[code];
  if (!rate) {
    throw new Error(
      `Missing CZK exchange rate for ${code}${at ? ` at ${isoDate(at)}` : ""}.`,
    );
  }
  return amount * rate;
}

export async function maybeToCzk(
  amount: number,
  currency: string,
  at?: string | Date,
): Promise<number | null> {
  try {
    return await toCzk(amount, currency, at);
  } catch {
    return null;
  }
}
