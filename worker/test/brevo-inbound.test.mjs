// Brevo inbound-parse → tickets regressions. The decision logic is what keeps
// the ack loop bounded: a subject carrying [#id] threads onto that ticket and
// earns NO ack, so a reply-to-ack can never spawn an ack-of-ack. Auto-generated
// mail is skipped before it can open tickets. Functions are lifted out of
// src/services.ts and transpiled, so the test cannot drift from the impl.
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

const lift = (name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}`));
  assert.ok(m, `${name} not found in src/services.ts`);
  return m[0];
};
// parseInboundItem references the InboundParsed type — strip the annotation.
const js = ts.transpileModule(
  lift("parseInboundItem").replace(/^export /, "")
    + "\n" + lift("classifyInbound").replace(/^export /, ""),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText.replace(/: InboundParsed/g, "");
const { parseInboundItem, classifyInbound } = new Function(`${js}; return { parseInboundItem, classifyInbound };`)();

const item = (over = {}) => ({
  MessageId: "<abc@brevo>",
  From: { Address: "User@Example.com", Name: "User" },
  Subject: "Login is broken",
  ExtractedMarkdownMessage: "the button 404s",
  SpamScore: 0,
  ...over,
});

test("new mail classifies as a fresh ticket at normal priority", () => {
  const p = parseInboundItem(item());
  assert.equal(p.from, "user@example.com");
  assert.equal(p.subject, "Login is broken");
  assert.equal(p.body, "the button 404s");
  assert.deepEqual(classifyInbound(p), { action: "ticket", priority: "normal" });
});

test("subject carrying [#id] threads — never a new ticket, never an ack", () => {
  const p = parseInboundItem(item({ Subject: "Re: Login is broken [#42]" }));
  assert.equal(p.ticketRef, 42);
  assert.equal(classifyInbound(p).action, "thread");
});

test("auto-submitted / mailer-daemon mail is skipped before ticketing", () => {
  const daemon = parseInboundItem(item({ From: { Address: "mailer-daemon@x.com" } }));
  assert.equal(classifyInbound(daemon).action, "skip");
  const auto = parseInboundItem(item({ Headers: { "Auto-Submitted": "auto-replied" } }));
  assert.equal(classifyInbound(auto).action, "skip");
  const legit = parseInboundItem(item({ Headers: { "Auto-Submitted": "no" } }));
  assert.equal(classifyInbound(legit).action, "ticket");
});

test("high spam score still tickets but at low priority", () => {
  const p = parseInboundItem(item({ SpamScore: 6.5 }));
  assert.deepEqual(classifyInbound(p), { action: "ticket", priority: "low" });
});

test("html-only body falls back to stripped markup; no sender skips", () => {
  const p = parseInboundItem(item({ ExtractedMarkdownMessage: "", RawHtmlBody: "<p>hi <b>there</b></p>" }));
  assert.equal(p.body, "hi there");
  assert.equal(classifyInbound(parseInboundItem(item({ From: {} }))).action, "skip");
});
