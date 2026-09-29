import { getDb } from "@/lib/server/db";
import { maybeToCzk } from "@/lib/server/fx";
import { upsertTransaction } from "@/lib/server/repository";

type JsonObject = Record<string, unknown>;

interface Trading212CardCredentials {
  apiKey: string;
  apiSecret: string;
}

interface Trading212ExportReport {
  reportId: number;
  status: "Queued" | "Processing" | "Running" | "Canceled" | "Failed" | "Finished";
  downloadLink?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  dataIncluded?: {
    includeDividends?: boolean;
    includeInterest?: boolean;
    includeOrders?: boolean;
    includeTransactions?: boolean;
  };
}

interface PendingReport {
  reportId: number;
  timeFrom: string;
  timeTo: string;
  historical: boolean;
}

const PROVIDER = "trading212";
const PENDING_KEY = "card_export_pending";
const CURSOR_KEY = "card_export_cursor";
const LAST_REFRESH_KEY = "card_export_last_refresh";
const LAST_ERROR_KEY = "card_export_last_error";
const CARD_DETECTED_KEY = "card_detected";
const REPORT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000;

function baseUrl(environment: string) {
  return environment === "demo"
    ? "https://demo.trading212.com/api/v0"
    : "https://live.trading212.com/api/v0";
}

function authHeader(credentials: Trading212CardCredentials) {
  return `Basic ${Buffer.from(
    `${credentials.apiKey}:${credentials.apiSecret}`,
    "utf8",
  ).toString("base64")}`;
}

async function apiJson<T>(
  environment: string,
  credentials: Trading212CardCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl(environment)}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(credentials),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Trading 212 card export request failed (${response.status}): ${detail || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

function getState(key: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT value FROM provider_sync_state WHERE provider = ? AND key = ?",
    )
    .get(PROVIDER, key);
  return row?.value === null || row?.value === undefined
    ? null
    : String(row.value);
}

