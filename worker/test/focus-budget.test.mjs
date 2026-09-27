// Focus-trace budget regression. The coverage guard in checkFocusDepth only
// fires when `trace.length >= focusable` — a census larger than the press
// budget can never prove a coverage gap (or prove the page clean). The cap
// used to flatten at 24 presses for >40 focusables, silently disabling the
// wcag-2.4.3 coverage finding on the pages that need it most. The shipped
// `maxTab` expression is lifted out of src/scrape.ts and exercised across
// every census band, so the test cannot drift from the implementation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/scrape.ts"),
  "utf8",
);

const impl = src.match(/const maxTab = ([^;]+);/);
assert.ok(impl, "maxTab expression not found in src/scrape.ts");
const maxTab = new Function("focusable", `return ${impl[1]};`);

test("trace budget keeps the 24-press floor for small/zero censuses", () => {
  for (const f of [0, 1, 10, 22]) assert.equal(maxTab(f), 24, `focusable=${f}`);
});

test("trace budget tracks the census with +2 slack through the ceiling", () => {
  assert.equal(maxTab(23), 25);
  assert.equal(maxTab(40), 42);
  assert.equal(maxTab(62), 64);
});

test("trace budget is capped at 64 presses", () => {
  for (const f of [63, 64, 65, 100, 1184]) assert.equal(maxTab(f), 64, `focusable=${f}`);
});

test("every census up to the ceiling can satisfy the coverage guard", () => {
  // checkFocusDepth requires trace.length >= focusable before it will report
  // unreached elements — the budget must therefore reach the census.
  for (let f = 1; f <= 64; f++) assert.ok(maxTab(f) >= f, `focusable=${f}`);
});

test("budget never exceeds the ceiling and never drops below the floor", () => {
  for (let f = 0; f <= 2000; f++) {
    assert.ok(maxTab(f) >= 24, `focusable=${f}`);
    assert.ok(maxTab(f) <= 64, `focusable=${f}`);
    if (f > 0) assert.ok(maxTab(f) >= maxTab(f - 1), `non-monotonic at ${f}`);
  }
});

test("occlusion probe prefers the first client rect over the union rect", () => {
  // getBoundingClientRect() returns the union of a wrapped inline element's
  // fragments — its centre can land on a sibling between lines, producing
  // wcag-2.4.11 false positives (verified live on focusable-clean.html). The
  // merged probe must derive `r` from getClientRects()[0] — the first real
  // fragment — keeping the union rect only as a zero-fragment fallback.
  assert.match(
    src,
    /const r = \([^\n]*getClientRects\(\)\[0\]\s*\?\?/,
    "occlusion probe must sample getClientRects()[0] before the union rect",
  );
});
