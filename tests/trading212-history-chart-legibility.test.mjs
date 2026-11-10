import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("one-provider chart renders one total/provider series, not two overlapping paths", () => {
  const s = source("components/portfolio-history-chart.tsx");
  assert.match(s, /singleProviderDuplicate = data\.providers\.length === 1/);
  assert.ok(s.includes("const showTotalSeries = showTotal && !singleProviderDuplicate"));
  assert.ok(s.includes('{showTotalSeries ? ('));
  assert.ok(s.includes('metric === "value" && showEstimates && showTotalSeries'));
  assert.ok(s.includes('hoverPoint.total.valueCzk === null'));
  assert.ok(s.includes('providerLabel(provider) + (estimated ? " · neověřený odhad" : "")'));
});

test("historical estimates remain available, but incomplete cash flows do not squash value scale", () => {
  const s = source("components/portfolio-history-chart.tsx");
  assert.ok(s.includes("const [showEstimates, setShowEstimates] = useState(true)"));
  assert.ok(s.includes("const [showContributions, setShowContributions] = useState(false)"));
  assert.ok(s.includes('metric === "value" && showContributions && showAnySeries'));
  assert.ok(s.includes("Pozor: známé čisté pohyby jsou"));
  assert.ok(s.includes("není potvrzený celoživotní výsledek"));
  assert.ok(s.includes("Kapitál pro P/L:"));
  assert.ok(s.includes("Připsané přesuny kapitálu:"));
  assert.ok(s.includes("Rekonstrukce z dostupných údajů, nikoli ověřený stav"));
});

test("history remains true to data; partial valuations never become verified P/L", () => {
  const s = source("lib/server/analytics.ts");
  assert.ok(s.includes("estimatedValueCzk: !complete"));
  assert.ok(s.includes("snapshotQuality === \"partial\""));
  assert.ok(s.includes("complete ? totalValue : null"));
  assert.ok(s.includes("const cashFlows: PortfolioCashFlowPoint[]"));
});
