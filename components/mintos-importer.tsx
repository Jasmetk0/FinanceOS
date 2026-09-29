"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CsvData = { headers: string[]; rows: string[][] };

type ParsedFile = {
  name: string;
  csv: CsvData;
  native: boolean;
  firstDate: string;
};

export type MintosImportStatus = {
  mode: string;
  updatedAt: string;
  currentValueCzk: number;
  cashValueCzk: number;
  investedValueCzk: number;
  realizedPnlCzk: number;
  transactions: number;
  assets: number;
  activeAssets: number;
  firstAt: string | null;
  lastAt: string | null;
  lifetimeComplete: boolean;
  continuityOk: boolean;
  openingCash: number | null;
  closingCash: number | null;
  grossInterestCzk: number;
  withholdingTaxCzk: number;
  feesCzk: number;
  cashbackCzk: number;
  typeCounts: Array<{ type: string; count: number }>;
  unknownTypes: string[];
};

const NATIVE_HEADERS = [
  "Date",
  "ID transakce:",
  "Detaily",
  "Obrat",
  "Balance",
  "Měna",
  "Typ platby",
] as const;

const PRINCIPAL_TYPES = new Set([
  "Investice",
  "Transakce na Sekundárním trhu",
  "Obdržená jistina",
  "Jistina obdržená při odkupu úvěru",
  "Převod do investic do dluhopisů",
  "Převod z investic do dluhopisů",
]);

const INTEREST_TYPES = new Set([
  "Obdržený úrok",
  "Úrok obdržený při odkupu úvěru",
  "Zpožděné výnos z úroku při odkoupení zpět",
  "Obdržené poplatky z prodlení",
  "Úrok obdržený z plateb ve zpracování",
]);

