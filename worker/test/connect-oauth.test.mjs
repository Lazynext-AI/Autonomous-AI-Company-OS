// OAuth connect layer regression guard. Asserts the shipped wiring in
// src/connect_oauth.ts + index.ts: every OAuth-capable connector registered,
// state is one-time-use and TTL'd, callback writes the flat conn:{id} cred the
// adapters expect plus conn:{id}:oauth for the refresh sweep, and the cron
// actually runs the sweep.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const oauth = readFileSync(join(dir, "../src/connect_oauth.ts"), "utf8");
const index = readFileSync(join(dir, "../src/index.ts"), "utf8");
const svc = readFileSync(join(dir, "../src/services.ts"), "utf8");
const py = readFileSync(join(dir, "../../core/tools/connectors.py"), "utf8");

test("oauth registry covers every OAuth-capable connector", () => {
  for (const id of ["x", "linkedin", "facebook", "instagram", "threads",
                    "meta", "whatsapp", "pinterest", "youtube", "gmb", "tiktok"]) {
    const re = new RegExp(`^  ${id}: \\{`, "m");
    assert.ok(re.test(oauth), `provider '${id}' missing from OAUTH_CONNECTORS`);
  }
});

test("state tokens are one-time-use with a 10-minute TTL", () => {
  assert.match(oauth, /oauth:state:\$\{state\}/);
  assert.match(oauth, /expirationTtl:\s*600/);
  assert.match(oauth, /EPHEMERAL\.delete\(`oauth:state:/);
});

test("callback writes conn:{id} + conn:{id}:oauth and redirects to settings", () => {
  assert.match(oauth, /EPHEMERAL\.put\(`conn:\$\{id\}`, cred\.cred\)/);
  assert.match(oauth, /EPHEMERAL\.put\(`conn:\$\{id\}:oauth`/);
  assert.match(oauth, /dashboard\.lazynext\.com\/settings\?connected=/);
});

test("start requires admin — API_TOKEN or admin-scoped lzk only", () => {
  assert.match(oauth, /startAuthed/);
  assert.match(oauth, /Bearer \$\{env\.API_TOKEN\}/);        // internal token path
  assert.match(oauth, /isAdminLzk/);                        // lzk admin-scope check
  assert.doesNotMatch(oauth, /authedHeader\s*&&\s*!/);      // no bare-header bypass
  assert.match(index, /path\.startsWith\("\/api\/v1\/connect\/"\)/);
  assert.match(index, /handleConnect\(req, env, path, url\)/);
});

test("cron runs the token-refresh sweep", () => {
  assert.match(index, /refreshConnectorTokens\(env\)/);
  assert.match(oauth, /export async function refreshConnectorTokens/);
  assert.match(oauth, /fb_exchange_token/);
  assert.match(oauth, /refresh_token/);
});

test("CONNECTOR_IDS gains the new channels (44 total)", () => {
  const m = svc.match(/const CONNECTOR_IDS = \[([\s\S]*?)\];/);
  assert.ok(m, "CONNECTOR_IDS not found");
  const ids = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  for (const id of ["youtube", "tiktok", "gmb", "lemmy", "listmonk", "snapchat", "nostr"])
    assert.ok(ids.includes(id), `missing connector id '${id}'`);
  assert.equal(ids.length, 44, `expected 44 connectors, got ${ids.length}`);
});

test("worker + python dispatch stay in sync for new connectors", () => {
  for (const id of ["youtube", "tiktok", "gmb", "lemmy", "listmonk", "snapchat", "nostr"]) {
    assert.match(svc, new RegExp(`case "${id}"`), `services.ts missing case '${id}'`);
    assert.match(py, new RegExp(`"${id}": _${id}`), `connectors.py missing _${id}`);
  }
});

test("linkedin adapter accepts full urn suffixes (colons intact)", () => {
  const m = svc.match(/case "linkedin": \{([\s\S]*?)case "/);
  assert.ok(m, "linkedin case not found");
  assert.match(m[1], /indexOf\(":"|startsWith\("urn:"\)/);
  const pm = py.match(/async def _linkedin[\s\S]*?return await _post/);
  assert.ok(pm && pm[0].includes('startswith("urn:")'), "python linkedin must accept full urns");
});
