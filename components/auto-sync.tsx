"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FIRST_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const PERIODIC_SYNC_MS = 15 * 60 * 1000;
const BACKFILL_RETRY_MS = 2 * 60 * 1000;
const SESSION_KEY = "financeos:last-auto-sync";

function needsTrading212BackfillRetry(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const root = payload as { results?: unknown[] };
  if (!Array.isArray(root.results)) return false;

  for (const item of root.results) {
    if (!item || typeof item !== "object") continue;
    const result = item as {
      provider?: unknown;
      ok?: unknown;
      detail?: unknown;
    };
    if (result.provider !== "trading212" || result.ok !== true) continue;
    if (!result.detail || typeof result.detail !== "object") continue;

    const detail = result.detail as {
      historyBackfill?: {
        ordersComplete?: unknown;
        dividendsComplete?: unknown;
        cashComplete?: unknown;
      };
      cardSync?: { status?: unknown };
      dailyHistory?: {
        assetsPending?: unknown;
        partialDays?: unknown;
      };
    };

    const history = detail.historyBackfill;
    if (
      history &&
      (
        history.ordersComplete !== true ||
        history.dividendsComplete !== true ||
        history.cashComplete !== true
      )
    ) {
      return true;
    }

    const cardStatus = detail.cardSync?.status;
    if (
      cardStatus === "requested" ||
      cardStatus === "requested-fallback-window" ||
      cardStatus === "waiting"
    ) {
      return true;
    }

    const dailyHistory = detail.dailyHistory;
    if (
      dailyHistory &&
      (
        Number(dailyHistory.assetsPending || 0) > 0 ||
        Number(dailyHistory.partialDays || 0) > 0
      )
    ) {
      return true;
    }
  }

  return false;
}

export function AutoSync() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let backfillTimer: number | null = null;

    function scheduleBackfillRetry() {
      if (cancelled || backfillTimer !== null) return;
      backfillTimer = window.setTimeout(() => {
        backfillTimer = null;
        sessionStorage.setItem(SESSION_KEY, "0");
        void run();
      }, BACKFILL_RETRY_MS);
    }

    async function run() {
      if (running.current || cancelled) return;

      const previous = Number(sessionStorage.getItem(SESSION_KEY) || "0");
      if (Date.now() - previous < FIRST_SYNC_COOLDOWN_MS) return;

      running.current = true;
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));

      try {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const payload = await response.json().catch(() => null);
        if (needsTrading212BackfillRetry(payload)) {
          scheduleBackfillRetry();
        }
        if (!cancelled) router.refresh();
      } catch {
        // Individual provider errors are persisted by the server and shown on
        // the Connections screen. Auto-sync should never break navigation.
      } finally {
        running.current = false;
      }
    }

    void run();

    const interval = window.setInterval(() => {
      sessionStorage.setItem(SESSION_KEY, "0");
      void run();
    }, PERIODIC_SYNC_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (backfillTimer !== null) {
        window.clearTimeout(backfillTimer);
      }
    };
  }, [router]);

  return null;
}
