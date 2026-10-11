import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("navigation groups are readable and all main destinations remain reachable", () => {
  const shell = read("components/app-shell.tsx");
  for (const route of [
    "/", "/accounts", "/investments", "/performance", "/cash-flow",
    "/history", "/insights", "/plan", "/analyst", "/reports",
    "/transactions", "/journal", "/connections", "/settings",
  ]) {
    assert.ok(shell.includes('href: "' + route + '"'), "Missing navigation destination " + route);
  }
  assert.ok(shell.includes('title: "Portfolio"'));
  assert.ok(shell.includes('title: "Analýza a plánování"'));
  assert.ok(shell.includes('title: "Evidence"'));
  assert.ok(shell.includes('title: "Nastavení"'));
  assert.equal(shell.includes(">Demo<"), false, "Do not mislabel a real local portfolio as a demo");
});

test("keyboard, mobile and accessibility essentials are present", () => {
  const shell = read("components/app-shell.tsx");
  assert.ok(shell.includes('event.key.toLowerCase() === "k"'));
  assert.ok(shell.includes('event.key === "Escape"'));
  assert.ok(shell.includes('aria-modal="true"'));
  assert.ok(shell.includes('aria-current={active ? "page" : undefined}'));
  assert.ok(shell.includes('href="#main-content"'));
  assert.ok(shell.includes('id="main-content"'));
  assert.ok(shell.includes('prefetch={false}'));
});

test("sync communicates partial provider failures rather than implying success", () => {
  const source = read("components/sync-button.tsx");
  assert.ok(source.includes('response.status !== 207'));
  assert.ok(source.includes('failed.length'));
  assert.ok(source.includes('tone: "warning"'));
  assert.ok(source.includes('aria-live="polite"'));
});

test("chart supports keyboard inspection and announces active filter buttons", () => {
  const chart = read("components/portfolio-history-chart.tsx");
  assert.ok(chart.includes("tabIndex={0}"));
  assert.ok(chart.includes('event.key === "ArrowLeft"'));
  assert.ok(chart.includes('event.key === "ArrowRight"'));
  assert.ok(chart.includes("aria-pressed={metric === value}"));
  assert.ok(chart.includes("aria-pressed={period === value}"));
});

test("dashboard surfaces stale valuations without assigning a made-up current value", () => {
  const page = read("app/page.tsx");
  assert.ok(page.includes('account.dataFreshness.status === "stale"'));
  assert.ok(page.includes("Poslední hodnotu nezaměňuj za dnešní ocenění"));
  assert.ok(page.includes('href="/cash-flow"') || page.includes('{ href: "/cash-flow"'));
});
