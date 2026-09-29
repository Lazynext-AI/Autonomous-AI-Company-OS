// DDG Lite parser regression — the zero-cred search fallback. parseDdgLite is
// lifted verbatim out of src/websearch.ts (same pattern as focus-budget.test)
// so the test exercises the shipped expression, not a copy. The fixtures mirror
// lite.duckduckgo.com's actual markup: href carries the target URL-encoded in
// `uddg=`, the title sits in the anchor text, and the snippet is the NEXT
// <td class='result-snippet'> in document order.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/websearch.ts"),
  "utf8",
);

const body = src.match(/function parseDdgLite\(html: string, n: number\)[^]*?\n\}/);
assert.ok(body, "parseDdgLite not found in src/websearch.ts");
// unescHtml is shared by all parsers — lift it first so lifted code resolves.
const unescSrc = src.match(/function unescHtml\(s: string\)[^]*?\n\}/);
assert.ok(unescSrc, "unescHtml not found in src/websearch.ts");
// Strip the TS annotations so the lifted source is plain JS.
const fnSrc = body[0]
  .replace("html: string, n: number", "html, n")
  .replace(/: \{ title: string; url: string; snippet: string \}\[\]/, "");
const parseDdgLite = new Function(
  `${unescSrc[0].replace("(s: string)", "(s)").replace(": string {", " {")} ${fnSrc}; return parseDdgLite;`,
)();

const PAGE = `
<table>
  <tr><td>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fworkers&amp;rut=abc123" class='result-link'>Example &amp; Workers</a>
  </td></tr>
  <tr><td class='result-snippet'>
    Build <b>serverless</b> apps at the edge &mdash; no origin needed.
  </td></tr>
  <tr><td>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftwo.dev%2Fdocs%3Fa%3D1%26b%3D2&amp;rut=def456" class='result-link'>Two Docs</a>
  </td></tr>
  <tr><td class='result-snippet'>
    Second result snippet.
  </td></tr>
</table>`;

test("parses result-link anchors into title/url/snippet triples", () => {
  const hits = parseDdgLite(PAGE, 10);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, "https://example.com/workers");
  assert.equal(hits[0].title, "Example & Workers");
  assert.match(hits[0].snippet, /serverless apps/);
  assert.equal(hits[1].url, "https://two.dev/docs?a=1&b=2");
  assert.equal(hits[1].snippet, "Second result snippet.");
});

test("honors the result cap", () => {
  assert.equal(parseDdgLite(PAGE, 1).length, 1);
});

test("returns [] on a results-free page", () => {
  assert.deepEqual(parseDdgLite("<html><body>no results</body></html>", 10), []);
});

test("strips tags and entities from titles", () => {
  const page = `<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.io&amp;rut=r" class='result-link'><b>Bold</b> &lt;title&gt;</a><td class='result-snippet'>s</td>`;
  const [h] = parseDdgLite(page, 5);
  assert.equal(h.title, "Bold <title>");
});
