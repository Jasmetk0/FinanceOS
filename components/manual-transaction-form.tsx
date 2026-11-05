"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type EntryKind = "income" | "gift" | "expense" | "interest" | "deposit" | "withdrawal" | "fee" | "adjustment";

const kinds: Array<{ value: EntryKind; label: string }> = [
  { value: "income", label: "Příjem / výplata" },
  { value: "gift", label: "Dar" },
  { value: "expense", label: "Výdaj" },
  { value: "interest", label: "Úrok" },
  { value: "deposit", label: "Externí vklad" },
  { value: "withdrawal", label: "Externí výběr" },
  { value: "fee", label: "Poplatek" },
  { value: "adjustment", label: "Účetní úprava" },
];

const kindExplanations: Record<EntryKind, string> = {
  income: "Příjem, například výplata. Zapisuje se do cash-flow historie, nikoliv automaticky do bankovního zůstatku.",
  gift: "Dar od jiné osoby. Nepovažuje se za tržní výnos investice.",
  expense: "Běžný výdaj. Zadej kladnou částku; FinanceOS ji uloží se záporným znaménkem.",
  interest: "Úrokový příjem. Není to vlastní investiční vklad.",
  deposit: "Externí vlastní vklad na investiční účet. Nejde o přesun mezi tvými účty.",
  withdrawal: "Externí výběr z investičního účtu. Pro přesuny mezi vlastními účty toto pole nepoužívej.",
  fee: "Poplatek. Zadej kladnou částku; při uložení se odečte.",
  adjustment: "Účetní oprava může být kladná i záporná. Nejde o běžný příjem ani výdaj.",
};

function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ManualTransactionForm() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<EntryKind>("income");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(null);
  const [defaultOccurredAt, setDefaultOccurredAt] = useState("");

  function begin() {
    setDefaultOccurredAt(localNow());
    setKind("income");
    setMessage(null);
    setMessageKind(null);
    setOpen(true);
  }

  async function submit(form: HTMLFormElement) {
    if (inFlight.current) return;

    const data = new FormData(form);
    const rawAmount = String(data.get("amount") ?? "").trim();
    const amount = Number(rawAmount);
    const currency = String(data.get("currency") || "").trim().toUpperCase();
    const dateText = String(data.get("occurredAt") || "").trim();
    const occurredAt = new Date(dateText);

    if (!rawAmount || !Number.isFinite(amount) || amount === 0) {
      setMessage("Zadej platnou nenulovou částku.");
      setMessageKind("error");
      return;
    }
    if (kind !== "adjustment" && amount < 0) {
      setMessage("Pro tento typ zadej kladnou částku. Znaménko při uložení nastaví FinanceOS.");
      setMessageKind("error");
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setMessage("Měna musí mít třípísmenný kód, například CZK, EUR nebo USD.");
      setMessageKind("error");
      return;
    }
    if (!dateText || Number.isNaN(occurredAt.getTime())) {
      setMessage("Vyber platné datum a čas transakce.");
      setMessageKind("error");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageKind(null);

    try {
      const response = await fetch("/api/manual/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount,
          currency,
          occurredAt: occurredAt.toISOString(),
          note: String(data.get("note") || ""),
          category: String(data.get("category") || ""),
          sourceLabel: String(data.get("sourceLabel") || ""),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Uložení transakce se nezdařilo.");

      form.reset();
      setMessage("Ruční transakce byla uložena do historie.");
      setMessageKind("success");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageKind("error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {message ? (
          <span role={messageKind === "error" ? "alert" : "status"} aria-live="polite"
            className={["text-[11px]", messageKind === "error" ? "text-[var(--danger)]" : "text-[var(--accent)]"].join(" ")}>
            {message}
          </span>
        ) : null}
        <button type="button" onClick={begin} className="finance-action finance-action-primary !min-h-10">
          + Přidat ruční transakci
        </button>
      </div>
    );
  }

  return (
    <form aria-busy={busy}
      className="w-full min-w-0 max-w-2xl rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5"
      onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold">Nová ruční transakce</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">Zápis do cash-flow historie</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}
          aria-label="Zavřít formulář" className="finance-action !min-h-9 !px-3 disabled:opacity-50">Zavřít</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Typ pohybu</span>
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as EntryKind)}
            disabled={busy} className="finance-field mt-1.5 w-full text-[12px]">
            {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Částka *</span>
          <input name="amount" type="number" step="0.01" min={kind === "adjustment" ? undefined : "0.01"} required disabled={busy}
            placeholder={kind === "adjustment" ? "Např. -500" : "Např. 1500"}
            className="finance-field mt-1.5 w-full text-[12px] tabular-nums" />
        </label>
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Měna *</span>
          <input name="currency" defaultValue="CZK" required maxLength={3} pattern="[A-Za-z]{3}"
            autoComplete="off" disabled={busy} className="finance-field mt-1.5 w-full uppercase text-[12px]" />
        </label>
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Datum a čas *</span>
          <input name="occurredAt" type="datetime-local" defaultValue={defaultOccurredAt} required disabled={busy}
            className="finance-field mt-1.5 w-full min-w-0 text-[12px]" />
        </label>
      </div>

      <p role="status" className="mt-3 rounded-xl border border-[var(--border)] bg-black/[.10] px-3 py-2.5 text-[11px] leading-5 text-[var(--muted)]">
        {kindExplanations[kind]}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Kategorie</span>
          <input name="category" placeholder="Výplata, jídlo, nájem…" disabled={busy}
            className="finance-field mt-1.5 w-full text-[12px]" />
        </label>
        <label className="min-w-0">
          <span className="text-[11px] font-semibold text-[var(--muted)]">Zdroj</span>
          <input name="sourceLabel" placeholder="Zaměstnavatel, banka…" disabled={busy}
            className="finance-field mt-1.5 w-full text-[12px]" />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-[11px] font-semibold text-[var(--muted)]">Poznámka</span>
        <input name="note" placeholder="Volitelná poznámka" disabled={busy}
          className="finance-field mt-1.5 w-full text-[12px]" />
      </label>

      <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
        Tento záznam nemění aktuální bankovní zůstatek ani hodnotu účtu. Zůstatky se zadávají samostatně mezi ručním majetkem.
      </p>

      {message ? <p role={messageKind === "error" ? "alert" : "status"} aria-live="polite"
        className={["mt-3 rounded-xl border p-3 text-[11px] leading-5", messageKind === "error"
          ? "border-[var(--danger)]/25 bg-[var(--danger)]/[.05] text-[var(--danger)]"
          : "border-[var(--accent)]/20 bg-[var(--accent)]/[.05] text-[var(--accent)]"].join(" ")}>{message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="finance-action finance-action-primary !min-h-10 disabled:opacity-50">
          {busy ? "Ukládám…" : "Uložit transakci"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}
          className="finance-action !min-h-10 disabled:opacity-50">Zrušit</button>
      </div>
    </form>
  );
}
