"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RestoreBackup() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!file) return;
    if (
      !window.confirm(
        "Importovat FinanceOS backup? Existující záznamy se nemažou; shodná ID budou aktualizována.",
      )
    ) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const payload = (await response.json()) as {
        result?: Record<string, number>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Restore failed.");
      }

      const restored = payload.result || {};
      setMessage(
        "Obnova dokončena · " +
          String(restored.transactions || 0) +
          " transakcí · " +
          String(restored.snapshots || 0) +
          " snapshotů.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept=".json,application/json"
        className="block w-full text-xs text-[var(--muted)]"
        onChange={(event) => setFile(event.target.files?.[0] || null)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void restore()}
          disabled={!file || busy}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Restoring…" : "Restore backup"}
        </button>
        {message ? (
          <span className="text-xs leading-5 text-[var(--muted)]">{message}</span>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">
        Restore je merge-only. API klíče backup neobsahuje, takže je po přesunu
        na jiný počítač připojíš znovu.
      </p>
    </div>
  );
}
