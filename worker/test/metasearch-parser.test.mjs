// Bing/Brave parser regression — the zero-cred metasearch cascade. Functions
// are lifted verbatim out of src/websearch.ts (same pattern as
// ddg-parser.test.mjs) so the test exercises the shipped expressions, not
// copies. Fixtures mirror the engines' real markup: Bing wraps results in
// <li class="b_algo"> with ck/a redirect hrefs (real URL base64url'd in
// u=a1…), Brave serves <div class="snippet svelte-…"> cards whose svelte-*
// suffixes rotate between deploys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/websearch.ts"),
  "utf8",
);

function lift(name) {
  const m = src.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(m, `${name} not found in src/websearch.ts`);
  return m[0]
    .replace(/\(html: string, n: number\)/, "(html, n)")
    .replace(/\(href: string\)/, "(href)")
    .replace(/\(s: string\)/, "(s)")
    .replace(/: \{ title: string; url: string; snippet: string \}\[\]/g, "")
    .replace(/: string \{/g, " {");
}
const UNESC = lift("unescHtml"); // shared helper all parsers resolve
const decodeBingUrl = new Function(`${lift("decodeBingUrl")}; return decodeBingUrl;`)();
const parseBing = new Function(
  `${UNESC} ${lift("decodeBingUrl")} ${lift("parseBing")}; return parseBing;`,
)();
const parseBrave = new Function(`${UNESC} ${lift("parseBrave")}; return parseBrave;`)();

// aHR0cHM6Ly9leGFtcGxlLmNvbQ9jb20 = base64url("https://example.com")
const BING_PAGE = `<html><body><ol id="b_results">
<li class="b_algo" data-id iid=SERP.1><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ">Example Site</a></h2><p>Example snippet &amp; text</p></li>
<li class="b_algo" data-id iid=SERP.2><h2><a href="https://direct.example.org/page">Direct Link</a></h2><p>Direct snippet</p></li>
<li class="b_ad"><h2><a href="https://bing.com/aclick?ad=1">Sponsored</a></h2></li>
</ol></body></html>`;

const BRAVE_PAGE = `<html><body><main>
<div class="snippet svelte-aaa111" data-pos="0" data-type="web"><div class="result-body svelte-bbb222"><div class="result-wrapper"><div class="result-content"><a href="https://brave.example.com/post" target="_self" class="svelte-ccc333 l1"><div class="site-name-wrapper"><span>brave.example.com</span></div><div class="title search-snippet-title line-clamp-1 svelte-ccc333">Brave Title &amp; Co</div></a></div><div class="content desktop-default-regular t-primary line-clamp-dynamic svelte-ddd444">A description with <b>markup</b> inside.</div></div></div></div>
<div class="snippet svelte-eee555" data-pos="1" data-type="web"><div class="result-content"><a href="https://second.example.net/"><div class="title search-snippet-title svelte-x">Second</div></a></div></div>
</main></body></html>`;

test("decodeBingUrl unwraps ck/a u=a1… redirects", () => {
  assert.equal(
    decodeBingUrl("https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ"),
    "https://example.com",
  );
  assert.equal(decodeBingUrl("https://direct.example.org/page"), "https://direct.example.org/page");
});

test("parseBing extracts title/url/snippet and skips ad blocks", () => {
  const out = parseBing(BING_PAGE, 8);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, "https://example.com");
  assert.equal(out[0].title, "Example Site");
  assert.equal(out[0].snippet, "Example snippet & text");
  assert.equal(out[1].url, "https://direct.example.org/page");
});

test("parseBing returns [] on captcha/no-result pages", () => {
  assert.deepEqual(parseBing("<html><body>captcha</body></html>", 8), []);
});

test("parseBrave extracts direct urls with title + description", () => {
  const out = parseBrave(BRAVE_PAGE, 8);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, "https://brave.example.com/post");
  assert.equal(out[0].title, "Brave Title & Co");
  assert.equal(out[0].snippet, "A description with markup inside.");
  assert.equal(out[1].url, "https://second.example.net/");
});

test("parseBrave tolerates rotating svelte suffixes", () => {
  const rotated = BRAVE_PAGE.replaceAll("svelte-aaa111", "svelte-zzz999")
    .replaceAll("svelte-ccc333", "svelte-yyy888");
  const out = parseBrave(rotated, 8);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, "https://brave.example.com/post");
});
