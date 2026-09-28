"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ConnectionSafe {
  provider: string;
  label: string;
  environment: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

function providerConnection(
  connections: ConnectionSafe[],
  provider: string,
): ConnectionSafe | undefined {
  return connections.find((item) => item.provider === provider);
}

function Status({ connection }: { connection?: ConnectionSafe }) {
  if (!connection) {
    return (
      <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
        Not connected
      </span>
    );
  }

  const error = connection.status === "error";
  return (
    <span
      className={[
        "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider",
        error
          ? "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]"
          : "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--accent)]",
      ].join(" ")}
    >
      {connection.status}
    </span>
  );
}

export function ConnectionsManager({
  initialConnections,
}: {
  initialConnections: ConnectionSafe[];
}) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function connect(
    provider: "trading212" | "kraken",
    form: HTMLFormElement,
  ) {
    setBusy(provider);
    setMessage(null);
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          environment:
            provider === "trading212"
              ? String(formData.get("environment") || "live")
              : "live",
          apiKey: String(formData.get("apiKey") || ""),
          apiSecret: String(formData.get("apiSecret") || ""),
        }),
      });
      const data = (await response.json()) as {
        connections?: ConnectionSafe[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Connection failed.");

      setConnections(data.connections ?? []);
      form.reset();
      setMessage(`${provider === "trading212" ? "Trading 212" : "Kraken"} připojen.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: "trading212" | "kraken") {
    if (!window.confirm("Odpojit provider? Synchronizovaná historie zůstane v lokální databázi.")) {
      return;
    }

    setBusy(provider);
    setMessage(null);
    try {
      const response = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as {
        connections?: ConnectionSafe[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Disconnect failed.");
      setConnections(data.connections ?? []);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function syncOne(provider: "trading212" | "kraken") {
    setBusy(provider);
    setMessage(null);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as {
        results?: Array<{ ok: boolean; error?: string }>;
        error?: string;
      };
      const result = data.results?.[0];
      if (!result?.ok) throw new Error(result?.error || data.error || "Sync failed.");

      setMessage("Synchronizace dokončena.");
      router.refresh();

      const refreshed = await fetch("/api/connections", { cache: "no-store" });
      const refreshedData = (await refreshed.json()) as { connections?: ConnectionSafe[] };
      setConnections(refreshedData.connections ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const trading212 = providerConnection(connections, "trading212");
  const kraken = providerConnection(connections, "kraken");

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ProviderCard
          title="Trading 212"
          description="Read-only portfolio, positions and account history. Use an API key without trading permissions."
          connection={trading212}
          busy={busy === "trading212"}
          onSubmit={(form) => connect("trading212", form)}
          onDisconnect={() => disconnect("trading212")}
          onSync={() => syncOne("trading212")}
        >
          <label className="block">
            <span className="text-xs text-[var(--muted)]">Environment</span>
            <select
              name="environment"
              defaultValue="live"
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm"
            >
              <option value="live">Live</option>
              <option value="demo">Demo</option>
            </select>
          </label>
        </ProviderCard>

        <ProviderCard
          title="Kraken"
          description="Spot balances, trade history and ledger. The key should only have query permissions."
          connection={kraken}
          busy={busy === "kraken"}
          onSubmit={(form) => connect("kraken", form)}
          onDisconnect={() => disconnect("kraken")}
          onSync={() => syncOne("kraken")}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  title,
  description,
  connection,
  busy,
  onSubmit,
  onDisconnect,
  onSync,
  children,
}: {
  title: string;
  description: string;
  connection?: ConnectionSafe;
  busy: boolean;
  onSubmit: (form: HTMLFormElement) => void;
  onDisconnect: () => void;
  onSync: () => void;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-3xl border border-white/7 bg-[var(--panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
        </div>
        <Status connection={connection} />
      </div>

      {connection ? (
        <div className="mt-5">
          <dl className="grid gap-3 rounded-2xl border border-white/7 bg-white/[0.02] p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--muted)]">Environment</dt>
              <dd className="mt-1 font-medium">{connection.environment}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Last sync</dt>
              <dd className="mt-1 font-medium">
                {connection.lastSyncedAt
                  ? new Date(connection.lastSyncedAt).toLocaleString("cs-CZ")
                  : "Never"}
              </dd>
            </div>
          </dl>

          {connection.lastError ? (
            <p className="mt-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 p-3 text-xs leading-5 text-[var(--danger)]">
              {connection.lastError}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-60"
            >
              {busy ? "Working…" : "Sync now"}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--muted)] hover:text-white disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(event.currentTarget);
          }}
        >
          {children}
          <label className="block">
            <span className="text-xs text-[var(--muted)]">API key</span>
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]/50"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--muted)]">API secret / private key</span>
            <input
              name="apiSecret"
              type="password"
              autoComplete="off"
              required
              className="mt-1.5 w-full rounded-xl border border-white/9 bg-[#0b1511] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]/50"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#07100d] disabled:opacity-60"
          >
            {busy ? "Testing connection…" : "Test & connect"}
          </button>
        </form>
      )}
    </article>
  );
}
