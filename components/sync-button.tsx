"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type SyncFeedback = { tone: "success" | "warning" | "error"; text: string };

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

  async function runSync() {
    if (running) return;
    setRunning(true);
    setFeedback(null);

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
        throw new Error(data.error || "Synchronizace se nezdařila.");
      }

      const failed = data.results?.filter((item) => !item.ok) ?? [];
      if (failed.length) {
        setFeedback({
          tone: "warning",
          text: "Část účtů se nepodařilo aktualizovat: " +
            failed.map((item) => item.provider + (item.error ? " (" + item.error + ")" : "")).join("; "),
        });
      } else if (data.ok === false) {
        throw new Error(data.error || "Synchronizace není kompletní.");
      } else {
        setFeedback({ tone: "success", text: "Synchronizace dokončena. Údaje byly obnoveny." });
      }

      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Synchronizace se nezdařila.",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "flex min-w-0 flex-col gap-2" : "flex min-w-0 flex-col items-start gap-2 sm:items-end"}>
      <button
        type="button"
        onClick={runSync}
        disabled={running}
        aria-busy={running}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--background)] shadow-[0_8px_25px_rgba(66,203,153,.13)] transition hover:bg-[#8aefc8] disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={running ? "animate-spin" : ""}>
          <path d="M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5M4 13a8 8 0 0 0 14 5l2-2m0 5v-5h-5" />
        </svg>
        {running ? "Synchronizuji…" : "Synchronizovat"}
      </button>
      <div role="status" aria-live="polite" aria-atomic="true" className="max-w-sm">
        {feedback ? (
          <p className={["text-xs leading-5", feedback.tone === "success" ? "text-[var(--accent)]" : feedback.tone === "warning" ? "text-[var(--warning)]" : "text-[var(--danger)]"].join(" ")}>
            {feedback.text}
            {feedback.tone !== "success" ? <Link href="/connections" className="ml-1 font-semibold underline underline-offset-2 hover:text-white">Propojení →</Link> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
