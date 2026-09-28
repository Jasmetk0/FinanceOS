type Rates = Record<string, number>;

let cache: { fetchedAt: number; rates: Rates } | null = null;

const CACHE_MS = 30 * 60 * 1000;
const CNB_URL =
  "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt";

function parseCnb(text: string): Rates {
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

export async function getCzkRates(): Promise<Rates> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return cache.rates;
  }

  const response = await fetch(CNB_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CNB FX request failed with ${response.status}.`);
  }

  const rates = parseCnb(await response.text());
  cache = { fetchedAt: Date.now(), rates };
  return rates;
}

export async function toCzk(amount: number, currency: string): Promise<number> {
  const code = currency.toUpperCase();
  if (code === "CZK") return amount;

  const rates = await getCzkRates();
  const rate = rates[code];
  if (!rate) {
    throw new Error(`Missing CZK exchange rate for ${code}.`);
  }
  return amount * rate;
}

export async function maybeToCzk(
  amount: number,
  currency: string,
): Promise<number | null> {
  try {
    return await toCzk(amount, currency);
  } catch {
    return null;
  }
}
