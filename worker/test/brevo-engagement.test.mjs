// Brevo click -> crm_leads engagement promotion regressions. Click is the
// only high-intent signal (opens are Apple-MPP inflated); the stamp mirrors
// the "clicked-trial:<date>" format ops used before this was automated, so
// manually-stamped and auto-stamped rows read identically. Lifted out of
// src/services.ts like brevo-inbound.test.mjs — the test cannot drift.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/services.ts"),
  "utf8",
);
const m = src.match(/export function leadEngagement[\s\S]*?\n}/);
assert.ok(m, "leadEngagement not found in src/services.ts");
const js = ts.transpileModule(m[0].replace(/^export /, ""), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const leadEngagement = new Function(`${js}; return leadEngagement;`)();

const DAY = "2026-09-28";

test("click on a trial/checkout link stamps clicked-trial", () => {
  assert.equal(
    leadEngagement({ event: "click", link: "https://checker.lazynext.com/checkout" }, DAY),
    "clicked-trial:2026-09-28",
  );
  assert.equal(
    leadEngagement({ event: "click", link: "https://checker.lazynext.com/checkout?trial=extended" }, DAY),
    "clicked-trial:2026-09-28",
  );
});

test("click on any other link stamps clicked", () => {
  assert.equal(
    leadEngagement({ event: "click", link: "https://lazynext.com/pricing" }, DAY),
    "clicked:2026-09-28",
  );
  assert.equal(
    leadEngagement({ event: "click", link: null }, DAY),
    "clicked:2026-09-28",
  );
});

test("opens, deliveries and bounces never promote", () => {
  for (const event of ["opened", "unique_opened", "delivered", "hard_bounce",
    "soft_bounce", "spam", "unsubscribed", "blocked"]) {
    assert.equal(leadEngagement({ event, link: "https://x.test/checkout" }, DAY), null);
  }
});

test("event-name normalization matches the webhook (snake_case/camelCase)", () => {
  assert.equal(leadEngagement({ event: "Click", link: "/checkout" }, DAY), "clicked-trial:2026-09-28");
  assert.equal(leadEngagement({ event: "click" }, DAY), "clicked:2026-09-28");
});
