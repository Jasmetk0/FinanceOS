"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    throw new Error("CSV musí obsahovat hlavičku a alespoň jeden datový řádek.");
  }

  return {
    headers: rows[0],
    rows: rows.slice(1),
  };
}

function normalized(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function autoColumn(headers: string[], aliases: string[]) {
  const wanted = aliases.map(normalized);

  return (
    headers.find((header) => {
      const value = normalized(header);
      return wanted.some(
        (alias) =>
          value === alias ||
          value.includes(alias) ||
          alias.includes(value),
      );
    }) || ""
  );
}

function parseAmount(value: string) {
  const compact = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[^0-9,().-]/g, "");

  if (!compact) return Number.NaN;

  const negativeByParentheses =
    compact.startsWith("(") && compact.endsWith(")");
  const clean = compact.replace(/[()]/g, "");
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  const parsed = Number(
    comma > dot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, ""),
  );

  return negativeByParentheses ? -Math.abs(parsed) : parsed;
}

function parseDate(value: string) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const match = value
    .trim()
    .match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);

  if (!match) return value;

  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || "12"),
    Number(match[5] || "0"),
    Number(match[6] || "0"),
  ).toISOString();
}

export function CashFlowCsvImporter() {
  const router = useRouter();
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [filename, setFilename] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [categoryColumn, setCategoryColumn] = useState("");
  const [sourceColumn, setSourceColumn] = useState("");
  const [kindColumn, setKindColumn] = useState("");
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
          "transaction date",
          "booking date",
          "datum",
          "datum zaúčtování",
        ]),
      );
      setAmountColumn(
        autoColumn(parsed.headers, [
          "amount",
          "transaction amount",
          "částka",
          "castka",
          "value",
          "obrat",
        ]),
      );
      setCurrencyColumn(
        autoColumn(parsed.headers, ["currency", "ccy", "měna", "mena"]),
      );
      setDescriptionColumn(
        autoColumn(parsed.headers, [
          "description",
          "message",
          "details",
          "note",
          "poznámka",
          "poznamka",
          "popis",
        ]),
      );
      setCategoryColumn(
        autoColumn(parsed.headers, ["category", "kategorie"]),
      );
      setSourceColumn(
        autoColumn(parsed.headers, ["source", "merchant", "counterparty", "protistrana"]),
      );
      setKindColumn(
        autoColumn(parsed.headers, ["kind", "financeos kind", "transaction kind"]),
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
      setFilename("");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function submit(form: HTMLFormElement) {
    if (!csv || !dateColumn || !amountColumn) {
      setMessage("Vyber CSV a namapuj minimálně Date a Amount.");
      return;
    }

    const formData = new FormData(form);
    const defaultCurrency = String(
      formData.get("defaultCurrency") || "CZK",
    ).toUpperCase();
    const defaultSource = String(
      formData.get("defaultSource") || "CSV import",
    ).trim();
    const positiveKind = String(
      formData.get("positiveKind") || "income",
    );
    const negativeKind = String(
      formData.get("negativeKind") || "expense",
    );

    const index = (column: string) =>
      column ? csv.headers.indexOf(column) : -1;

    const dateIndex = index(dateColumn);
    const amountIndex = index(amountColumn);
    const currencyIndex = index(currencyColumn);
    const descriptionIndex = index(descriptionColumn);
    const categoryIndex = index(categoryColumn);
    const sourceIndex = index(sourceColumn);
    const kindIndex = index(kindColumn);
    const idIndex = index(idColumn);

    const rows = csv.rows
      .map((row) => ({
        externalId: idIndex >= 0 ? row[idIndex] : undefined,
        occurredAt: parseDate(String(row[dateIndex] || "")),
        amount: parseAmount(String(row[amountIndex] || "")),
        currency:
          currencyIndex >= 0
            ? String(row[currencyIndex] || defaultCurrency).toUpperCase()
            : defaultCurrency,
        description:
          descriptionIndex >= 0
            ? String(row[descriptionIndex] || "")
            : undefined,
        category:
          categoryIndex >= 0 ? String(row[categoryIndex] || "") : undefined,
        sourceLabel:
          sourceIndex >= 0
            ? String(row[sourceIndex] || defaultSource)
            : defaultSource,
        kind: kindIndex >= 0 ? String(row[kindIndex] || "") : undefined,
      }))
      .filter(
        (row) =>
          row.occurredAt &&
          Number.isFinite(row.amount) &&
          row.amount !== 0 &&
          row.currency,
      );

    if (!rows.length) {
      setMessage("Z CSV se nepodařilo vytvořit žádný platný cash-flow řádek.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/import/cashflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultCurrency,
          positiveKind,
          negativeKind,
          rows,
        }),
      });

      const payload = (await response.json()) as {
        result?: { imported: number; skipped: number };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Cash-flow import selhal.");
      }

      setMessage(
        "Importováno " +
          String(payload.result?.imported ?? rows.length) +
          " řádků" +
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

  const selectors = csv
    ? [
        ["Date *", dateColumn, setDateColumn],
        ["Amount *", amountColumn, setAmountColumn],
        ["Currency", currencyColumn, setCurrencyColumn],
        ["Description", descriptionColumn, setDescriptionColumn],
        ["Category", categoryColumn, setCategoryColumn],
        ["Source", sourceColumn, setSourceColumn],
        ["Kind", kindColumn, setKindColumn],
        ["External ID", idColumn, setIdColumn],
      ] as const
    : [];

  return (
    <article>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-semibold">Cash-flow CSV import</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Importuj bankovní nebo vlastní CSV historii. U kladných i záporných
            částek si zvolíš výchozí typ; interní převody tak nemusíš omylem
            počítat jako příjem nebo výdaj. Import mění cash-flow historii, ne
            aktuální bankovní zůstatek v net worth.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Signed amount CSV
        </span>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className="text-xs text-[var(--muted)]">Default currency</span>
            <input
              name="defaultCurrency"
              defaultValue="CZK"
              required
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
            />
          </label>
          <label>
            <span className="text-xs text-[var(--muted)]">Default source</span>
            <input
              name="defaultSource"
              defaultValue="Bank CSV"
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            />
          </label>
          <label>
            <span className="text-xs text-[var(--muted)]">Positive amounts</span>
            <select
              name="positiveKind"
              defaultValue="income"
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            >
              <option value="income">Income</option>
              <option value="gift">Gift</option>
              <option value="interest">Interest</option>
              <option value="deposit">Deposit / transfer in</option>
              <option value="transfer">Internal transfer</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </label>
          <label>
            <span className="text-xs text-[var(--muted)]">Negative amounts</span>
            <select
              name="negativeKind"
              defaultValue="expense"
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            >
              <option value="expense">Expense</option>
              <option value="fee">Fee</option>
              <option value="withdrawal">Withdrawal / transfer out</option>
              <option value="transfer">Internal transfer</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </label>
        </div>

        <label className="block rounded-2xl border border-dashed border-white/12 bg-white/[0.015] p-5 text-center">
          <span className="block text-sm font-medium">
            {filename || "Vyber cash-flow CSV"}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            čárka / středník / tab · signed amount column
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {selectors.map(([label, value, setter]) => (
                <label key={label}>
                  <span className="text-xs text-[var(--muted)]">{label}</span>
                  <select
                    value={value}
                    onChange={(event) => setter(event.target.value)}
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
              Načteno {csv.rows.length.toLocaleString("cs-CZ")} řádků. Opakovaný
              import stejného souboru nevytváří duplicity.
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
          {busy ? "Importuji…" : "Import cash flow"}
        </button>
      </form>
    </article>
  );
}