const inputClass =
  "mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]/50";

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
  const trimmed = value.trim();
  const isoLike = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (isoLike) {
    const date = new Date(
      Number(isoLike[1]),
      Number(isoLike[2]) - 1,
      Number(isoLike[3]),
      Number(isoLike[4] || "12"),
      Number(isoLike[5] || "0"),
      Number(isoLike[6] || "0"),
    );
    return date.toISOString();
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const match = trimmed.match(
    /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
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

function isNativeMintos(headers: string[]) {
  const set = new Set(headers.map((header) => header.trim()));
  return NATIVE_HEADERS.every((header) => set.has(header));
}

function money(value: number, currency = "EUR") {
  return (
    value.toLocaleString("cs-CZ", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    currency
  );
}

function czk(value: number) {
  return (
    value.toLocaleString("cs-CZ", {
      maximumFractionDigits: 0,
    }) + " Kč"
  );
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function nativeRow(file: ParsedFile, row: string[], sourceIndex: number) {
  const index = (header: string) => file.csv.headers.indexOf(header);
  return {
    externalId: String(row[index("ID transakce:")] || ""),
    occurredAt: parseDate(String(row[index("Date")] || "")),
    amount: parseAmount(String(row[index("Obrat")] || "")),
    balance: parseAmount(String(row[index("Balance")] || "")),
    currency: String(row[index("Měna")] || "EUR").toUpperCase(),
    description: String(row[index("Detaily")] || ""),
    type: String(row[index("Typ platby")] || ""),
    sourceFile: file.name,
    sourceIndex,
  };
}

function mergeNative(files: ParsedFile[]) {
  const sorted = [...files].sort(
    (a, b) => a.firstDate.localeCompare(b.firstDate) || a.name.localeCompare(b.name),
  );
  const seen = new Set<string>();
  const rows: ReturnType<typeof nativeRow>[] = [];

  for (const file of sorted) {
    file.csv.rows.forEach((row, sourceIndex) => {
      const item = nativeRow(file, row, sourceIndex);
      if (item.externalId && seen.has(item.externalId)) return;
      if (item.externalId) seen.add(item.externalId);
      rows.push(item);
    });
  }

  return rows;
}

function nativePreview(files: ParsedFile[]) {
  const rows = mergeNative(files);
  if (!rows.length) return null;

  let previous: number | null = null;
  let openingCash = 0;
  let continuityOk = true;
  let principal = 0;
  let realized = 0;
  let interest = 0;
  let tax = 0;
  let fees = 0;
  let cashback = 0;
  const types = new Map<string, number>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      !Number.isFinite(row.amount) ||
      !Number.isFinite(row.balance) ||
      !row.occurredAt
    ) {
      continuityOk = false;
      continue;
    }

    if (previous === null) {
      openingCash = row.balance - row.amount;
    } else if (Math.abs(row.balance - (previous + row.amount)) > 1e-8) {
      continuityOk = false;
    }
    previous = row.balance;

    types.set(row.type, (types.get(row.type) ?? 0) + 1);

    if (PRINCIPAL_TYPES.has(row.type)) {
      principal += -row.amount;
    }
    if (INTEREST_TYPES.has(row.type)) {
      interest += Math.max(0, row.amount);
      realized += row.amount;
    } else if (row.type === "Cashback bonus") {
      cashback += Math.max(0, row.amount);
      realized += row.amount;
    } else if (row.type === "Srážková daň") {
      tax += Math.abs(row.amount);
      realized += row.amount;
    } else if (
      row.type === "Mintos Core fee" ||
      row.type === "Poplatek za neaktivitu"
    ) {
      fees += Math.abs(row.amount);
      realized += row.amount;
    }
  }

  if (Math.abs(principal) < 1e-8) principal = 0;
  const closingCash = previous ?? 0;
  const lifetimeComplete = continuityOk && Math.abs(openingCash) <= 1e-8;

  return {
    rows,
    openingCash,
    closingCash,
    principal: Math.max(0, principal),
    total: closingCash + Math.max(0, principal),
    realized,
    interest,
    tax,
    fees,
    cashback,
    continuityOk,
    lifetimeComplete,
    firstAt: rows[0]?.occurredAt ?? "",
    lastAt: rows.at(-1)?.occurredAt ?? "",
    typeCounts: [...types.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function MintosImporter({
  initialStatus,
}: {
  initialStatus: MintosImportStatus | null;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [genericCsv, setGenericCsv] = useState<CsvData | null>(null);
  const [nativeFormat, setNativeFormat] = useState(false);
  const [dateColumn, setDateColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [typeColumn, setTypeColumn] = useState("");
  const [idColumn, setIdColumn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () => (nativeFormat && files.length ? nativePreview(files) : null),
    [files, nativeFormat],
  );

  async function load(selected: FileList) {
    try {
      const parsedFiles: ParsedFile[] = [];

      for (const file of Array.from(selected)) {
        const parsed = parseCsv(await file.text());
        parsedFiles.push({
          name: file.name,
          csv: parsed,
          native: isNativeMintos(parsed.headers),
          firstDate: String(parsed.rows[0]?.[parsed.headers.indexOf("Date")] || ""),
        });
      }

      const allNative =
        parsedFiles.length > 0 && parsedFiles.every((file) => file.native);

      setFiles(parsedFiles);
      setNativeFormat(allNative);
      setMessage(null);

      if (allNative) {
        setGenericCsv(null);
        setDateColumn("Date");
        setAmountColumn("Obrat");
        setCurrencyColumn("Měna");
        setDescriptionColumn("Detaily");
        setTypeColumn("Typ platby");
        setIdColumn("ID transakce:");
        return;
      }

      if (parsedFiles.length !== 1) {
        throw new Error(
          "Více souborů lze nahrát najednou pouze u originálních Mintos výpisů se stejnou hlavičkou.",
        );
      }

      const parsed = parsedFiles[0].csv;
      setGenericCsv(parsed);
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
          "obrat",
          "transaction amount",
          "value",
          "částka",
        ]),
      );
      setCurrencyColumn(
        autoColumn(parsed.headers, ["currency", "ccy", "měna"]),
      );
      setDescriptionColumn(
        autoColumn(parsed.headers, [
          "description",
          "details",
          "detaily",
          "transaction details",
          "comment",
          "popis",
        ]),
      );
      setTypeColumn(
        autoColumn(parsed.headers, [
          "type",
          "transaction type",
          "category",
          "typ",
          "typ platby",
        ]),
      );
      setIdColumn(
        autoColumn(parsed.headers, [
          "id",
          "transaction id",
          "id transakce",
          "reference",
          "reference id",
        ]),
      );
    } catch (error) {
      setFiles([]);
      setGenericCsv(null);
      setNativeFormat(false);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function mappedRows(accountCurrency: string) {
    if (!genericCsv) return [];
    const index = (column: string) =>
      column ? genericCsv.headers.indexOf(column) : -1;
    const dateIndex = index(dateColumn);
    const amountIndex = index(amountColumn);
    const currencyIndex = index(currencyColumn);
    const descriptionIndex = index(descriptionColumn);
    const typeIndex = index(typeColumn);
    const idIndex = index(idColumn);

    return genericCsv.rows
      .map((row, sourceIndex) => ({
        externalId: idIndex >= 0 ? row[idIndex] : undefined,
        occurredAt: parseDate(String(row[dateIndex] || "")),
        amount: parseAmount(String(row[amountIndex] || "")),
        currency:
          currencyIndex >= 0
            ? String(row[currencyIndex] || accountCurrency).toUpperCase()
            : accountCurrency,
        description:
          descriptionIndex >= 0 ? String(row[descriptionIndex] || "") : undefined,
        type: typeIndex >= 0 ? String(row[typeIndex] || "") : undefined,
        sourceFile: files[0]?.name,
        sourceIndex,
      }))
      .filter((row) => row.occurredAt && Number.isFinite(row.amount));
  }

  async function submit(form: HTMLFormElement) {
    if (!nativeFormat && genericCsv && (!dateColumn || !amountColumn)) {
      setMessage("Pro CSV import namapuj Date a Amount.");
      return;
    }

    const data = new FormData(form);
    const accountCurrency = String(
      data.get("accountCurrency") || "EUR",
    ).toUpperCase();
    const rows = nativeFormat
      ? mergeNative(files)
      : mappedRows(accountCurrency);

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/import/mintos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCurrency,
          currentValue: optionalNumber(data.get("currentValue")),
          cashValue: optionalNumber(data.get("cashValue")),
          rows,
          replaceExisting: true,
          sourceFormat: nativeFormat ? "mintos-native-cs" : "mapped",
        }),
      });

      const payload = (await response.json()) as {
        result?: {
          imported: number;
          derived?: {
            lifetimeComplete: boolean;
            continuityOk: boolean | null;
            principal: number;
            bookTotal: number;
            activeAssets: number;
            realizedPnl: number;
          };
          effective?: {
            totalValueCzk: number;
          };
          coverage?: {
            unknownTypes: string[];
          };
        };
        error?: string;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "Mintos import selhal.");
      }

      const derived = payload.result.derived;
      const unknown = payload.result.coverage?.unknownTypes ?? [];
      setMessage(
        "Hotovo · " +
          payload.result.imported.toLocaleString("cs-CZ") +
          " transakcí" +
          (derived
            ? " · " +
              derived.activeAssets.toLocaleString("cs-CZ") +
              " aktivních ISIN · " +
              (derived.lifetimeComplete
                ? "kompletní historie od nulového zůstatku"
                : "částečná historie")
            : "") +
          (payload.result.effective
            ? " · hodnota " + czk(payload.result.effective.totalValueCzk)
            : "") +
          (unknown.length
            ? " · Neznámé typy: " + unknown.join(", ")
            : " · všechny typy rozpoznány."),
      );

      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const selectors = genericCsv
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
          <h2 className="text-lg font-semibold">Mintos</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Nahraj jeden nebo více originálních Mintos Account Statement CSV.
            FinanceOS spojí období, odstraní duplicity podle ID transakce,
            zkontroluje návaznost Balance a z historie dopočítá cash,
            nesplacenou jistinu, výnosy, daně, poplatky i jednotlivé ISIN.
          </p>
        </div>
        <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]">
          Native multi-file
        </span>
      </div>

      {initialStatus ? (
        <div className="mt-5 rounded-2xl border border-white/7 bg-white/[0.02] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Poslední Mintos import</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(initialStatus.updatedAt).toLocaleString("cs-CZ")} ·{" "}
                {initialStatus.mode}
              </p>
            </div>
            <span
              className={[
                "w-fit rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
                initialStatus.lifetimeComplete &&
                initialStatus.continuityOk &&
                !initialStatus.unknownTypes.length
                  ? "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--accent)]"
                  : "border-[var(--warning)]/25 bg-[var(--warning)]/8 text-[var(--warning)]",
              ].join(" ")}
            >
              {initialStatus.lifetimeComplete
                ? "lifetime statement"
                : "partial statement"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Preview label="Hodnota" value={czk(initialStatus.currentValueCzk)} />
            <Preview label="Cash" value={czk(initialStatus.cashValueCzk)} />
            <Preview label="Investováno" value={czk(initialStatus.investedValueCzk)} />
            <Preview label="Realized P/L" value={czk(initialStatus.realizedPnlCzk)} />
            <Preview
              label="Aktivní ISIN"
              value={initialStatus.activeAssets.toLocaleString("cs-CZ")}
            />
            <Preview
              label="Transakce"
              value={initialStatus.transactions.toLocaleString("cs-CZ")}
            />
          </div>

          <details className="mt-4 rounded-xl border border-white/7 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
              Audit typů transakcí ({initialStatus.typeCounts.length})
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {initialStatus.typeCounts.map((item) => (
                <div
                  key={item.type}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/6 px-3 py-2 text-xs"
                >
                  <span>{item.type}</span>
                  <span className="font-mono text-[var(--muted)]">
                    {item.count.toLocaleString("cs-CZ")}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <label className="block rounded-2xl border border-dashed border-white/12 bg-white/[0.015] p-5 text-center">
          <span className="block text-sm font-medium">
            {files.length
              ? files.length === 1
                ? files[0].name
                : files.length.toLocaleString("cs-CZ") + " Mintos soubory"
              : "Vyber Mintos CSV výpisy"}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Můžeš označit starší i nový výpis současně. Originální český Mintos
            formát se rozpozná automaticky.
          </span>
          <input
            type="file"
            multiple
            accept=".csv,text/csv,text/plain"
            className="mt-4 block w-full text-xs text-[var(--muted)]"
            onChange={(event) => {
              if (event.target.files?.length) void load(event.target.files);
            }}
          />
        </label>

        {nativeFormat && files.length ? (
          <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] p-4">
            <p className="text-sm font-semibold text-[var(--accent)]">
              Originální Mintos Account Statement rozpoznán ✓
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Rozpoznány sloupce Date, ID transakce, Detaily, Obrat, Balance,
              Měna a Typ platby. Soubory se spojí podle období a duplicitní ID
              se importuje jen jednou.
            </p>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Preview
                label="Transakce"
                value={preview.rows.length.toLocaleString("cs-CZ")}
              />
              <Preview
                label="Počáteční cash"
                value={money(preview.openingCash)}
              />
              <Preview
                label="Konečný cash"
                value={money(preview.closingCash)}
              />
              <Preview
                label="Nesplacená jistina"
                value={money(preview.principal)}
              />
              <Preview
                label="Book value"
                value={money(preview.total)}
              />
              <Preview
                label="Realized P/L"
                value={money(preview.realized)}
              />
            </div>

            <div
              className={[
                "rounded-xl border p-3 text-xs leading-5",
                preview.continuityOk && preview.lifetimeComplete
                  ? "border-[var(--accent)]/20 bg-[var(--accent)]/[0.035]"
                  : "border-[var(--warning)]/20 bg-[var(--warning)]/[0.035]",
              ].join(" ")}
            >
              {preview.continuityOk
                ? "Balance navazuje řádek po řádku bez rozdílu. "
                : "Balance nenavazuje — zkontroluj pořadí nebo úplnost souborů. "}
              {preview.lifetimeComplete
                ? "Historie začíná nulovým zůstatkem, takže FinanceOS ji může použít jako kompletní lifetime ledger."
                : "Historie nezačíná nulovým zůstatkem; pro přesný current total bude potřeba starší výpis nebo ruční override."}
            </div>

            <p className="text-xs leading-5 text-[var(--muted)]">
              Výnosy {money(preview.interest)} · srážková daň{" "}
              {money(preview.tax)} · ostatní poplatky {money(preview.fees)} ·
              cashback {money(preview.cashback)}.
            </p>
          </>
        ) : null}

        {selectors.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selectors.map(([label, value, setter]) => (
              <Field key={label} label={label}>
                <select
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                  className={inputClass}
                >
                  <option value="">— not mapped —</option>
                  {genericCsv?.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
          <p className="text-sm font-medium">Current value override</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            U kompletního lifetime výpisu nech Current total i Current cash
            prázdné. FinanceOS je dopočítá z historie. Override použij jen pokud
            Mintos UI ukazuje jinou aktuální hodnotu (např. položku, kterou
            transakční statement neumí ocenit).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Account currency">
              <input
                name="accountCurrency"
                defaultValue="EUR"
                required
                className={inputClass}
              />
            </Field>
            <Field label="Current total value (optional)">
              <input
                name="currentValue"
                type="number"
                step="0.01"
                min="0"
                placeholder="Auto from lifetime statement"
                className={inputClass}
              />
            </Field>
            <Field label="Current cash (optional)">
              <input
                name="cashValue"
                type="number"
                step="0.01"
                min="0"
                placeholder="Auto from Balance"
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {nativeFormat && files.length ? (
          <div className="overflow-x-auto rounded-2xl border border-white/7">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="bg-white/[0.025] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Soubor</th>
                  <th className="px-3 py-2 text-right font-medium">Řádků</th>
                  <th className="px-3 py-2 font-medium">Od</th>
                  <th className="px-3 py-2 font-medium">Do</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.name} className="border-t border-white/6">
                    <td className="px-3 py-2">{file.name}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {file.csv.rows.length.toLocaleString("cs-CZ")}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--muted)]">
                      {file.csv.rows[0]?.[file.csv.headers.indexOf("Date")] || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--muted)]">
                      {file.csv.rows.at(-1)?.[file.csv.headers.indexOf("Date")] || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {message ? (
          <p className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs leading-5">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || (!files.length && !initialStatus)}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Zpracovávám Mintos historii…"
            : files.length
              ? "Importovat Mintos kompletně"
              : "Update Mintos balance"}
        </button>
      </form>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        Nový kompletní Mintos import nahradí předchozí Mintos transakce,
        holdings a snapshoty atomicky. Pokud import selže, původní stav zůstane
        zachovaný.
      </p>
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

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm">{value}</p>
    </div>
  );
}
