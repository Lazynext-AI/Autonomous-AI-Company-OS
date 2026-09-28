// Campaign audience routing regressions. 'subscribed' broadcasts to opted-in
// email_contacts; 'engaged' targets crm_leads the Brevo click→engaged
// promotion flagged — a warm follow-up must never silently widen to the cold
// list. Lifted out of src/services.ts like brevo-engagement.test.mjs — the
// test cannot drift.
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
const m = src.match(/export function campaignSegment[\s\S]*?\n}/);
assert.ok(m, "campaignSegment not found in src/services.ts");
const js = ts.transpileModule(m[0].replace(/^export /, ""), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const campaignSegment = new Function(`${js}; return campaignSegment;`)();

test("missing/null segment falls back to subscribed broadcast", () => {
  for (const v of [undefined, null, "", "   "]) {
    const s = campaignSegment(v);
    assert.equal(s.seg, "subscribed");
    assert.match(s.sql, /FROM email_contacts WHERE subscribed = 1/);
    assert.equal(s.error, undefined);
  }
});

test("engaged segment reads click-promoted crm_leads, not the contact list", () => {
  const s = campaignSegment("engaged");
  assert.equal(s.seg, "engaged");
  assert.match(s.sql, /FROM crm_leads WHERE status = 'engaged'/);
  assert.equal(s.error, undefined);
});

test("unknown segments are rejected, never widened to a blast", () => {
  for (const v of ["all", "everyone", "crm", "subscribed ' OR 1=1 --"]) {
    const s = campaignSegment(v);
    assert.ok(s.error, `expected error for '${v}'`);
    assert.equal(s.sql, undefined);
  }
});
