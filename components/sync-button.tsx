"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runSync() {
    setRunning(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        results?: Array<{ provider: string; ok: boolean; error?: string }>;
        error?: string;
      };

      if (!response.ok && response.status !== 207) {
        throw new Error(data.error || "Synchronizace selhala.");
      }

      const failed = data.results?.filter((item) => !item.ok) ?? [];
      if (failed.length) {
        setMessage(
          failed.map((item) => `${item.provider}: ${item.error || "error"}`).join(" · "),
        );
      } else {
        setMessage("Synchronizováno");
      }

      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-col items-start gap-2 sm:items-end"}>
      <button
        type="button"
        onClick={runSync}
        disabled={running}
        className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
      >
        {running ? "Synchronizuji…" : "Sync now"}
      </button>
      {message ? (
        <p className="max-w-sm text-xs leading-5 text-[var(--muted)]">{message}</p>
      ) : null}
    </div>
  );
}
