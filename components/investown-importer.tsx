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

export function InvestownImporter() {
  const router = useRouter();
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [filename, setFilename] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [typeColumn, setTypeColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [projectColumn, setProjectColumn] = useState("");
  const [projectTypeColumn, setProjectTypeColumn] = useState("");
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
          "datum",
          "transaction date",
          "datum transakce",
        ]),
      );
      setAmountColumn(
        autoColumn(parsed.headers, [
          "amount",
          "částka",
          "castka",
          "výše",
          "vyse",
          "transaction amount",
        ]),
      );
      setCurrencyColumn(
        autoColumn(parsed.headers, ["currency", "ccy", "měna", "mena"]),
      );
      setTypeColumn(
        autoColumn(parsed.headers, [
          "type",
          "typ",
          "transaction type",
          "typ transakce",
        ]),
      );
      setDescriptionColumn(
        autoColumn(parsed.headers, [
          "description",
          "details",
          "poznámka",
          "poznamka",
          "popis",
        ]),
      );
      setProjectColumn(
        autoColumn(parsed.headers, [
          "project",
          "project name",
          "název projektu",
          "nazev projektu",
          "projekt",
        ]),
      );
      setProjectTypeColumn(
        autoColumn(parsed.headers, [
          "project type",
          "typ projektu",
          "kategorie projektu",
        ]),
      );
      setIdColumn(
        autoColumn(parsed.headers, [
          "id",
          "transaction id",
          "reference",
          "reference id",
          "identifikátor",
          "identifikator",
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
    if (csv && (!dateColumn || !amountColumn)) {
      setMessage("Pro import historie namapuj minimálně Date a Amount.");
      return;
    }

    const data = new FormData(form);
    const accountCurrency = String(
      data.get("accountCurrency") || "CZK",
    ).toUpperCase();

    const index = (column: string) =>
      csv && column ? csv.headers.indexOf(column) : -1;

    const dateIndex = index(dateColumn);
    const amountIndex = index(amountColumn);
    const currencyIndex = index(currencyColumn);
    const typeIndex = index(typeColumn);
    const descriptionIndex = index(descriptionColumn);
    const projectIndex = index(projectColumn);
    const projectTypeIndex = index(projectTypeColumn);
    const idIndex = index(idColumn);

    const rows = csv
      ? csv.rows
          .map((row) => ({
            externalId: idIndex >= 0 ? row[idIndex] : undefined,
            occurredAt: parseDate(String(row[dateIndex] || "")),
            amount: parseNumber(String(row[amountIndex] || "")),
            currency:
              currencyIndex >= 0
                ? String(row[currencyIndex] || accountCurrency).toUpperCase()
                : accountCurrency,
            type: typeIndex >= 0 ? String(row[typeIndex] || "") : undefined,
            description:
              descriptionIndex >= 0
                ? String(row[descriptionIndex] || "")
                : undefined,
            projectName:
              projectIndex >= 0 ? String(row[projectIndex] || "") : undefined,
            projectType:
              projectTypeIndex >= 0
                ? String(row[projectTypeIndex] || "")
                : undefined,
          }))
          .filter(
            (row) =>
              row.occurredAt &&
              Number.isFinite(row.amount) &&
              row.currency,
          )
      : [];

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/import/investown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCurrency,
          currentValue: Number(data.get("currentValue")),
          walletCash: Number(data.get("walletCash") || 0),
          rows,
        }),
      });

      const payload = (await response.json()) as {
        result?: {
          imported: number;
          skipped: number;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Investown import selhal.");
      }

      setMessage(
        rows.length
          ? "Investown aktualizován · " +
              String(payload.result?.imported ?? rows.length) +
              " importovaných řádků" +
              (payload.result?.skipped
                ? " · " +
                  String(payload.result.skipped) +
                  " přeskočeno"
                : "") +
              "."
          : "Aktuální hodnota Investownu byla uložena.",
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
        ["Type", typeColumn, setTypeColumn],
        ["Project", projectColumn, setProjectColumn],
        ["Project type", projectTypeColumn, setProjectTypeColumn],
        ["Description", descriptionColumn, setDescriptionColumn],
        ["External ID", idColumn, setIdColumn],
      ] as const
    : [];

  return (
    <article className="rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Investown import</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Aktuální hodnotu a peněženku můžeš aktualizovat ručně. Pokud přidáš
            Investown CSV výkaz transakcí, FinanceOS navíc importuje historii,
            výnosy a projekty a pokusí se typy transakcí automaticky rozpoznat.
          </p>
        </div>
        <span className="rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--warning)]">
          CSV / balance
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
              defaultValue="CZK"
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
          <Field label="Wallet cash">
            <input
              name="walletCash"
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
            {filename || "Vyber Investown CSV výkaz"}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Volitelné · mapování sloupců zkontroluješ před importem
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
                          className="max-w-[260px] truncate whitespace-nowrap px-3 py-2 text-[var(--muted)]"
                        >
                          {row[columnIndex] || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs leading-5 text-[var(--muted)]">
              Načteno {csv.rows.length.toLocaleString("cs-CZ")} řádků.
              Opakovaný import stejných transakcí nevytváří duplicity.
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
          disabled={busy}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Ukládám…"
            : csv
              ? "Update balance & import Investown"
              : "Update Investown balance"}
        </button>
      </form>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        FinanceOS nepoužívá neveřejné Investown endpointy ani tvoje přihlašovací
        heslo. Až Investown nabídne podporované read-only API pro investory,
        můžeme tento provider přepnout na automatickou synchronizaci.
      </p>

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
