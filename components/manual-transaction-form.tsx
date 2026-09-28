"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ManualTransactionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: String(data.get("kind") || "income"),
          amount: Number(data.get("amount")),
          currency: String(data.get("currency") || "CZK"),
          occurredAt: new Date(String(data.get("occurredAt"))).toISOString(),
          note: String(data.get("note") || ""),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Uložení selhalo.");

      form.reset();
      setMessage("Uloženo.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        {message ? <span className="text-xs text-[var(--muted)]">{message}</span> : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
        >
          + Add manual transaction
        </button>
      </div>
    );
  }

  return (
    <form
      className="w-full max-w-2xl rounded-2xl border border-white/8 bg-[var(--panel)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="text-xs text-[var(--muted)]">Type</span>
          <select
            name="kind"
            defaultValue="income"
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
          >
            <option value="income">Income / salary</option>
            <option value="gift">Gift</option>
            <option value="expense">Expense</option>
            <option value="interest">Interest</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="fee">Fee</option>
            <option value="adjustment">Balance adjustment</option>
          </select>
        </label>
        <label>
          <span className="text-xs text-[var(--muted)]">Amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
          />
        </label>
        <label>
          <span className="text-xs text-[var(--muted)]">Currency</span>
          <input
            name="currency"
            defaultValue="CZK"
            required
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
          />
        </label>
        <label>
          <span className="text-xs text-[var(--muted)]">Date</span>
          <input
            name="occurredAt"
            type="datetime-local"
            defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)}
            required
            className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-xs text-[var(--muted)]">Note</span>
        <input
          name="note"
          placeholder="Např. výplata, narozeniny, nájem…"
          className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
        />
      </label>

      {message ? <p className="mt-3 text-xs text-[var(--muted)]">{message}</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--muted)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
