"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface JournalEntry {
  id: string;
  symbol: string | null;
  title: string;
  thesis: string;
  createdAt: string;
  reviewAt: string | null;
  status: string;
}

export function JournalManager({
  initialEntries,
}: {
  initialEntries: JournalEntry[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: String(data.get("symbol") || ""),
          title: String(data.get("title") || ""),
          thesis: String(data.get("thesis") || ""),
          createdAt: String(data.get("createdAt") || ""),
          reviewAt: String(data.get("reviewAt") || ""),
        }),
      });

      const payload = (await response.json()) as {
        entries?: JournalEntry[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Save failed.");

      setEntries(payload.entries ?? []);
      setOpen(false);
      setMessage("Journal entry saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, status: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/journal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await response.json()) as {
        entries?: JournalEntry[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Update failed.");
      setEntries(payload.entries ?? []);
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Smazat tento journal entry?")) return;

    setBusy(true);
    try {
      const response = await fetch("/api/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as {
        entries?: JournalEntry[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Delete failed.");
      setEntries(payload.entries ?? []);
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm leading-6 text-[var(--muted)]">
            Ulož si důvod nákupu, očekávání a datum budoucí kontroly teze.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
          className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d]"
        >
          + New thesis
        </button>
      </div>

      {open ? (
        <form
          className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void add(event.currentTarget);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="text-xs text-[var(--muted)]">Symbol</span>
              <input
                name="symbol"
                placeholder="AMD"
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm uppercase"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Title</span>
              <input
                name="title"
                placeholder="Why I am buying"
                required
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Decision date</span>
              <input
                name="createdAt"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-[var(--muted)]">Review date</span>
              <input
                name="reviewAt"
                type="date"
                className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-xs text-[var(--muted)]">Thesis</span>
            <textarea
              name="thesis"
              required
              rows={5}
              placeholder="Co očekávám, proč to kupuji, co by mou tezi vyvrátilo…"
              className="mt-1.5 w-full resize-y rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm leading-6"
            />
          </label>

          {message ? (
            <p className="mt-3 text-xs text-[var(--muted)]">{message}</p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save thesis"}
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
      ) : message ? (
        <p className="mt-3 text-xs text-[var(--muted)]">{message}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {entries.length ? (
          entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-2xl border border-white/7 bg-white/[0.025] p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.symbol ? (
                      <Link
                        href={"/investments/" + encodeURIComponent(entry.symbol)}
                        className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/[0.05] px-2 py-1 text-xs font-semibold text-[var(--accent)]"
                      >
                        {entry.symbol}
                      </Link>
                    ) : null}
                    <span className="rounded-lg border border-white/8 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      {entry.status}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">{entry.title}</h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                    {entry.thesis}
                  </p>
                </div>

                <div className="shrink-0 text-left text-xs text-[var(--muted)] sm:text-right">
                  <p>
                    {new Date(entry.createdAt).toLocaleDateString("cs-CZ")}
                  </p>
                  <p className="mt-1">
                    Review:{" "}
                    {entry.reviewAt
                      ? new Date(entry.reviewAt).toLocaleDateString("cs-CZ")
                      : "—"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-white/7 pt-4">
                {entry.status !== "reviewed" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void patch(entry.id, "reviewed")}
                    className="rounded-lg border border-white/9 px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white"
                  >
                    Mark reviewed
                  </button>
                ) : null}
                {entry.status !== "closed" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void patch(entry.id, "closed")}
                    className="rounded-lg border border-white/9 px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white"
                  >
                    Close thesis
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                  className="rounded-lg border border-[var(--danger)]/20 px-3 py-1.5 text-xs text-[var(--danger)]"
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-[var(--muted)]">
            Zatím sis žádnou investiční tezi neuložil.
          </div>
        )}
      </div>
    </div>
  );
}
