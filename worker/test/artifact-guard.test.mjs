// Doc-gutting guard regression. The shipped retainedLineFraction source is
// lifted out of src/index.ts and exercised directly (no drift between test
// and implementation), plus the call-site wiring is asserted: the guard must
// run inside executeTask before verifyArtifact, and bootstrap scaffold must
// never overwrite an existing file. A rewrite keeping under half of an
// existing file's lines is destruction — a fleet task replaced the measured
// perf baseline with generic prose (PR closed unmerged) while byte length
// stayed similar, so this checks retained lines, not size.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts"),
  "utf8",
);

const impl = src.match(/function retainedLineFraction[\s\S]*?\n}/);
assert.ok(impl, "retainedLineFraction not found in src/index.ts");
const retainedLineFraction = new Function(
  impl[0].replace(/: string/g, "").replace(/\): number \{/, ") {") +
    "; return retainedLineFraction;",
)();

const doc = Array.from(
  { length: 80 },
  (_, i) => `measured baseline fact ${i}: p50=${i}ms`,
).join("\n");

test("append retains all lines", () => {
  assert.equal(retainedLineFraction(doc, doc + "\nnew tail"), 1);
});

test("small in-place edit keeps most lines", () => {
  const lines = doc.split("\n");
  lines[5] = "corrected fact: p50=999ms";
  assert.ok(retainedLineFraction(doc, lines.join("\n")) >= 0.5);
});

test("generic-prose gutting scores near zero", () => {
  assert.ok(
    retainedLineFraction(doc, "generic Cloudflare advice, no measured data") <
      0.5,
  );
});

test("guard runs in executeTask before verification", () => {
  const gate = src.indexOf(
    "prev.length >= 800 && retainedLineFraction(prev, content) < 0.5",
  );
  assert.ok(gate > 0, "executeTask gutting guard missing");
  const verify = src.indexOf(
    "verifyArtifact(env, brain, task, path, content)",
    gate,
  );
  assert.ok(verify > gate, "gutting guard must precede verifyArtifact");
});

test("bootstrap scaffold skips existing files", () => {
  const add = src.indexOf("bootstrap: add");
  const skip = src.lastIndexOf("if (exists.ok) continue", add);
  assert.ok(add > 0 && skip > 0 && skip < add,
    "bootstrapRepo must skip files that already exist");
});
