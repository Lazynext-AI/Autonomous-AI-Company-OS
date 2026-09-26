// Billing reconcile license-exemption regression. reconcileBilling downgrades
// every license:<email> not backed by a live Dodo subscription — correct for
// churned customers, but operator-issued licenses (the lazynext.com dogfood
// monitor canary) must survive or the daily rescan silently pauses. The
// shipped function is lifted out of src/billing.ts and transpiled with
// node_modules/typescript, so the test cannot drift from the implementation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/billing.ts"),
  "utf8",
);

const impl = src.match(/export async function reconcileBilling[\s\S]*?\n}/);
assert.ok(impl, "reconcileBilling not found in src/billing.ts");
const js = ts.transpileModule(impl[0].replace(/^export /, ""), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const makeReconcile = (deps) =>
  new Function(
    "dodoFetch",
    "loadSubs",
    "saveSubs",
    "listAll",
    `${js}; return reconcileBilling;`,
  )(deps.dodoFetch, deps.loadSubs, deps.saveSubs, deps.listAll);

const fakeKv = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  };
};

// listAll(KVNamespace, prefix) resolves to KV-list-shaped {name} entries.
const depsFor = (kv, subs = {}) => ({
  dodoFetch: async () => ({ ok: true, json: async () => ({ items: [] }) }),
  loadSubs: async () => ({ ...subs }),
  saveSubs: async () => "Founder",
  listAll: async (_ns, prefix) =>
    [...kv.map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
});

test("churned pro license downgrades to free and clears trial", async () => {
  const kv = fakeKv({ "license:gone@x.com": "pro", "trial:gone@x.com": "1" });
  const env = { EPHEMERAL: kv, DODO_API_KEY: "k" };
  const r = await makeReconcile(depsFor(kv))(env);
  assert.equal(await kv.get("license:gone@x.com"), "free");
  assert.equal(await kv.get("trial:gone@x.com"), null);
  assert.ok(r.repaired.some((s) => s.includes("downgraded")));
});

test("license_keep marker exempts an operator-issued license", async () => {
  const kv = fakeKv({
    "license:ops@lazynext.com": "pro",
    "license_keep:ops@lazynext.com": "dogfood",
  });
  const env = { EPHEMERAL: kv, DODO_API_KEY: "k" };
  const r = await makeReconcile(depsFor(kv))(env);
  assert.equal(await kv.get("license:ops@lazynext.com"), "pro");
  assert.ok(!r.repaired.some((s) => s.includes("downgraded")));
});

test("active Dodo sub still stamps its owner's license", async () => {
  const kv = fakeKv({});
  const env = { EPHEMERAL: kv, DODO_API_KEY: "k" };
  const deps = depsFor(kv);
  deps.dodoFetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        {
          subscription_id: "sub_1",
          customer: { email: "Buyer@X.com" },
          metadata: { plan: "pro" },
        },
      ],
    }),
  });
  const r = await makeReconcile(deps)(env);
  assert.equal(await kv.get("license:buyer@x.com"), "pro");
  assert.equal(r.active, 1);
  assert.ok(r.repaired.includes("license buyer@x.com"));
});
