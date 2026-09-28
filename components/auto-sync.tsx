"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FIRST_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const PERIODIC_SYNC_MS = 15 * 60 * 1000;
const SESSION_KEY = "financeos:last-auto-sync";

export function AutoSync() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (running.current || cancelled) return;

      const previous = Number(sessionStorage.getItem(SESSION_KEY) || "0");
      if (Date.now() - previous < FIRST_SYNC_COOLDOWN_MS) return;

      running.current = true;
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));

      try {
        await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
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
    };
  }, [router]);

  return null;
}
