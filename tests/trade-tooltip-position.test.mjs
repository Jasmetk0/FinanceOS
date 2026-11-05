import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeTradeTooltip } from "../lib/shared/trade-tooltip-position.mjs";

const viewport = { left: 0, top: 0, width: 1752, height: 864 };
const size = { width: 300, height: 370 };
const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("a trade marker near the right edge flips its card left", () => {
  const result = placeTradeTooltip({ x: 1645, y: 420 }, size, viewport);
  assert.deepEqual(result, { x: 1331, y: 434 });
  assert.ok(result.x + size.width <= viewport.width - 8);
  assert.ok(result.x > 0);
});

test("near-bottom + right corner flips the tooltip above and left", () => {
  const result = placeTradeTooltip({ x: 1720, y: 840 }, size, viewport);
  assert.deepEqual(result, { x: 1406, y: 456 });
  assert.ok(result.x >= 8 && result.x + size.width <= viewport.width - 8);
  assert.ok(result.y >= 8 && result.y + size.height <= viewport.height - 8);
});

test("normal cursor location opens the card below and to the right", () => {
  assert.deepEqual(placeTradeTooltip({ x: 120, y: 180 }, size, viewport),
    { x: 134, y: 194 });
});

test("a narrow viewport clamps the card without negative positioning", () => {
  const small = { left: 0, top: 0, width: 280, height: 320 };
  const result = placeTradeTooltip({ x: 270, y: 290 }, { width: 264, height: 304 }, small);
  assert.deepEqual(result, { x: 8, y: 8 });
});

test("pinch-zoom visualViewport offsets are respected", () => {
  const visual = { left: 210, top: 110, width: 420, height: 480 };
  const result = placeTradeTooltip({ x: 600, y: 540 }, { width: 300, height: 350 }, visual);
  assert.ok(result.x >= visual.left + 8);
  assert.ok(result.x + 300 <= visual.left + visual.width - 8);
  assert.ok(result.y >= visual.top + 8);
  assert.ok(result.y + 350 <= visual.top + visual.height - 8);
});

test("tooltip is measured in the viewport and rendered outside clipping parents", () => {
  const chart = source("components/position-price-chart.tsx");
  const ui = source("components/ui.tsx");
  assert.ok(ui.includes("min-w-0 overflow-hidden"), "Chart parent is clipped by the section.");
  assert.ok(chart.includes("createPortal("), "Tooltip must escape the chart scroll and section.");
  assert.ok(chart.includes("document.body"), "Tooltip is rendered at the document root.");
  assert.ok(chart.includes("tooltipRef.current?.getBoundingClientRect()"), "Use actual tooltip size.");
  assert.ok(chart.includes("window.visualViewport"), "Support narrow and zoomed layouts.");
  assert.ok(chart.includes("placeTradeTooltip("), "Use collision-aware placement.");
  assert.ok(chart.includes('role="tooltip"'), "Preserve accessible tooltip semantics.");
  assert.ok(chart.includes('aria-label="Zavřít kartu obchodu"'), "Pinned tooltip remains closable.");
  assert.ok(!chart.includes("const height = 348"), "No guessed fixed card height.");
});
