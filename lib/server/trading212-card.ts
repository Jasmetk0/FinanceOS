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
const RETRY_AFTER_KEY = "card_export_retry_after";
const CARD_DETECTED_KEY = "card_detected";
const ACCOUNT_KEY = "card_account_id";
const ACTION_INVENTORY_KEY = "full_export_action_inventory";
const FALLBACK_HISTORY_WINDOW_MS = 364 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000;
const ERROR_BACKOFF_MS = 60 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 24 * 60 * 60 * 1000;

function retryDelayMs(message: string) {
  return message.includes("(429)") || message.includes("TooManyRequests")
    ? RATE_LIMIT_BACKOFF_MS
    : ERROR_BACKOFF_MS;
}

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
  } else if (key.toLowerCase() === "total") {
    currency =
      lookup(row, ["Currency (Total)", "Currency"]) || accountCurrency;
  } else if (key.toLowerCase() === "amount") {
    currency = lookup(row, ["Currency"]) || accountCurrency;
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
  const raw = value
    .trim()
    .replace(/\uFFFD(?=:\d{2}$)/, "+00");
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
  if (action.includes("cashback")) {
    return {
      kind: "income",
      // Cashback comes from outside the investment portfolio. Treat it as an
      // external reward flow for return attribution, while Cash Flow still
      // presents it as reward income rather than a user deposit.
      flowScope: "external",
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
  if (action.includes("transfer")) {
    const toCfd =
      action.includes("to cfd") ||
      action.includes("into cfd") ||
      action.includes("invest to cfd");
    const fromCfd =
      action.includes("from cfd") ||
      action.includes("cfd to invest") ||
      action.includes("from cfd account");
    const explicitIn =
      action === "transfer in" ||
      action.endsWith(" transfer in") ||
      action.includes("transfer into invest");
    const explicitOut =
      action === "transfer out" ||
      action.endsWith(" transfer out") ||
      action.includes("transfer from invest");

    const direction = fromCfd || explicitIn ? 1 : toCfd || explicitOut ? -1 : 0;
    return {
      kind: "transfer",
      flowScope: "internal",
      category:
        toCfd || fromCfd
          ? "internal_transfer:cfd"
          : "internal_transfer",
      direction,
      // Transfer labels are not card-specific enough to prove 212 Card usage.
      cardEvidence: false,
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

function nearestUnambiguousCandidate(
  candidates: Array<Record<string, unknown>>,
  occurredAt: string,
) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length < 2) return null;

  const firstAt = new Date(String(candidates[0].occurred_at)).getTime();
  const secondAt = new Date(String(candidates[1].occurred_at)).getTime();
  const target = new Date(occurredAt).getTime();
  const firstDistance = Math.abs(firstAt - target);
  const secondDistance = Math.abs(secondAt - target);

  // Only pick the nearest row when it is materially closer. Equal/similar
  // candidates remain unresolved instead of attaching provider metadata to the
  // wrong cash movement.
  return firstDistance + 60 * 60 * 1000 < secondDistance
    ? candidates[0]
    : null;
}

function findExistingTransaction(
  id: string,
  classification: NonNullable<ReturnType<typeof cardClassification>>,
  occurredAt: string | null,
  signedAmount: number,
  currency: string,
  amountCzk: number | null,
) {
  const db = getDb();

  if (id) {
    const exact = db
      .prepare(
        "SELECT * FROM transactions WHERE provider = 'trading212' " +
          "AND external_id = ? LIMIT 1",
      )
      .get("cash:" + id);
    if (exact) return exact;
  }

  if (!occurredAt) return null;
  const kindCandidates =
    classification.category === "card_cashback"
      ? ["deposit", "withdrawal", "income"]
      : classification.kind === "transfer"
        // The superficial history endpoint may expose an Invest↔CFD movement
        // as a generic deposit/withdrawal. The richer CSV label is allowed to
        // upgrade that row to an internal transfer when date+amount identify
        // exactly one candidate.
        ? ["transfer", "deposit", "withdrawal"]
        : classification.kind === "income"
          ? ["deposit", "income"]
          : [classification.kind];
  const placeholders = kindCandidates.map(() => "?").join(",");

  // Match the provider's native/account-currency amount first. The previous
  // implementation compared independently converted CZK values with a 0.02 Kč
  // tolerance. Historical FX rounding made legitimate CSV rows miss their
  // coarse API counterparts, leaving real deposits unresolved.
  const nativeTolerance = Math.max(0.02, Math.abs(signedAmount) * 0.000001);
  const nativeCandidates = db
    .prepare(
      "SELECT * FROM transactions WHERE provider = 'trading212' " +
        `AND kind IN (${placeholders}) ` +
        "AND julianday(occurred_at) BETWEEN julianday(?) - 1.5 AND julianday(?) + 1.5 " +
        "AND external_id NOT LIKE 'card-export:%' " +
        "AND amount IS NOT NULL " +
        "AND UPPER(currency) = UPPER(?) " +
        "AND ABS(ABS(amount) - ?) <= ? " +
        "ORDER BY ABS(julianday(occurred_at) - julianday(?)) ASC LIMIT 2",
    )
    .all(
      ...kindCandidates,
      occurredAt,
      occurredAt,
      currency,
      Math.abs(signedAmount),
      nativeTolerance,
      occurredAt,
    );
  const nativeMatch = nearestUnambiguousCandidate(
    nativeCandidates as Array<Record<string, unknown>>,
    occurredAt,
  );
  if (nativeMatch) return nativeMatch;

  if (amountCzk === null) return null;

  // CZK is only a fallback for legacy rows whose native currency metadata is
  // incomplete. Allow ordinary rounding noise, but keep the time/kind guards
  // and ambiguity check so unrelated transactions cannot be merged.
  const czkTolerance = Math.max(0.5, Math.abs(amountCzk) * 0.00001);
  const czkCandidates = db
    .prepare(
      "SELECT * FROM transactions WHERE provider = 'trading212' " +
        `AND kind IN (${placeholders}) ` +
        "AND julianday(occurred_at) BETWEEN julianday(?) - 1.5 AND julianday(?) + 1.5 " +
        "AND external_id NOT LIKE 'card-export:%' " +
        "AND amount_czk IS NOT NULL " +
        "AND ABS(ABS(amount_czk) - ?) <= ? " +
        "ORDER BY ABS(julianday(occurred_at) - julianday(?)) ASC LIMIT 2",
    )
    .all(
      ...kindCandidates,
      occurredAt,
      occurredAt,
      Math.abs(amountCzk),
      czkTolerance,
      occurredAt,
    );

  return nearestUnambiguousCandidate(
    czkCandidates as Array<Record<string, unknown>>,
    occurredAt,
  );
}

function reconcileStoredRichExportRows() {
  const db = getDb();
  const enrichmentRows = db
    .prepare(`
      SELECT
        id, external_id, occurred_at, currency, amount, amount_czk,
        note, source_label, counterparty_ref, raw_json
      FROM transactions
      WHERE provider = 'trading212'
        AND external_id LIKE 'card-export:%'
        AND COALESCE(raw_json, '') LIKE '%"enrichmentOnly":true%'
      ORDER BY occurred_at ASC, id ASC
    `)
    .all();

  if (!enrichmentRows.length) return 0;

  const updateTarget = db.prepare(`
    UPDATE transactions
    SET kind = ?,
        flow_scope = ?,
        category = ?,
        currency = ?,
        amount = ?,
        amount_czk = ?,
        note = ?,
        source_label = ?,
        counterparty_ref = ?,
        raw_json = ?
    WHERE id = ?
  `);
  const deleteEnrichment = db.prepare(
    "DELETE FROM transactions WHERE id = ?",
  );

  let reconciled = 0;

  for (const row of enrichmentRows) {
    const raw = safeJson(row.raw_json);
    const metadata = safeJson(raw.financeOsCardExport);
    const csv = safeJson(raw.csv);
    const actionRaw =
      typeof metadata.action === "string"
        ? metadata.action
        : lookup(
            Object.fromEntries(
              Object.entries(csv).map(([key, value]) => [key, String(value ?? "")]),
            ),
            ["Action", "Type"],
          );
    const merchantCategory =
      typeof metadata.merchantCategory === "string"
        ? metadata.merchantCategory
        : lookup(
            Object.fromEntries(
              Object.entries(csv).map(([key, value]) => [key, String(value ?? "")]),
            ),
            ["Merchant category", "Category"],
          );
    const classification = cardClassification(actionRaw, merchantCategory);
    if (!classification) continue;

    const amount = Number(row.amount);
    const amountCzk =
      row.amount_czk === null || row.amount_czk === undefined
        ? null
        : Number(row.amount_czk);
    if (!Number.isFinite(amount)) continue;
    if (amountCzk !== null && !Number.isFinite(amountCzk)) continue;

    const csvId =
      typeof metadata.csvId === "string" ? metadata.csvId : "";
    const existing = findExistingTransaction(
      csvId,
      classification,
      String(row.occurred_at),
      amount,
      String(row.currency),
      amountCzk,
    );
    if (!existing || String(existing.id) === String(row.id)) continue;

    const targetRaw = safeJson(existing.raw_json);
    updateTarget.run(
      classification.kind,
      classification.flowScope,
      classification.category,
      String(row.currency),
      amount,
      amountCzk,
      row.note === null || row.note === undefined ? null : String(row.note),
      row.source_label === null || row.source_label === undefined
        ? null
        : String(row.source_label),
      row.counterparty_ref === null || row.counterparty_ref === undefined
        ? null
        : String(row.counterparty_ref),
      JSON.stringify({
        ...targetRaw,
        financeOsCardExport: metadata,
        financeOsCardCsv: csv,
        financeOsReconciledFromStoredExport: true,
      }),
      String(existing.id),
    );
    deleteEnrichment.run(String(row.id));
    reconciled += 1;
  }

  return reconciled;
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
  let recognizedCashRows = 0;
  const actionCounts = new Map<string, number>();

  for (const row of rows) {
    const actionRaw = lookup(row, ["Action", "Type"]);
    const normalizedAction = normalizeAction(actionRaw) || "(missing action)";
    actionCounts.set(
      normalizedAction,
      (actionCounts.get(normalizedAction) ?? 0) + 1,
    );
    const merchant = lookup(row, ["Merchant name", "Merchant"]);
    const merchantCategory = lookup(row, ["Merchant category", "Category"]);
    const classification = cardClassification(actionRaw, merchantCategory);
    if (!classification) continue;
    recognizedCashRows += 1;

    const money = monetaryValue(row, input.accountCurrency);
    if (!money) continue;
    const occurredAt = normalizeOccurredAt(
      lookup(row, ["Time (UTC)", "Time", "Date", "DateTime"]),
    );
    const id = lookup(row, ["ID", "Id", "Reference", "Transaction ID"]);
    const signedAmount =
      classification.category === "card_cashback"
        ? money.amount
        : classification.direction === 0
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
      signedAmount,
      money.currency,
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
      const sourceLabel =
        merchant ||
        (classification.kind === "transfer" ? actionRaw : "") ||
        "Trading 212";
      const counterparty =
        merchant ||
        merchantCategory ||
        (classification.category === "internal_transfer:cfd" ? "Trading 212 CFD" : null);

      getDb()
        .prepare(`
          UPDATE transactions
          SET kind = ?,
              flow_scope = ?,
              category = ?,
              currency = ?,
              amount = ?,
              amount_czk = ?,
              source_label = ?,
              counterparty_ref = ?,
              raw_json = ?
          WHERE id = ?
        `)
        .run(
          classification.kind,
          classification.flowScope,
          classification.category,
          money.currency,
          signedAmount,
          amountCzk,
          sourceLabel,
          counterparty,
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

    const enrichmentOnly = true;

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
      sourceLabel:
        merchant ||
        (classification.kind === "transfer" ? actionRaw : "") ||
        "Trading 212",
      // The public transaction feed already contains card account movements.
      // If we cannot match the richer CSV row safely, keep this row as
      // enrichment-only so investment performance can never double-count it.
      flowScope: enrichmentOnly
        ? "not_applicable"
        : classification.flowScope,
      counterpartyRef: merchant || merchantCategory || null,
      raw: {
        importedFromTrading212CsvExport: true,
        enrichmentOnly,
        financeOsCardExport: cardMetadata,
        csv: row,
      },
    });
    inserted += 1;
  }

  if (cardRows > 0) setState(CARD_DETECTED_KEY, "true");

  const actionInventory = [...actionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([action, count]) => ({ action, count }));
  setState(
    ACTION_INVENTORY_KEY,
    JSON.stringify({
      reportId: input.reportId,
      parsedRows: rows.length,
      recognizedCashRows,
      actions: actionInventory,
      updatedAt: new Date().toISOString(),
    }),
  );

  return {
    parsedRows: rows.length,
    enriched,
    inserted,
    cardRows,
    cashbackRows,
    recognizedCashRows,
    ignoredReportRows: Math.max(0, rows.length - recognizedCashRows),
    actionInventory,
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
          // Request the richest read-only report Trading 212 exposes. Orders,
          // dividends and interest are already imported from dedicated API
          // endpoints; the CSV is used as an independent enrichment source,
          // especially for richer transaction/transfer labels.
          includeDividends: true,
          includeInterest: true,
          includeOrders: true,
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
  deleteState(RETRY_AFTER_KEY);
  return pending;
}

async function syncTrading212CardHistoryInternal(input: {
  environment: string;
  credentials: Trading212CardCredentials;
  accountId: string;
  accountCurrency: string;
}) {
  const previousAccountId = getState(ACCOUNT_KEY);
  if (previousAccountId && previousAccountId !== input.accountId) {
    for (const key of [
      PENDING_KEY,
      CURSOR_KEY,
      LAST_REFRESH_KEY,
      LAST_ERROR_KEY,
      RETRY_AFTER_KEY,
      CARD_DETECTED_KEY,
    ]) {
      deleteState(key);
    }
  }
  setState(ACCOUNT_KEY, input.accountId);

  // Re-run matching against already downloaded rich-export rows before any
  // network/backoff decision. This repairs older FinanceOS databases after the
  // matching algorithm improves, even when Trading 212 says the export is
  // still current and no new report should be requested.
  reconcileStoredRichExportRows();

  const pending = parsePending(getState(PENDING_KEY));
  const retryAfter = getState(RETRY_AFTER_KEY);
  const retryAfterMs = retryAfter ? new Date(retryAfter).getTime() : 0;
  if (
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > Date.now()
  ) {
    return {
      status: "backoff" as const,
      retryAfter,
      pendingReportId: pending?.reportId ?? null,
    };
  }

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
      setState(
        RETRY_AFTER_KEY,
        new Date(Date.now() + ERROR_BACKOFF_MS).toISOString(),
      );
      return { status: "failed" as const, reportStatus: report.status };
    }

    if (report.status !== "Finished") {
      return {
        status: "waiting" as const,
        reportStatus: report.status,
        reportId: pending.reportId,
      };
    }

    if (!report.downloadLink) {
      deleteState(PENDING_KEY);
      setState(
        LAST_ERROR_KEY,
        "Finished Trading 212 card export did not provide a download link.",
      );
      setState(
        RETRY_AFTER_KEY,
        new Date(Date.now() + ERROR_BACKOFF_MS).toISOString(),
      );
      return {
        status: "missing-download-link" as const,
        reportId: pending.reportId,
      };
    }

    let text: string;
    try {
      text = await downloadCsv(report.downloadLink, input.credentials);
    } catch (error) {
      // A signed report URL can expire. Clear the pending pointer so a later
      // sync can request a fresh read-only export rather than retry forever.
      deleteState(PENDING_KEY);
      throw error;
    }

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
    deleteState(RETRY_AFTER_KEY);

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
    // Prefer one complete transactions-only backfill to minimize provider
    // export notifications. Some Trading 212 export surfaces historically
    // limited a report to roughly one year, so fall back to bounded windows
    // only when the provider rejects the full range.
    try {
      const requested = await requestExport({
        environment: input.environment,
        credentials: input.credentials,
        timeFrom: cursorDate.toISOString(),
        timeTo: nowIso,
        historical: true,
      });
      return {
        status: "requested" as const,
        reportId: requested.reportId,
        timeFrom: requested.timeFrom,
        timeTo: requested.timeTo,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("(400)") && !message.includes("(413)")) {
        throw error;
      }

      const fallbackTimeTo = new Date(
        Math.min(
          cursorDate.getTime() + FALLBACK_HISTORY_WINDOW_MS,
          now.getTime(),
        ),
      ).toISOString();
      const requested = await requestExport({
        environment: input.environment,
        credentials: input.credentials,
        timeFrom: cursorDate.toISOString(),
        timeTo: fallbackTimeTo,
        historical: true,
      });
      return {
        status: "requested-fallback-window" as const,
        reportId: requested.reportId,
        timeFrom: requested.timeFrom,
        timeTo: requested.timeTo,
      };
    }
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
    setState(
      RETRY_AFTER_KEY,
      new Date(Date.now() + retryDelayMs(message)).toISOString(),
    );
    return {
      status: "error" as const,
      error: message,
    };
  }
}

export function hasTrading212CardEvidence() {
  const db = getDb();
  const account = db
    .prepare(
      "SELECT 1 FROM accounts WHERE provider = 'trading212' AND type = 'brokerage' LIMIT 1",
    )
    .get();
  if (!account) return false;
  if (getState(CARD_DETECTED_KEY) === "true") return true;
  const row = db
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
        SUM(CASE WHEN category = 'card_cashback' THEN COALESCE(amount_czk, 0) ELSE 0 END) AS cashback,
        SUM(CASE WHEN category LIKE 'card_spend:%' THEN 1 ELSE 0 END) AS spend_count,
        SUM(CASE WHEN category = 'card_cashback' THEN 1 ELSE 0 END) AS cashback_count,
        SUM(
          CASE
            WHEN category = 'card_cashback'
              AND source_label LIKE '%· inferred'
            THEN 1 ELSE 0
          END
        ) AS inferred_cashback_count,
        SUM(
          CASE
            WHEN external_id LIKE 'card-export:%' THEN 1 ELSE 0
          END
        ) AS rich_export_row_count,
        SUM(
          CASE
            WHEN flow_scope = 'unclassified' AND kind = 'deposit' THEN 1
            ELSE 0
          END
        ) AS unresolved_cash_in_count,
        SUM(
          CASE
            WHEN flow_scope = 'unclassified' AND kind = 'deposit'
            THEN ABS(COALESCE(amount_czk, 0))
            ELSE 0
          END
        ) AS unresolved_cash_in_czk,
        SUM(
          CASE
            WHEN external_id LIKE 'card-export:%'
              AND COALESCE(raw_json, '') LIKE '%"enrichmentOnly":true%'
            THEN 1
            ELSE 0
          END
        ) AS enrichment_only_count,
        MIN(CASE WHEN category LIKE 'card_spend:%' THEN occurred_at END) AS first_card_at,
        MAX(CASE WHEN category LIKE 'card_spend:%' THEN occurred_at END) AS last_card_at
      FROM transactions
      WHERE provider = 'trading212'
    `)
    .get();

  const monthly = db
    .prepare(`
      SELECT
        substr(occurred_at, 1, 7) AS month,
        SUM(
          CASE
            WHEN category LIKE 'card_spend:%'
            THEN ABS(COALESCE(amount_czk, 0))
            ELSE 0
          END
        ) AS spend,
        SUM(
          CASE
            WHEN category LIKE 'card_refund:%'
            THEN ABS(COALESCE(amount_czk, 0))
            ELSE 0
          END
        ) AS refunds,
        SUM(
          CASE
            WHEN category = 'card_cashback'
            THEN COALESCE(amount_czk, 0)
            ELSE 0
          END
        ) AS cashback
      FROM transactions
      WHERE provider = 'trading212'
        AND (
          category LIKE 'card_spend:%'
          OR category LIKE 'card_refund:%'
          OR category = 'card_cashback'
        )
      GROUP BY month
      ORDER BY month DESC
      LIMIT 18
    `)
    .all()
    .map((row) => {
      const spendCzk = Number(row.spend) || 0;
      const refundsCzk = Number(row.refunds) || 0;
      const cashbackCzk = Number(row.cashback) || 0;
      const netSpendCzk = Math.max(0, spendCzk - refundsCzk);
      return {
        month: String(row.month),
        spendCzk,
        refundsCzk,
        netSpendCzk,
        cashbackCzk,
        cashbackPct:
          netSpendCzk > 0 ? (cashbackCzk / netSpendCzk) * 100 : null,
      };
    })
    .reverse();

  const topMerchants = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(source_label, ''), 'Unknown merchant') AS merchant,
        SUM(
          CASE
            WHEN category LIKE 'card_spend:%'
            THEN ABS(COALESCE(amount_czk, 0))
            WHEN category LIKE 'card_refund:%'
            THEN -ABS(COALESCE(amount_czk, 0))
            ELSE 0
          END
        ) AS net_spend,
        SUM(CASE WHEN category LIKE 'card_spend:%' THEN 1 ELSE 0 END) AS purchases
      FROM transactions
      WHERE provider = 'trading212'
        AND (
          (
            category LIKE 'card_spend:%'
            AND category != 'card_spend:inferred'
          )
          OR category LIKE 'card_refund:%'
        )
      GROUP BY merchant
      HAVING net_spend > 0
      ORDER BY net_spend DESC
      LIMIT 12
    `)
    .all()
    .map((row) => ({
      merchant: String(row.merchant),
      netSpendCzk: Number(row.net_spend) || 0,
      purchases: Number(row.purchases) || 0,
    }));

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
  const inferredCashbackCount = Number(stats?.inferred_cashback_count) || 0;
  const richExportRowCount = Number(stats?.rich_export_row_count) || 0;
  const classificationSource =
    richExportRowCount > 0 && inferredCashbackCount > 0
      ? "mixed"
      : richExportRowCount > 0
        ? "rich_export"
        : inferredCashbackCount > 0
          ? "validated_public_history"
          : "none";

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
    inferredCashbackCount,
    richExportRowCount,
    classificationSource,
    unresolvedCashInCount: Number(stats?.unresolved_cash_in_count) || 0,
    unresolvedCashInCzk: Number(stats?.unresolved_cash_in_czk) || 0,
    enrichmentOnlyCount: Number(stats?.enrichment_only_count) || 0,
    firstCardAt: stats?.first_card_at ? String(stats.first_card_at) : null,
    lastCardAt: stats?.last_card_at ? String(stats.last_card_at) : null,
    pending: parsePending(getState(PENDING_KEY)),
    fullExportActionInventory: safeJson(getState(ACTION_INVENTORY_KEY)),
    coverageCursor: getState(CURSOR_KEY),
    lastRefreshAt: getState(LAST_REFRESH_KEY),
    lastError: getState(LAST_ERROR_KEY),
    retryAfter: getState(RETRY_AFTER_KEY),
    accountCurrency: account?.currency ? String(account.currency) : null,
    reconciliationStatus: account?.reconciliation_status
      ? String(account.reconciliation_status)
      : null,
    monthly,
    topMerchants,
  };
}
