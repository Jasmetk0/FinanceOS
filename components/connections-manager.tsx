"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { providerColor } from "@/lib/provider-visuals";

type LiveProvider = "trading212" | "kraken" | "phantom";
type Stage = "connecting" | "syncing" | "disconnecting";
type Feedback = { provider: LiveProvider; status: "success" | "warning" | "error"; text: string };

function liveProviderLabel(provider: LiveProvider) {
  if (provider === "trading212") return "Trading 212";
  if (provider === "kraken") return "Kraken";
  return "Phantom";
}

interface ConnectionSafe {
  provider: string;
  label: string;
  environment: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

function providerConnection(connections: ConnectionSafe[], provider: string) {
  return connections.find((item) => item.provider === provider);
}

function safeDate(value: string | null) {
  if (!value) return "Zatím nikdy";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Neznámý čas" : date.toLocaleString("cs-CZ");
}

function Status({ connection }: { connection?: ConnectionSafe }) {
  if (!connection) {
    return <span className="rounded-full border border-[var(--border)] bg-white/[.025] px-2.5 py-1 text-[10px] font-semibold text-[var(--muted)]">Nepřipojeno</span>;
  }
  const error = connection.status === "error";
  return (
    <span className={["rounded-full border px-2.5 py-1 text-[10px] font-semibold",
      error ? "border-[var(--danger)]/25 bg-[var(--danger)]/[.075] text-[var(--danger)]"
        : "border-[var(--accent)]/25 bg-[var(--accent)]/[.075] text-[var(--accent)]",
    ].join(" ")}>
      {error ? "Vyžaduje pozornost" : "Připojeno"}
    </span>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ConnectionsManager({ initialConnections }: { initialConnections: ConnectionSafe[] }) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [busy, setBusy] = useState<{ provider: LiveProvider; stage: Stage } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [expanded, setExpanded] = useState<LiveProvider | null>(null);

  const connectedCount = useMemo(
    () => (["trading212", "kraken", "phantom"] as const).filter((provider) => Boolean(providerConnection(connections, provider))).length,
    [connections],
  );
  const errorCount = connections.filter((connection) => connection.status === "error").length;

  async function refreshConnections() {
    const response = await fetch("/api/connections", { cache: "no-store" });
    if (!response.ok) throw new Error("Nepodařilo se načíst aktualizovaný stav připojení.");
    const data = (await response.json()) as { connections?: ConnectionSafe[] };
    if (data.connections) setConnections(data.connections);
    router.refresh();
  }

  async function syncOne(provider: LiveProvider, startedFromConnect = false) {
    setBusy({ provider, stage: "syncing" });
    setFeedback(null);
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
      if (!result?.ok) throw new Error(result?.error || data.error || "Synchronizace se nezdařila.");

      setFeedback({ provider, status: "success", text: liveProviderLabel(provider) + " · synchronizace dokončena. Zkontroluj případná upozornění na neúplnou historii." });
      try {
        await refreshConnections();
      } catch {
        router.refresh();
      }
    } catch (error) {
      setFeedback({
        provider,
        status: "warning",
        text: (startedFromConnect ? "Připojení bylo uloženo, ale první synchronizace selhala: " : "Synchronizace selhala: ") + errorText(error),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function connect(provider: LiveProvider, form: HTMLFormElement) {
    if (busy) return;
    setBusy({ provider, stage: "connecting" });
    setFeedback(null);
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          environment:
            provider === "trading212" ? String(formData.get("environment") || "live")
              : provider === "phantom" ? "solana-mainnet" : "live",
          apiKey: String(formData.get("apiKey") || ""),
          apiSecret: String(formData.get("apiSecret") || ""),
          address: String(formData.get("address") || ""),
        }),
      });
      const data = (await response.json()) as { connections?: ConnectionSafe[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Připojení se nezdařilo.");

      if (data.connections) setConnections(data.connections);
      form.reset();
      setExpanded(null);
      await syncOne(provider, true);
    } catch (error) {
      setFeedback({ provider, status: "error", text: liveProviderLabel(provider) + " · připojení nebylo dokončeno: " + errorText(error) });
      setBusy(null);
    }
  }

  async function disconnect(provider: LiveProvider) {
    if (busy || !window.confirm("Odpojit " + liveProviderLabel(provider) + "? Dříve synchronizovaná historie zůstane v lokální databázi.")) return;
    setBusy({ provider, stage: "disconnecting" });
    setFeedback(null);
    try {
      const response = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as { connections?: ConnectionSafe[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Odpojení se nezdařilo.");
      if (data.connections) setConnections(data.connections);
      setFeedback({ provider, status: "success", text: liveProviderLabel(provider) + " odpojen. Dřívější historie nebyla smazána." });
      router.refresh();
    } catch (error) {
      setFeedback({ provider, status: "error", text: liveProviderLabel(provider) + " · odpojení selhalo: " + errorText(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] px-4 py-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--foreground)]">Živá API propojení</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{connectedCount} ze 3 poskytovatelů připojeno{errorCount ? " · " + errorCount + " chybových stavů" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <a href="#connection-imports" className="finance-action !min-h-9 !px-3">Importovat výpisy ↓</a>
          <a href="#connection-health" className="finance-action !min-h-9 !px-3">Diagnostika ↓</a>
        </div>
      </div>
      {feedback ? (
        <div role="status" aria-live="polite" aria-atomic="true"
          className={["rounded-xl border px-4 py-3 text-[12px] leading-5",
            feedback.status === "error" ? "border-[var(--danger)]/25 bg-[var(--danger)]/[.06] text-[var(--danger)]"
            : feedback.status === "warning" ? "border-[var(--warning)]/25 bg-[var(--warning)]/[.06] text-[var(--warning)]"
            : "border-[var(--accent)]/25 bg-[var(--accent)]/[.055] text-[var(--accent)]",
          ].join(" ")}>
          <span className="font-semibold">{liveProviderLabel(feedback.provider)} · </span>{feedback.text}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ProviderCard
          provider="trading212"
          title="Trading 212"
          description="Portfolio, pozice a historie. Pouze read-only oprávnění."
          connection={providerConnection(connections, "trading212")}
          stage={busy?.provider === "trading212" ? busy.stage : null}
          disabled={Boolean(busy)}
          expanded={expanded === "trading212"}
          onExpand={() => setExpanded(expanded === "trading212" ? null : "trading212")}
          onSubmit={(form) => void connect("trading212", form)}
          onDisconnect={() => void disconnect("trading212")}
          onSync={() => void syncOne("trading212")}
        >
          <label className="block text-[12px]">
            <span className="text-[var(--muted)]">Prostředí</span>
            <select name="environment" defaultValue="live" className="finance-field mt-1.5 w-full text-[12px]">
              <option value="live">Live</option>
              <option value="demo">Demo</option>
            </select>
          </label>
        </ProviderCard>
        <ProviderCard
          provider="kraken"
          title="Kraken"
          description="Spot zůstatky, historie obchodů a účetní ledger."
          connection={providerConnection(connections, "kraken")}
          stage={busy?.provider === "kraken" ? busy.stage : null}
          disabled={Boolean(busy)}
          expanded={expanded === "kraken"}
          onExpand={() => setExpanded(expanded === "kraken" ? null : "kraken")}
          onSubmit={(form) => void connect("kraken", form)}
          onDisconnect={() => void disconnect("kraken")}
          onSync={() => void syncOne("kraken")}
        />
        <ProviderCard
          provider="phantom"
          title="Phantom (Solana)"
          description="Watch-only sledování veřejné adresy. Nikdy seed phrase."
          connection={providerConnection(connections, "phantom")}
          stage={busy?.provider === "phantom" ? busy.stage : null}
          disabled={Boolean(busy)}
          expanded={expanded === "phantom"}
          onExpand={() => setExpanded(expanded === "phantom" ? null : "phantom")}
          onSubmit={(form) => void connect("phantom", form)}
          onDisconnect={() => void disconnect("phantom")}
          onSync={() => void syncOne("phantom")}
          credentialMode="phantom"
        />
      </div>
    </div>
  );
}

function ProviderCard({
  provider, title, description, connection, stage, disabled, expanded,
  onExpand, onSubmit, onDisconnect, onSync, children, credentialMode = "api",
}: {
  provider: LiveProvider;
  title: string;
  description: string;
  connection?: ConnectionSafe;
  stage: Stage | null;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onSubmit: (form: HTMLFormElement) => void;
  onDisconnect: () => void;
  onSync: () => void;
  children?: ReactNode;
  credentialMode?: "api" | "phantom";
}) {
  const color = providerColor(provider);
  return (
    <article className="finance-account-card relative min-w-0 overflow-hidden px-4 py-4">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg," + color + ",transparent 75%)" }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{description}</p>
        </div>
        <Status connection={connection} />
      </div>

      {connection ? (
        <div className="mt-4">
          <p className="text-[11px] text-[var(--muted)]">
            Poslední synchronizace: <span className="font-medium text-[var(--foreground)]">{safeDate(connection.lastSyncedAt)}</span>
          </p>
          {connection.lastError ? (
            <p role="alert" className="mt-3 break-words rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/[.045] p-3 text-[11px] leading-5 text-[var(--danger)]">
              {connection.lastError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={disabled} onClick={onSync}
              className="finance-action finance-action-primary !min-h-9 !px-3">
              {stage === "syncing" ? "Synchronizuji…" : "Synchronizovat"}
            </button>
            <button type="button" disabled={disabled} onClick={onExpand}
              aria-expanded={expanded} aria-controls={"provider-details-" + provider}
              className="finance-action !min-h-9 !px-3">
              {expanded ? "Skrýt detaily" : "Detaily"}
            </button>
          </div>
          {expanded ? (
            <div id={"provider-details-" + provider} className="mt-3 rounded-xl border border-[var(--border)] bg-black/[.10] p-3">
              <dl className="grid gap-3 text-[11px] sm:grid-cols-2">
                <div><dt className="text-[var(--muted)]">Prostředí</dt><dd className="mt-1 font-semibold">{connection.environment}</dd></div>
                <div><dt className="text-[var(--muted)]">Stav API</dt><dd className="mt-1 font-semibold">{connection.status}</dd></div>
              </dl>
              <button type="button" disabled={disabled} onClick={onDisconnect}
                className="mt-3 rounded-lg border border-[var(--danger)]/25 px-3 py-2 text-[11px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/[.06] disabled:opacity-50">
                {stage === "disconnecting" ? "Odpojuji…" : "Odpojit poskytovatele"}
              </button>
              <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Odpojení nemaže historické záznamy.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          <button type="button" onClick={onExpand} disabled={disabled}
            aria-expanded={expanded} aria-controls={"provider-details-" + provider}
            className="finance-action finance-action-primary w-full !min-h-9">
            {expanded ? "Skrýt formulář" : credentialMode === "phantom" ? "Přidat veřejnou adresu" : "Připojit API"}
          </button>
          {expanded ? (
            <form id={"provider-details-" + provider} className="mt-3 space-y-3 rounded-xl border border-[var(--border)] bg-black/[.11] p-3"
              onSubmit={(event) => { event.preventDefault(); onSubmit(event.currentTarget); }}>
              {children}
              {credentialMode === "phantom" ? (
                <>
                  <label className="block text-[11px] text-[var(--muted)]">
                    Veřejná Solana adresa
                    <input name="address" type="text" autoComplete="off" required spellCheck={false}
                      placeholder="Veřejná adresa z Phantom Receive"
                      className="finance-field mt-1.5 w-full font-mono text-[11px]" />
                  </label>
                  <p className="text-[11px] leading-5 text-[var(--muted)]">
                    Zadávej jen veřejnou Solana adresu. Seed phrase, recovery phrase ani private key do FinanceOS nikdy nezadávej.
                  </p>
                </>
              ) : (
                <>
                  <label className="block text-[11px] text-[var(--muted)]">
                    API klíč
                    <input name="apiKey" type="password" autoComplete="off" required className="finance-field mt-1.5 w-full text-[12px]" />
                  </label>
                  <label className="block text-[11px] text-[var(--muted)]">
                    API secret / private key
                    <input name="apiSecret" type="password" autoComplete="off" required className="finance-field mt-1.5 w-full text-[12px]" />
                  </label>
                  <p className="text-[10px] leading-4 text-[var(--muted)]">Povol pouze čtení účtu, nikdy obchodování ani výběry.</p>
                </>
              )}
              <button type="submit" disabled={disabled} className="finance-action finance-action-primary w-full !min-h-10">
                {stage === "connecting" ? "Ověřuji připojení…" : stage === "syncing" ? "První synchronizace…" : "Ověřit a připojit"}
              </button>
            </form>
          ) : null}
        </div>
      )}
      {stage ? (
        <p role="status" aria-live="polite" className="mt-3 text-[11px] font-semibold text-[var(--accent)]">
          {stage === "connecting" ? "Ověřuji přístup a ukládám připojení…" :
            stage === "syncing" ? "Načítám historii a stav z poskytovatele…" : "Odpojuji poskytovatele…"}
        </p>
      ) : null}
    </article>
  );
}
