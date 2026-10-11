import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("connections are compact and navigation reaches actual import and diagnostics targets", () => {
  const manager = source("components/connections-manager.tsx");
  const page = source("app/connections/page.tsx");
  assert.ok(manager.includes("sm:grid-cols-2 xl:grid-cols-3"));
  for (const fragment of ["connection-live", "connection-imports", "connection-health"]) {
    assert.ok(page.includes('href: "#' + fragment + '"'), "Missing anchor to " + fragment);
    assert.ok(page.includes('id="' + fragment + '"'), "Missing element " + fragment);
  }
  assert.ok(page.includes("<MintosImporter initialStatus={mintosStatus} />"));
  assert.ok(page.includes("<InvestownImporter initialStatus={investownStatus} />"));
  assert.ok(page.includes("<ConnectionsManager initialConnections={connections} />"));
});

test("connections display truthful connection versus initial sync states", () => {
  const manager = source("components/connections-manager.tsx");
  assert.ok(manager.includes('type Stage = "connecting" | "syncing" | "disconnecting"'));
  assert.ok(manager.includes("await syncOne(provider, true)"));
  assert.ok(manager.includes("Připojení bylo uloženo, ale první synchronizace selhala:"));
  assert.ok(manager.includes("Synchronizace se nezdařila."));
  assert.ok(manager.includes('status: "warning"'));
  assert.ok(manager.includes('status: "success"'));
  assert.ok(manager.includes('status: "error"'));
  assert.ok(manager.includes('aria-live="polite"'));
});

test("credentials remain masked and read-only security instructions remain prominent", () => {
  const manager = source("components/connections-manager.tsx");
  assert.ok(manager.includes('name="apiKey" type="password"'));
  assert.ok(manager.includes('name="apiSecret" type="password"'));
  assert.ok(manager.includes('name="address" type="text"'));
  assert.ok(manager.includes("Seed phrase, recovery phrase ani private key"));
  assert.ok(manager.includes("nikdy obchodování ani výběry"));
  assert.ok(manager.includes("window.confirm("));
  assert.ok(manager.includes("Dříve synchronizovaná historie zůstane v lokální databázi."));
});

test("connection diagnostics are visible by default if known data quality risks exist", () => {
  const page = source("app/connections/page.tsx");
  assert.ok(page.includes("const diagnosticsAttention ="));
  assert.ok(page.includes("krakenStatus.key.hasHistoryRestriction"));
  assert.ok(page.includes("krakenStatus.funding.unclassifiedTransfers > 0"));
  assert.ok(page.includes("phantomStatus.unpricedTokenCount > 0"));
  assert.ok(page.includes("trading212Card.unresolvedCashInCount > 0"));
  assert.ok(page.includes("<details open={diagnosticsAttention}"));
  assert.ok(page.includes("Vyžaduje pozornost"));
});

test("Mintos importer announces parsing and row counts without modifying import classification", () => {
  const mintos = source("components/mintos-importer.tsx");
  assert.ok(mintos.includes("setReading(true)"));
  assert.ok(mintos.includes("setReading(false)"));
  assert.ok(mintos.includes("files.reduce((sum, file) => sum + file.csv.rows.length, 0)"));
  assert.ok(mintos.includes("před deduplikací"));
  assert.ok(mintos.includes('aria-busy={busy || reading}'));
  assert.ok(mintos.includes('aria-live="polite"'));
  assert.ok(mintos.includes('messageKind === "error" ? "alert" : "status"'));
  assert.ok(mintos.includes('fetch("/api/import/mintos"'));
  assert.ok(mintos.includes("replaceExisting: true"));
});

test("Investown retains read-only preview and explicit confirmation while improving status", () => {
  const investown = source("components/investown-importer.tsx");
  assert.ok(investown.includes("setReading(true)"));
  assert.ok(investown.includes("setReading(false)"));
  assert.ok(investown.includes("csv.rows.length.toLocaleString"));
  assert.ok(investown.includes("Krok 1/3"));
  assert.ok(investown.includes('aria-busy={busy || reading}'));
  assert.ok(investown.includes('messageKind === "error" ? "alert" : "status"'));
  assert.ok(investown.includes("Preview změn před importem"));
  assert.ok(investown.includes("Potvrdit a provést import"));
  assert.ok(investown.includes("pendingPreview.previewToken"));
  assert.ok(investown.includes("dryRun"));
  assert.ok(investown.includes("replaceExisting: false"));
});
