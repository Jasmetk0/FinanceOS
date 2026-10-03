"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CsvData = {
  headers: string[];
  rows: string[][];
};

type MappingSetter = (value: string) => void;

const INVESTOWN_HEADERS = [
  "Datum",
  "Časová zóna",
  "Typ",
  "Detail",
  "Částka [CZK]",
  "Úvěr",
  "Název projektu",
  "Odkaz na projekt",
  "Typ projektu",
] as const;

const PRINCIPAL_IN = new Set(["Investice", "Autoinvestice"]);
const PRINCIPAL_OUT = new Set([
  "Splacení jistiny",
  "Částečné splacení jistiny",
  "Odstoupení",
]);
const OFFER_LOCK = new Set(["Nabídka ke koupi"]);
const OFFER_UNLOCK = new Set(["Vrácení nabídky"]);

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

function parseDate(value: string, timezone?: string) {
  const trimmed = value.trim();
  const zone = (timezone || "").trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed) &&
    /^[+-]\d{2}:\d{2}$/.test(zone)
  ) {
    const zoned = new Date(trimmed.replace(" ", "T") + zone);
    if (!Number.isNaN(zoned.getTime())) return zoned.toISOString();
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

function isNativeInvestown(headers: string[]) {
  const set = new Set(headers.map((header) => header.trim()));
  return INVESTOWN_HEADERS.every((header) => set.has(header));
}

function money(value: number) {
  return value.toLocaleString("cs-CZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " Kč";
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

type InvestownStatus = {
  mode: string;
  updatedAt: string;
  currentValueCzk: number;
  walletCashCzk: number;
  investedValueCzk: number;
  realizedYieldCzk: number;
  investmentPnlCzk: number;
  externalRewardsCzk: number;
  totalGainCzk: number;
  realizedProfitCzk: number;
  transactions: number;
  projects: number;
  activeProjects: number;
  firstAt: string | null;
  lastAt: string | null;
  unknownTypes: number;
  typeCounts: Array<{ type: string; count: number }>;
};

type InvestownImportResult = {
  accountId: string | null;
  dryRun: boolean;
  previewToken: string;
  imported: number;
  newTransactions: number;
  matchedTransactions: number;
  removedTransactions: number;
  authoritativeNativeSnapshot: boolean;
  storedTransactions: number;
  skipped: number;
  derived: {
    walletCashCzk: number;
    investedPrincipalCzk: number;
    reservedOffersCzk: number;
    receivedInterestCzk: number;
    otherInvestmentIncomeCzk: number;
    externalRewardsCzk: number;
    otherIncomeCzk: number;
    feesCzk: number;
    investmentPnlCzk: number;
    totalGainCzk: number;
    realizedPnlCzk: number;
    totalValueCzk: number;
    activeProjects: number;
    allProjects: number;
  };
  effective: {
    walletCashCzk: number;
    investedValueCzk: number;
    totalValueCzk: number;
  };
  diff: {
    transactions: number;
    totalValueCzk: number;
    walletCashCzk: number;
    investmentPnlCzk: number;
    externalRewardsCzk: number;
  };
  coverage: {
    unknownTypes: string[];
    lastAt: string | null;
    previousLastAt: string | null;
    advanced: boolean;
  };
};

export function InvestownImporter({
  initialStatus,
}: {
  initialStatus: InvestownStatus | null;
}) {
  const router = useRouter();
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [filename, setFilename] = useState("");
  const [nativeFormat, setNativeFormat] = useState(false);
  const [dateColumn, setDateColumn] = useState("");
  const [timezoneColumn, setTimezoneColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [typeColumn, setTypeColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [loanColumn, setLoanColumn] = useState("");
  const [projectColumn, setProjectColumn] = useState("");
  const [projectUrlColumn, setProjectUrlColumn] = useState("");
  const [projectTypeColumn, setProjectTypeColumn] = useState("");
  const [idColumn, setIdColumn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPreview, setPendingPreview] =
    useState<InvestownImportResult | null>(null);

  async function load(file: File) {
    try {
      const parsed = parseCsv(await file.text());
      const native = isNativeInvestown(parsed.headers);

      setCsv(parsed);
      setFilename(file.name);
      setNativeFormat(native);

      setDateColumn(
        native
          ? "Datum"
          : autoColumn(parsed.headers, [
              "date",
              "datum",
              "transaction date",
              "datum transakce",
            ]),
      );
      setTimezoneColumn(
        native
          ? "Časová zóna"
          : autoColumn(parsed.headers, ["timezone", "time zone", "časová zóna"]),
      );
      setAmountColumn(
        native
          ? "Částka [CZK]"
          : autoColumn(parsed.headers, [
              "amount",
              "částka",
              "castka",
              "výše",
              "vyse",
              "transaction amount",
            ]),
      );
      setCurrencyColumn(
        native
          ? ""
          : autoColumn(parsed.headers, ["currency", "ccy", "měna", "mena"]),
      );
      setTypeColumn(
        native
          ? "Typ"
          : autoColumn(parsed.headers, [
              "type",
              "typ",
              "transaction type",
              "typ transakce",
            ]),
      );
      setDescriptionColumn(
        native
          ? "Detail"
          : autoColumn(parsed.headers, [
              "description",
              "details",
              "detail",
              "poznámka",
              "poznamka",
              "popis",
            ]),
      );
      setLoanColumn(
        native
          ? "Úvěr"
          : autoColumn(parsed.headers, ["loan", "úvěr", "uver"]),
      );
      setProjectColumn(
        native
          ? "Název projektu"
          : autoColumn(parsed.headers, [
              "project",
              "project name",
              "název projektu",
              "nazev projektu",
              "projekt",
            ]),
      );
      setProjectUrlColumn(
        native
          ? "Odkaz na projekt"
          : autoColumn(parsed.headers, [
              "project url",
              "url",
              "odkaz na projekt",
            ]),
      );
      setProjectTypeColumn(
        native
          ? "Typ projektu"
          : autoColumn(parsed.headers, [
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
      setPendingPreview(null);
    } catch (error) {
      setCsv(null);
      setFilename("");
      setNativeFormat(false);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const preview = useMemo(() => {
    if (!csv) return null;

    const index = (name: string) => (name ? csv.headers.indexOf(name) : -1);
    const amountIndex = index(amountColumn);
    const typeIndex = index(typeColumn);
    const projectIndex = index(projectColumn);
    const dateIndex = index(dateColumn);

    if (amountIndex < 0 || typeIndex < 0 || dateIndex < 0) return null;

    let wallet = 0;
    let principal = 0;
    let reserved = 0;
    const projects = new Set<string>();
    const types = new Set<string>();
    let earliest = "";
    let latest = "";

    for (const row of csv.rows) {
      const amount = parseNumber(String(row[amountIndex] || ""));
      if (!Number.isFinite(amount)) continue;

      wallet += amount;
      const type = String(row[typeIndex] || "").trim();
      const project = projectIndex >= 0 ? String(row[projectIndex] || "").trim() : "";
      const date = String(row[dateIndex] || "").trim();

      if (type) types.add(type);
      if (project) projects.add(project);
      if (date && (!earliest || date < earliest)) earliest = date;
      if (date && (!latest || date > latest)) latest = date;

      if (PRINCIPAL_IN.has(type)) principal += Math.abs(amount);
      if (PRINCIPAL_OUT.has(type)) principal -= Math.abs(amount);
      if (OFFER_LOCK.has(type)) reserved += Math.abs(amount);
      if (OFFER_UNLOCK.has(type)) reserved -= Math.abs(amount);
    }

    if (Math.abs(wallet) < 0.005) wallet = 0;
    if (Math.abs(principal) < 0.005) principal = 0;
    if (Math.abs(reserved) < 0.005) reserved = 0;

    return {
      wallet,
      principal: Math.max(0, principal),
      reserved: Math.max(0, reserved),
      total: Math.max(0, wallet + principal + reserved),
      projects: projects.size,
      types: types.size,
      earliest,
      latest,
    };
  }, [csv, amountColumn, typeColumn, projectColumn, dateColumn]);

  function buildRows(accountCurrency: string) {
    if (!csv) return [];

    const index = (column: string) =>
      column ? csv.headers.indexOf(column) : -1;

    const dateIndex = index(dateColumn);
    const timezoneIndex = index(timezoneColumn);
    const amountIndex = index(amountColumn);
    const currencyIndex = index(currencyColumn);
    const typeIndex = index(typeColumn);
    const descriptionIndex = index(descriptionColumn);
    const loanIndex = index(loanColumn);
    const projectIndex = index(projectColumn);
    const projectUrlIndex = index(projectUrlColumn);
    const projectTypeIndex = index(projectTypeColumn);
    const idIndex = index(idColumn);

    return csv.rows
      .map((row) => {
        const timezone =
          timezoneIndex >= 0 ? String(row[timezoneIndex] || "") : "";

        return {
          externalId: idIndex >= 0 ? row[idIndex] : undefined,
          occurredAt: parseDate(String(row[dateIndex] || ""), timezone),
          sourceDate: String(row[dateIndex] || ""),
          timezone: timezone || undefined,
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
          loanName: loanIndex >= 0 ? String(row[loanIndex] || "") : undefined,
          projectName:
            projectIndex >= 0 ? String(row[projectIndex] || "") : undefined,
          projectUrl:
            projectUrlIndex >= 0
              ? String(row[projectUrlIndex] || "")
              : undefined,
          projectType:
            projectTypeIndex >= 0
              ? String(row[projectTypeIndex] || "")
              : undefined,
        };
      })
      .filter(
        (row) =>
          row.occurredAt &&
          Number.isFinite(row.amount) &&
          row.currency,
      );
  }

  async function submit(form: HTMLFormElement) {
    if (!csv) {
      setMessage("Nejdřív vyber Investown CSV soubor.");
      return;
    }

    if (!dateColumn || !amountColumn || !typeColumn) {
      setMessage("Namapuj minimálně Date, Amount a Type.");
      return;
    }

    const data = new FormData(form);
    const accountCurrency = String(
      data.get("accountCurrency") || "CZK",
    ).toUpperCase();
    const rows = buildRows(accountCurrency);
    const currentValue = optionalNumber(data.get("currentValue"));
    const walletCash = optionalNumber(data.get("walletCash"));

    async function requestImport(
      dryRun: boolean,
      allowAuthoritativeRemovals: boolean,
      confirmationToken?: string,
    ) {
      const response = await fetch("/api/import/investown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountCurrency,
          currentValue,
          walletCash,
          rows,
          replaceExisting: false,
          sourceFormat: nativeFormat ? "investown-native" : "mapped",
          dryRun,
          allowAuthoritativeRemovals,
          confirmationToken,
        }),
      });

      const payload = (await response.json()) as {
        result?: InvestownImportResult;
        error?: string;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "Investown import selhal.");
      }

      return payload.result;
    }

    setBusy(true);
    setMessage(null);

    try {
      if (!pendingPreview) {
        const previewResult = await requestImport(true, false);
        setPendingPreview(previewResult);

        const destructive =
          previewResult.removedTransactions > 0
            ? " · POZOR: " +
              previewResult.removedTransactions.toLocaleString("cs-CZ") +
              " starších řádků bude odstraněno podle novějšího plného výpisu"
            : "";

        setMessage(
          "Kontrola hotová — zatím se nic nezměnilo. " +
            "Po potvrzení: " +
            (previewResult.diff.transactions >= 0 ? "+" : "") +
            previewResult.diff.transactions.toLocaleString("cs-CZ") +
            " transakcí · Δ hodnota " +
            money(previewResult.diff.totalValueCzk) +
            " · Δ investiční P/L " +
            money(previewResult.diff.investmentPnlCzk) +
            " · Δ odměny " +
            money(previewResult.diff.externalRewardsCzk) +
            destructive +
            ".",
        );
        return;
      }

      const result = await requestImport(
        false,
        pendingPreview.removedTransactions > 0,
        pendingPreview.previewToken,
      );
      const unknown = result.coverage.unknownTypes;
      setPendingPreview(null);
      setMessage(
        "Hotovo · soubor " +
          result.imported.toLocaleString("cs-CZ") +
          " řádků · " +
          result.newTransactions.toLocaleString("cs-CZ") +
          " nových · " +
          result.matchedTransactions.toLocaleString("cs-CZ") +
          " už známých" +
          (result.removedTransactions > 0
            ? " · " +
              result.removedTransactions.toLocaleString("cs-CZ") +
              " historických řádků odstraněno podle novějšího plného výpisu"
            : "") +
          " · celkem uloženo " +
          result.storedTransactions.toLocaleString("cs-CZ") +
          " transakcí · " +
          result.derived.activeProjects.toLocaleString("cs-CZ") +
          " aktivních projektů · hodnota " +
          money(result.effective.totalValueCzk) +
          " · investiční P/L " +
          money(result.derived.investmentPnlCzk) +
          " · externí odměny " +
          money(result.derived.externalRewardsCzk) +
          " · celkový přírůstek " +
          money(result.derived.totalGainCzk) +
          (result.coverage.lastAt
            ? " · poslední transakce " +
              new Date(result.coverage.lastAt).toLocaleString("cs-CZ")
            : "") +
          (!result.coverage.advanced &&
          result.coverage.previousLastAt !== null
            ? " · POZOR: tento výpis neobsahuje žádné novější transakce než předchozí import."
            : "") +
          (unknown.length
            ? " · Neznámé typy: " + unknown.join(", ")
            : " · Všechny typy transakcí rozpoznány."),
      );

      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const selectors: Array<[string, string, MappingSetter]> = csv && !nativeFormat
    ? [
        ["Date *", dateColumn, setDateColumn],
        ["Timezone", timezoneColumn, setTimezoneColumn],
        ["Amount *", amountColumn, setAmountColumn],
        ["Currency", currencyColumn, setCurrencyColumn],
        ["Type *", typeColumn, setTypeColumn],
        ["Description", descriptionColumn, setDescriptionColumn],
        ["Loan", loanColumn, setLoanColumn],
        ["Project", projectColumn, setProjectColumn],
        ["Project URL", projectUrlColumn, setProjectUrlColumn],
        ["Project type", projectTypeColumn, setProjectTypeColumn],
        ["External ID", idColumn, setIdColumn],
      ]
    : [];

  return (
    <article className="rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Investown</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Nahraj originální CSV historii z Investownu. FinanceOS z ní načte
            transakce, výnosy, bonusové výnosy, vklady, výběry, investice,
            splacení jistiny, sekundární nabídky i jednotlivé projekty.
          </p>
        </div>
        <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]">
          Native CSV
        </span>
      </div>

      {initialStatus ? (
        <div className="mt-5 rounded-2xl border border-white/7 bg-white/[0.02] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Poslední Investown import</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(initialStatus.updatedAt).toLocaleString("cs-CZ")} ·{" "}
                {initialStatus.mode}
                {initialStatus.lastAt
                  ? " · poslední transakce " +
                    new Date(initialStatus.lastAt).toLocaleString("cs-CZ")
                  : ""}
              </p>
            </div>
            <span
              className={[
                "w-fit rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
                initialStatus.unknownTypes
                  ? "border-[var(--warning)]/25 bg-[var(--warning)]/8 text-[var(--warning)]"
                  : "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--accent)]",
              ].join(" ")}
            >
              {initialStatus.unknownTypes
                ? initialStatus.unknownTypes + " unknown"
                : "fully classified"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Preview
              label="Hodnota z výpisu"
              value={money(initialStatus.currentValueCzk)}
            />
            <Preview
              label="Peněženka"
              value={money(initialStatus.walletCashCzk)}
            />
            <Preview
              label="Investováno"
              value={money(initialStatus.investedValueCzk)}
            />
            <Preview
              label="Investiční P/L"
              value={money(initialStatus.investmentPnlCzk)}
            />
            <Preview
              label="Externí odměny"
              value={money(initialStatus.externalRewardsCzk)}
            />
            <Preview
              label="Celkový přírůstek"
              value={money(initialStatus.totalGainCzk)}
            />
            <Preview
              label="Aktivní projekty"
              value={initialStatus.activeProjects.toLocaleString("cs-CZ")}
            />
            <Preview
              label="Transakce"
              value={initialStatus.transactions.toLocaleString("cs-CZ")}
            />
          </div>

          {initialStatus.lastAt ? (
            <p className="mt-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
              FinanceOS počítá Investown přesně jen z transakcí obsažených ve
              výpisu. Historickou hodnotu ani P/L po{" "}
              <strong className="text-[var(--text)]">
                {new Date(initialStatus.lastAt).toLocaleString("cs-CZ")}
              </strong>{" "}
              automaticky nedopočítává, protože by tím vyráběl neexistující
              data. Novější výnos se objeví automaticky až v datovém zdroji,
              který ho skutečně obsahuje.
            </p>
          ) : null}

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
            {filename || "Vyber Investown CSV historii"}
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Originální Investown export se rozpozná a namapuje automaticky.
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

        {csv && nativeFormat ? (
          <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] p-4">
            <p className="text-sm font-semibold text-[var(--accent)]">
              Originální Investown export rozpoznán ✓
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Všech 9 sloupců bylo namapováno automaticky včetně časové zóny,
              úvěru, názvu projektu, odkazu a typu projektu.
            </p>
          </div>
        ) : null}

        {preview ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Preview label="Řádků" value={csv?.rows.length.toLocaleString("cs-CZ") || "0"} />
            <Preview label="Projektů" value={preview.projects.toLocaleString("cs-CZ")} />
            <Preview label="Typů transakcí" value={preview.types.toLocaleString("cs-CZ")} />
            <Preview label="Aktivní jistina" value={money(preview.principal)} />
            <Preview
              label="Rezervované nabídky"
              value={money(preview.reserved)}
            />
            <Preview label="Odhad hodnoty" value={money(preview.total)} />
          </div>
        ) : null}

        {preview ? (
          <p className="text-xs leading-5 text-[var(--muted)]">
            Pokrytí výpisu: {preview.earliest || "—"} → {preview.latest || "—"}.
            Odhad peněženky z kompletní historie: {money(preview.wallet)}.
          </p>
        ) : null}

        {selectors.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {selectors.map(([label, value, setter]) => (
              <Field key={label} label={label}>
                <select
                  value={value}
                  onChange={(event) => {
                    setter(event.target.value);
                    setPendingPreview(null);
                  }}
                  className={inputClass}
                >
                  <option value="">— not mapped —</option>
                  {csv?.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        ) : null}

        {csv ? (
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
        ) : null}

        <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
          <p className="text-sm font-medium">Override jen pro neúplný výpis</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            U kompletního Investown CSV nech obě hodnoty prázdné. FinanceOS
            dopočítá peněženku, nesplacenou jistinu i celkovou hodnotu sám.
            Override použij jen u neúplného výpisu.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Account currency">
              <input
                name="accountCurrency"
                defaultValue="CZK"
                required
                onChange={() => setPendingPreview(null)}
                className={inputClass}
              />
            </Field>
            <Field label="Current total value (optional)">
              <input
                name="currentValue"
                type="number"
                step="0.01"
                min="0"
                placeholder="Auto from statement"
                onChange={() => setPendingPreview(null)}
                className={inputClass}
              />
            </Field>
            <Field label="Wallet cash (optional)">
              <input
                name="walletCash"
                type="number"
                step="0.01"
                min="0"
                placeholder="Auto from statement"
                onChange={() => setPendingPreview(null)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {pendingPreview ? (
          <div className="rounded-2xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] p-4">
            <p className="text-sm font-semibold">Preview změn před importem</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Preview
                label="Δ transakce"
                value={
                  (pendingPreview.diff.transactions >= 0 ? "+" : "") +
                  pendingPreview.diff.transactions.toLocaleString("cs-CZ")
                }
              />
              <Preview
                label="Δ hodnota"
                value={money(pendingPreview.diff.totalValueCzk)}
              />
              <Preview
                label="Δ peněženka"
                value={money(pendingPreview.diff.walletCashCzk)}
              />
              <Preview
                label="Δ investiční P/L"
                value={money(pendingPreview.diff.investmentPnlCzk)}
              />
              <Preview
                label="Δ odměny"
                value={money(pendingPreview.diff.externalRewardsCzk)}
              />
            </div>
            {pendingPreview.removedTransactions > 0 ? (
              <p className="mt-3 text-xs leading-5 text-[var(--warning)]">
                Tento plný výpis je autoritativní a odstraní{" "}
                {pendingPreview.removedTransactions.toLocaleString("cs-CZ")}{" "}
                historických řádků, které už Investown v novém výpisu neuvádí.
                K odstranění dojde až po druhém potvrzení.
              </p>
            ) : (
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                Preview je pouze kontrola. Databáze zatím nebyla změněna.
              </p>
            )}
          </div>
        ) : null}

        {message ? (
          <p className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs leading-5">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !csv}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? pendingPreview
              ? "Importuji…"
              : "Kontroluji výpis…"
            : pendingPreview
              ? "Potvrdit a provést import"
              : "Zkontrolovat import"}
        </button>
      </form>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        Každý import nejdřív proběhne jako read-only preview. Částečné novější
        výpisy se přidávají k uložené historii a překryv se automaticky
        deduplikuje. Pokud nový originální CSV výpis pokrývá celý už známý
        časový rozsah, FinanceOS ho bere jako autoritativní verzi historie.
        Případné odstranění starých řádků se provede až po výslovném druhém
        potvrzení.
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