function setState(key: string, value: string) {
  getDb()
    .prepare(`
      INSERT INTO provider_sync_state(provider, key, value, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(provider, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(PROVIDER, key, value, new Date().toISOString());
}

function deleteState(key: string) {
  getDb()
    .prepare(
      "DELETE FROM provider_sync_state WHERE provider = ? AND key = ?",
    )
    .run(PROVIDER, key);
}

function parsePending(value: string | null): PendingReport | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingReport>;
    if (
      typeof parsed.reportId !== "number" ||
      typeof parsed.timeFrom !== "string" ||
      typeof parsed.timeTo !== "string"
    ) {
      return null;
    }
    return {
      reportId: parsed.reportId,
      timeFrom: parsed.timeFrom,
      timeTo: parsed.timeTo,
      historical: Boolean(parsed.historical),
    };
  } catch {
    return null;
  }
}

export function parseTrading212Csv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const header = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!header.length) return [];

  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(
        header.map((name, index) => [name, values[index] ?? ""]),
      ),
    );
}

function lookup(row: Record<string, string>, names: string[]): string {
  const map = new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]),
  );
  for (const name of names) {
    const found = map.get(name.toLowerCase());
    if (found !== undefined && found !== "") return found;
  }
  return "";
}

function parseNumber(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function monetaryValue(
  row: Record<string, string>,
  accountCurrency: string,
): { amount: number; currency: string } | null {
  const entries = Object.entries(row);
  const preferred = [
    entries.find(([key]) => key.toLowerCase() === `total (${accountCurrency.toLowerCase()})`),
    entries.find(([key]) => key.toLowerCase() === "net total"),
    entries.find(([key]) => /^total \([a-z]{3}\)$/i.test(key)),
    entries.find(([key]) => key.toLowerCase() === "gross total"),
    entries.find(([key]) => key.toLowerCase() === "total"),
    entries.find(([key]) => key.toLowerCase() === "amount"),
  ].find(Boolean);

  if (!preferred) return null;
  const [key, raw] = preferred;
  const amount = parseNumber(raw);
  if (amount === null) return null;

  let currency = accountCurrency;
  const inHeader = key.match(/\(([A-Za-z]{3})\)$/);
  if (inHeader) {
    currency = inHeader[1].toUpperCase();
  } else if (key.toLowerCase() === "net total") {
    currency =
      lookup(row, ["Currency (Net Total)", "Currency"]) || accountCurrency;
  } else if (key.toLowerCase() === "gross total") {
    currency =
      lookup(row, ["Currency (Gross Total)", "Currency"]) || accountCurrency;
  }

  return { amount, currency: currency.toUpperCase() };
}

function normalizeAction(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeOccurredAt(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const isoLike = raw.replace(" ", "T");
  const parsed = new Date(isoLike.endsWith("Z") ? isoLike : isoLike + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeJson(value: unknown): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function cardClassification(actionRaw: string, merchantCategory: string) {
  const action = normalizeAction(actionRaw);
  const categorySlug = slug(merchantCategory) || "uncategorized";

  if (action === "card debit") {
    return {
      kind: "withdrawal",
      flowScope: "external",
      category: `card_spend:${categorySlug}`,
      direction: -1,
      cardEvidence: true,
    } as const;
  }
  if (action === "card credit") {
    return {
      kind: "deposit",
      flowScope: "external",
      category: `card_refund:${categorySlug}`,
      direction: 1,
      cardEvidence: true,
    } as const;
  }
  if (action === "spending cashback") {
    return {
      kind: "income",
      flowScope: "not_applicable",
      category: "card_cashback",
      direction: 1,
      cardEvidence: true,
    } as const;
  }
  if (action === "deposit") {
    return {
      kind: "deposit",
      flowScope: "external",
      category: "external_deposit",
      direction: 1,
      cardEvidence: false,
    } as const;
  }
  if (action === "withdrawal") {
    return {
      kind: "withdrawal",
      flowScope: "external",
      category: "external_withdrawal",
      direction: -1,
      cardEvidence: false,
    } as const;
  }
  if (action === "transfer in" || action === "transfer out") {
    return {
      kind: "transfer",
      flowScope: "internal",
      category: "pot_transfer",
      direction: action === "transfer in" ? 1 : -1,
      cardEvidence: true,
    } as const;
  }
  if (action === "interest on cash" || action === "lending interest") {
    return {
      kind: "interest",
      flowScope: "not_applicable",
      category: action.replace(/ /g, "_"),
      direction: 1,
      cardEvidence: false,
    } as const;
  }
  if (action === "new card cost") {
    return {
      kind: "fee",
      flowScope: "not_applicable",
      category: "card_fee",
      direction: -1,
      cardEvidence: true,
    } as const;
  }
  if (action === "currency conversion") {
    return {
      kind: "transfer",
      flowScope: "internal",
      category: "currency_conversion",
      direction: 0,
      cardEvidence: false,
    } as const;
  }

  return null;
}

function findExistingTransaction(
  id: string,
  classification: NonNullable<ReturnType<typeof cardClassification>>,
  occurredAt: string | null,
  amountCzk: number | null,
) {
  const db = getDb();

  if (id) {
    const exact = db
      .prepare(
        "SELECT * FROM transactions WHERE provider = 'trading212' " +
          "AND external_id IN (?, ?) LIMIT 1",
      )
      .get("cash:" + id, "card-export:" + id);
    if (exact) return exact;
  }

  if (!occurredAt || amountCzk === null) return null;
  const day = occurredAt.slice(0, 10);
  const kindCandidates =
    classification.kind === "income"
      ? ["deposit", "income"]
      : [classification.kind];
  const placeholders = kindCandidates.map(() => "?").join(",");

  const candidates = db
    .prepare(
      "SELECT * FROM transactions WHERE provider = 'trading212' " +
        `AND kind IN (${placeholders}) ` +
        "AND substr(occurred_at, 1, 10) = ? " +
        "AND amount_czk IS NOT NULL " +
        "AND ABS(ABS(amount_czk) - ?) <= 0.02 " +
        "ORDER BY occurred_at ASC LIMIT 3",
    )
    .all(...kindCandidates, day, Math.abs(amountCzk));

  return candidates.length === 1 ? candidates[0] : null;
}

async function enrichReportRows(input: {
  text: string;
  accountId: string;
  accountCurrency: string;
  reportId: number;
}) {
  const rows = parseTrading212Csv(input.text);
  let enriched = 0;
  let inserted = 0;
  let cardRows = 0;
  let cashbackRows = 0;

  for (const row of rows) {
    const actionRaw = lookup(row, ["Action", "Type"]);
    const merchant = lookup(row, ["Merchant name", "Merchant"]);
    const merchantCategory = lookup(row, ["Merchant category", "Category"]);
    const classification = cardClassification(actionRaw, merchantCategory);
    if (!classification) continue;

    const money = monetaryValue(row, input.accountCurrency);
    if (!money) continue;
    const occurredAt = normalizeOccurredAt(lookup(row, ["Time", "Date", "DateTime"]));
    const id = lookup(row, ["ID", "Id", "Reference", "Transaction ID"]);
    const signedAmount =
      classification.direction === 0
        ? money.amount
        : classification.direction * Math.abs(money.amount);
    const amountCzk = await maybeToCzk(
      signedAmount,
      money.currency,
      occurredAt || new Date().toISOString(),
    );

    if (classification.cardEvidence) cardRows += 1;
    if (classification.category === "card_cashback") cashbackRows += 1;

    const existing = findExistingTransaction(
      id,
      classification,
      occurredAt,
      amountCzk,
    );

    const cardMetadata = {
      reportId: input.reportId,
      action: actionRaw,
      merchant: merchant || null,
      merchantCategory: merchantCategory || null,
      csvId: id || null,
    };

    if (existing) {
      const raw = safeJson(existing.raw_json);
      getDb()
        .prepare(`
          UPDATE transactions
          SET kind = ?,
              flow_scope = ?,
              category = ?,
              source_label = ?,
              counterparty_ref = ?,
              raw_json = ?
          WHERE id = ?
        `)
        .run(
          classification.kind,
          classification.flowScope,
          classification.category,
          merchant || "Trading 212",
          merchant || merchantCategory || null,
          JSON.stringify({
            ...raw,
            financeOsCardExport: cardMetadata,
          }),
          String(existing.id),
        );
      enriched += 1;
      continue;
    }

    if (!id || !occurredAt) continue;

    upsertTransaction({
      provider: "trading212",
      accountId: input.accountId,
      externalId: "card-export:" + id,
      kind: classification.kind,
      occurredAt,
      currency: money.currency,
      amount: signedAmount,
      amountCzk,
      note: merchant || actionRaw,
      category: classification.category,
      sourceLabel: merchant || "Trading 212",
      flowScope: classification.flowScope,
      counterpartyRef: merchant || merchantCategory || null,
      raw: {
        importedFromTrading212CsvExport: true,
        financeOsCardExport: cardMetadata,
        csv: row,
      },
    });
    inserted += 1;
  }

  if (cardRows > 0) setState(CARD_DETECTED_KEY, "true");

  return {
    parsedRows: rows.length,
    enriched,
    inserted,
    cardRows,
    cashbackRows,
  };
}

async function downloadCsv(
  url: string,
  credentials: Trading212CardCredentials,
) {
  let response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: authHeader(credentials) },
    });
  }
  if (!response.ok) {
    throw new Error(
      `Trading 212 CSV download failed (${response.status}): ${response.statusText}`,
    );
  }
  return response.text();
}

async function requestExport(input: {
  environment: string;
  credentials: Trading212CardCredentials;
  timeFrom: string;
  timeTo: string;
  historical: boolean;
}) {
  const result = await apiJson<{ reportId: number }>(
    input.environment,
    input.credentials,
    "/equity/history/exports",
    {
      method: "POST",
      body: JSON.stringify({
        dataIncluded: {
          includeDividends: false,
          includeInterest: false,
          includeOrders: false,
          includeTransactions: true,
        },
        timeFrom: input.timeFrom,
        timeTo: input.timeTo,
      }),
    },
  );

  const pending: PendingReport = {
    reportId: Number(result.reportId),
    timeFrom: input.timeFrom,
    timeTo: input.timeTo,
    historical: input.historical,
  };
  setState(PENDING_KEY, JSON.stringify(pending));
  deleteState(LAST_ERROR_KEY);
  return pending;
}

async function syncTrading212CardHistoryInternal(input: {
  environment: string;
  credentials: Trading212CardCredentials;
  accountId: string;
  accountCurrency: string;
}) {
  const pending = parsePending(getState(PENDING_KEY));

  if (pending) {
    const reports = await apiJson<Trading212ExportReport[]>(
      input.environment,
      input.credentials,
      "/equity/history/exports",
    );
    const report = reports.find(
      (item) => Number(item.reportId) === pending.reportId,
    );

    if (!report) {
      deleteState(PENDING_KEY);
      setState(
        LAST_ERROR_KEY,
        "Pending Trading 212 card export report is no longer listed.",
      );
      return { status: "missing-report" as const };
    }

    if (report.status === "Failed" || report.status === "Canceled") {
      deleteState(PENDING_KEY);
      setState(
        LAST_ERROR_KEY,
        `Trading 212 card export ended with status ${report.status}.`,
      );
      return { status: "failed" as const, reportStatus: report.status };
    }

    if (report.status !== "Finished" || !report.downloadLink) {
      return {
        status: "waiting" as const,
        reportStatus: report.status,
        reportId: pending.reportId,
      };
    }

    const text = await downloadCsv(report.downloadLink, input.credentials);
    const imported = await enrichReportRows({
      text,
      accountId: input.accountId,
      accountCurrency: input.accountCurrency,
      reportId: pending.reportId,
    });

    if (pending.historical) {
      setState(CURSOR_KEY, pending.timeTo);
    }
    setState(LAST_REFRESH_KEY, new Date().toISOString());
    deleteState(PENDING_KEY);
    deleteState(LAST_ERROR_KEY);

    return {
      status: "processed" as const,
      reportId: pending.reportId,
      ...imported,
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  let cursor = getState(CURSOR_KEY);

  if (!cursor) {
    const earliest = getDb()
      .prepare(`
        SELECT MIN(occurred_at) AS occurred_at
        FROM transactions
        WHERE provider = 'trading212'
          AND kind IN ('deposit', 'withdrawal')
      `)
      .get();
    cursor = earliest?.occurred_at ? String(earliest.occurred_at) : nowIso;
    setState(CURSOR_KEY, cursor);
  }

  const cursorDate = new Date(cursor);
  const historical = !Number.isNaN(cursorDate.getTime())
    && cursorDate.getTime() < now.getTime() - 24 * 60 * 60 * 1000;

  if (historical) {
    const timeTo = new Date(
      Math.min(cursorDate.getTime() + REPORT_WINDOW_MS, now.getTime()),
    ).toISOString();
    const requested = await requestExport({
      environment: input.environment,
      credentials: input.credentials,
      timeFrom: cursorDate.toISOString(),
      timeTo,
      historical: true,
    });
    return {
      status: "requested" as const,
      reportId: requested.reportId,
      timeFrom: requested.timeFrom,
      timeTo: requested.timeTo,
    };
  }

  const lastRefresh = getState(LAST_REFRESH_KEY);
  const lastRefreshMs = lastRefresh ? new Date(lastRefresh).getTime() : 0;
  if (
    Number.isFinite(lastRefreshMs) &&
    lastRefreshMs > 0 &&
    now.getTime() - lastRefreshMs < REFRESH_MS
  ) {
    return { status: "current" as const };
  }

  const requested = await requestExport({
    environment: input.environment,
    credentials: input.credentials,
    timeFrom: new Date(now.getTime() - REFRESH_OVERLAP_MS).toISOString(),
    timeTo: nowIso,
    historical: false,
  });

  return {
    status: "requested" as const,
    reportId: requested.reportId,
    timeFrom: requested.timeFrom,
    timeTo: requested.timeTo,
  };
}

export async function syncTrading212CardHistory(input: {
  environment: string;
  credentials: Trading212CardCredentials;
  accountId: string;
  accountCurrency: string;
}) {
  try {
    return await syncTrading212CardHistoryInternal(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState(LAST_ERROR_KEY, message);
    return {
      status: "error" as const,
      error: message,
    };
  }
}

export function hasTrading212CardEvidence() {
  if (getState(CARD_DETECTED_KEY) === "true") return true;
  const row = getDb()
    .prepare(`
      SELECT 1
      FROM transactions
      WHERE provider = 'trading212'
        AND (
          category LIKE 'card_spend:%'
          OR category LIKE 'card_refund:%'
          OR category IN ('card_cashback', 'card_fee')
        )
      LIMIT 1
    `)
    .get();
  return Boolean(row);
}

export function getTrading212CardStatus() {
  const db = getDb();
  const account = db
    .prepare(`
      SELECT id, raw_json, currency, cash_value_czk, reconciliation_status
      FROM accounts
      WHERE provider = 'trading212' AND type = 'brokerage'
      LIMIT 1
    `)
    .get();

  const stats = db
    .prepare(`
      SELECT
        SUM(CASE WHEN category LIKE 'card_spend:%' THEN ABS(COALESCE(amount_czk, 0)) ELSE 0 END) AS spend,
        SUM(CASE WHEN category LIKE 'card_refund:%' THEN ABS(COALESCE(amount_czk, 0)) ELSE 0 END) AS refunds,
        SUM(CASE WHEN category = 'card_cashback' THEN ABS(COALESCE(amount_czk, 0)) ELSE 0 END) AS cashback,
        SUM(CASE WHEN category LIKE 'card_spend:%' THEN 1 ELSE 0 END) AS spend_count,
        SUM(CASE WHEN category = 'card_cashback' THEN 1 ELSE 0 END) AS cashback_count,
        MIN(CASE WHEN category LIKE 'card_spend:%' THEN occurred_at END) AS first_card_at,
        MAX(CASE WHEN category LIKE 'card_spend:%' THEN occurred_at END) AS last_card_at
      FROM transactions
      WHERE provider = 'trading212'
    `)
    .get();

  let spendingPotCzk: number | null = null;
  if (account?.raw_json) {
    const raw = safeJson(account.raw_json);
    const reconciliation = safeJson(raw.financeOsReconciliation);
    const spendingPot = safeJson(reconciliation.spendingPot);
    const parsed = Number(spendingPot.valueCzk);
    if (Number.isFinite(parsed)) spendingPotCzk = parsed;
  }

  const spendCzk = Number(stats?.spend) || 0;
  const refundsCzk = Number(stats?.refunds) || 0;
  const cashbackCzk = Number(stats?.cashback) || 0;
  const netSpendCzk = Math.max(0, spendCzk - refundsCzk);

  return {
    detected: hasTrading212CardEvidence(),
    spendingPotCzk,
    spendCzk,
    refundsCzk,
    netSpendCzk,
    cashbackCzk,
    effectiveCashbackPct:
      netSpendCzk > 0 ? (cashbackCzk / netSpendCzk) * 100 : null,
    spendCount: Number(stats?.spend_count) || 0,
    cashbackCount: Number(stats?.cashback_count) || 0,
    firstCardAt: stats?.first_card_at ? String(stats.first_card_at) : null,
    lastCardAt: stats?.last_card_at ? String(stats.last_card_at) : null,
    pending: parsePending(getState(PENDING_KEY)),
    coverageCursor: getState(CURSOR_KEY),
    lastRefreshAt: getState(LAST_REFRESH_KEY),
    lastError: getState(LAST_ERROR_KEY),
    accountCurrency: account?.currency ? String(account.currency) : null,
    reconciliationStatus: account?.reconciliation_status
      ? String(account.reconciliation_status)
      : null,
  };
}
