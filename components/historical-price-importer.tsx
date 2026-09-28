"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PriceImportAsset {
  id: string;
  provider: string;
  externalId: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
}

type CsvData = {
  headers: string[];
  rows: string[][];
};

function delimiterFor(line: string) {
  const choices = [",", ";", "\t"];
  return choices
    .map((value) => ({ value, count: line.split(value).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.value || ",";
}

function parseCsv(text: string): CsvData {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = delimiterFor(source.split(/\r?\n/, 1)[0] || "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  if (rows.length < 2) {
    throw new Error("CSV musí obsahovat hlavičku a alespoň jeden cenový řádek.");
  }

  return {
    headers: rows[0],
    rows: rows.slice(1),
  };
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function autoColumn(headers: string[], aliases: string[]) {
  const wanted = aliases.map(normalize);

  return (
    headers.find((header) => {
      const value = normalize(header);
      return wanted.some(
        (alias) =>
          value === alias ||
          value.includes(alias) ||
          alias.includes(value),
      );
    }) || ""
  );
}

function parseNumber(value: string) {
  const compact = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");

  if (!compact) return Number.NaN;

  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");

  return Number(
    comma > dot
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, ""),
  );
}

function parseDate(value: string) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const match = value
    .trim()
    .match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);

  if (!match) return value;

  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    12,
    0,
    0,
  ).toISOString();
}

export function HistoricalPriceImporter({
  assets,
}: {
  assets: PriceImportAsset[];
}) {
  const router = useRouter();
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [filename, setFilename] = useState("");
  const [assetId, setAssetId] = useState(assets[0]?.id || "");
  const [dateColumn, setDateColumn] = useState("");
  const [closeColumn, setCloseColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedAsset = assets.find((asset) => asset.id === assetId);

  async function load(file: File) {
    try {
      const parsed = parseCsv(await file.text());
      setCsv(parsed);
      setFilename(file.name);
      setDateColumn(
        autoColumn(parsed.headers, [
          "date",
          "day",
          "datum",
          "price date",
          "trading date",
        ]),
      );
      setCloseColumn(
        autoColumn(parsed.headers, [
          "close",
          "close price",
          "closing price",
          "price",
          "last",
          "cena",
        ]),
      );
      setCurrencyColumn(
        autoColumn(parsed.headers, ["currency", "ccy", "měna", "mena"]),
      );
      setMessage(null);
    } catch (error) {
      setCsv(null);
      setFilename("");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function submit(form: HTMLFormElement) {
    if (!csv || !assetId || !dateColumn || !closeColumn) {
      setMessage("Vyber asset, CSV a namapuj Date + Close.");
      return;
    }

    const data = new FormData(form);
    const defaultCurrency = String(
      data.get("defaultCurrency") || selectedAsset?.currency || "USD",
    ).toUpperCase();
    const source = String(data.get("source") || filename || "CSV import").trim();

    const index = (column: string) =>
      column ? csv.headers.indexOf(column) : -1;

    const dateIndex = index(dateColumn);
    const closeIndex = index(closeColumn);
    const currencyIndex = index(currencyColumn);

    const rows = csv.rows
      .map((row) => ({
        date: parseDate(String(row[dateIndex] || "")),
        close: parseNumber(String(row[closeIndex] || "")),
        currency:
          currencyIndex >= 0
            ? String(row[currencyIndex] || defaultCurrency).toUpperCase()
            : defaultCurrency,
      }))
      .filter(
        (row) =>
          row.date &&
          Number.isFinite(row.close) &&
          row.close > 0 &&
          row.currency,
      );

    if (!rows.length) {
      setMessage("Z CSV se nepodařilo vytvořit žádný platný cenový řádek.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/import/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          defaultCurrency,
          source,
          rows,
        }),
      });

      const payload = (await response.json()) as {
        result?: {
          symbol: string;
          imported: number;
          skipped: number;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Historical price import selhal.");
      }

      setMessage(
        "Uloženo " +
          String(payload.result?.imported ?? rows.length) +
          " cen pro " +
          String(payload.result?.symbol || selectedAsset?.symbol || "asset") +
          (payload.result?.skipped
            ? ", přeskočeno " + String(payload.result.skipped)
            : "") +
          ".",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!assets.length) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nejdřív synchronizuj nebo importuj investiční účet, aby FinanceOS znal
        assety.
      </p>
    );
  }

  return (
    <article>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-semibold">Historical price CSV</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Importuj denní close ceny pro konkrétní asset. FinanceOS je přepočítá
            historickým kurzem ČNB do CZK a použije je pro zpětnou rekonstrukci
            hodnoty držených pozic.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Date + Close
        </span>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <label>
            <span className="text-xs text-[var(--muted)]">Asset</span>
            <select
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.symbol} · {asset.provider} · {asset.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs text-[var(--muted)]">Default currency</span>
            <input
              name="defaultCurrency"
              key={selectedAsset?.id || "currency"}
              defaultValue={selectedAsset?.currency || "USD"}
              required
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
            />
          </label>

          <label>
            <span className="text-xs text-[var(--muted)]">Source label</span>
            <input
              name="source"
              defaultValue="Historical CSV"
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            />
          </label>
        </div>

        <label className="block rounded-2xl border border-dashed border-white/12 bg-white/[0.015] p-5 text-center">
          <span className="block text-sm font-medium">
            {filename || "Vyber historical price CSV"}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Date + Close, volitelně Currency
          </span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="mt-4 block w-full text-xs text-[var(--muted)]"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
            }}
          />
        </label>

        {csv ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                <span className="text-xs text-[var(--muted)]">Date *</span>
                <select
                  value={dateColumn}
                  onChange={(event) => setDateColumn(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
                >
                  <option value="">— not mapped —</option>
                  {csv.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-xs text-[var(--muted)]">Close *</span>
                <select
                  value={closeColumn}
                  onChange={(event) => setCloseColumn(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
                >
                  <option value="">— not mapped —</option>
                  {csv.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-xs text-[var(--muted)]">Currency</span>
                <select
                  value={currencyColumn}
                  onChange={(event) => setCurrencyColumn(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
                >
                  <option value="">Use default currency</option>
                  {csv.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/7">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="bg-white/[0.025] text-[var(--muted)]">
                  <tr>
                    {csv.headers.map((header) => (
                      <th
                        key={header}
                        className="whitespace-nowrap px-3 py-2 font-medium"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csv.rows.slice(0, 4).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-white/6">
                      {csv.headers.map((header, columnIndex) => (
                        <td
                          key={header}
                          className="max-w-[240px] truncate whitespace-nowrap px-3 py-2 text-[var(--muted)]"
                        >
                          {row[columnIndex] || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-[var(--muted)]">
              Načteno {csv.rows.length.toLocaleString("cs-CZ")} řádků. Stejné
              datum pro stejný asset se při dalším importu aktualizuje.
            </p>
          </>
        ) : null}

        {message ? (
          <p className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs leading-5">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!csv || busy}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Importuji…" : "Import historical prices"}
        </button>
      </form>
    </article>
  );
}
