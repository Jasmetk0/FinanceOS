"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CsvData = { headers: string[]; rows: string[][] };

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
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV nemá datové řádky.");

  return { headers: rows[0], rows: rows.slice(1) };
}

function normalized(value: string) {
  return value.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function autoColumn(headers: string[], aliases: string[]) {
  const wanted = aliases.map(normalized);
  return (
    headers.find((header) => {
      const value = normalized(header);
      return wanted.some(
        (alias) => value === alias || value.includes(alias) || alias.includes(value),
      );
    }) || ""
  );
}

function parseAmount(value: string) {
  const compact = value.trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
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
    .match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return value;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const hour = Number(match[4] || "12");
  const minute = Number(match[5] || "0");
  const second = Number(match[6] || "0");
  return new Date(year, month, day, hour, minute, second).toISOString();
}

export function MintosImporter() {
  const router = useRouter();
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [filename, setFilename] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [typeColumn, setTypeColumn] = useState("");
  const [idColumn, setIdColumn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(file: File) {
    try {
      const parsed = parseCsv(await file.text());
      setCsv(parsed);
      setFilename(file.name);
      setDateColumn(
        autoColumn(parsed.headers, [
          "date",
          "datetime",
          "transaction date",
          "booking date",
          "datum",
        ]),
      );
      setAmountColumn(
        autoColumn(parsed.headers, [
          "amount",
          "turnover",
          "transaction amount",
          "value",
          "částka",
        ]),
      );
      setCurrencyColumn(autoColumn(parsed.headers, ["currency", "ccy", "měna"]));
      setDescriptionColumn(
        autoColumn(parsed.headers, [
          "description",
          "details",
          "transaction details",
          "comment",
          "popis",
        ]),
      );
      setTypeColumn(
        autoColumn(parsed.headers, ["type", "transaction type", "category", "typ"]),
      );
      setIdColumn(
        autoColumn(parsed.headers, [
          "id",
          "transaction id",
          "reference",
          "reference id",
        ]),
      );
      setMessage(null);
    } catch (error) {
      setCsv(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function submit(form: HTMLFormElement) {
    if (!csv || !dateColumn || !amountColumn) {
      setMessage("Vyber CSV a namapuj Date a Amount.");
      return;
    }

    const data = new FormData(form);
    const accountCurrency = String(data.get("accountCurrency") || "EUR").toUpperCase();
    const index = (column: string) => (column ? csv.headers.indexOf(column) : -1);
    const dateIndex = index(dateColumn);
    const amountIndex = index(amountColumn);
    const currencyIndex = index(currencyColumn);
    const descriptionIndex = index(descriptionColumn);
    const typeIndex = index(typeColumn);
    const idIndex = index(idColumn);

    const rows = csv.rows
      .map((row, sourceIndex) => ({
        externalId: idIndex >= 0 ? row[idIndex] : undefined,
        occurredAt: parseDate(String(row[dateIndex] || "")),
        amount: parseAmount(String(row[amountIndex] || "")),
        currency:
          currencyIndex >= 0
            ? String(row[currencyIndex] || accountCurrency).toUpperCase()
            : accountCurrency,
        description: descriptionIndex >= 0 ? row[descriptionIndex] : undefined,
        type: typeIndex >= 0 ? row[typeIndex] : undefined,
        sourceIndex,
      }))
      .filter((row) => row.occurredAt && Number.isFinite(row.amount));

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/import/mintos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCurrency,
          currentValue: Number(data.get("currentValue")),
          cashValue: Number(data.get("cashValue") || 0),
          rows,
        }),
      });
      const result = (await response.json()) as {
        result?: { imported: number; skipped: number };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Mintos import selhal.");

      setMessage(
        "Importováno " +
          String(result.result?.imported ?? rows.length) +
          " řádků" +
          (result.result?.skipped
            ? ", přeskočeno " + String(result.result.skipped)
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

  const selectors = csv
    ? [
        ["Date *", dateColumn, setDateColumn],
        ["Amount *", amountColumn, setAmountColumn],
        ["Currency", currencyColumn, setCurrencyColumn],
        ["Description", descriptionColumn, setDescriptionColumn],
        ["Type", typeColumn, setTypeColumn],
        ["External ID", idColumn, setIdColumn],
      ] as const
    : [];

  return (
    <article className="rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mintos import</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Nahraj CSV export. FinanceOS se pokusí sloupce rozpoznat a před
            importem je můžeš ručně opravit.
          </p>
        </div>
        <span className="rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--warning)]">
          File import
        </span>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Account currency">
            <input
              name="accountCurrency"
              defaultValue="EUR"
              required
              className="input"
            />
          </Field>
          <Field label="Current total value">
            <input
              name="currentValue"
              type="number"
              step="0.01"
              min="0"
              required
              className="input"
            />
          </Field>
          <Field label="Current cash">
            <input
              name="cashValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
              className="input"
            />
          </Field>
        </div>

        <label className="block rounded-2xl border border-dashed border-white/12 bg-white/[0.015] p-5 text-center">
          <span className="block text-sm font-medium">
            {filename || "Vyber Mintos CSV export"}
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {selectors.map(([label, value, setter]) => (
                <Field key={label} label={label}>
                  <select
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                    className="input"
                  >
                    <option value="">— not mapped —</option>
                    {csv.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
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
              Načteno {csv.rows.length.toLocaleString("cs-CZ")} řádků.
              Opakovaný import stejných záznamů nevytváří duplicity.
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
          {busy ? "Importuji…" : "Import Mintos"}
        </button>
      </form>
      <style jsx>{`
        .input {
          margin-top: 0.375rem;
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.09);
          background: #0b1511;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
      `}</style>
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
