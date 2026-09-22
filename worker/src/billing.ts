// Dodo Payments billing — checkout sessions + webhook handler.
// Merchant-of-record: Dodo handles tax/compliance; we just create
// a checkout link and update the plan on payment success.
// Host: test.dodopayments.com (test mode) or live.dodopayments.com.
import { Env, json } from "./gateway";

const DODO_API = "https://test.dodopayments.com"; // swap to live.dodopayments.com for live mode

// Standard Webhooks (Svix) verification for Dodo. The whsec_ secret is
// base64; the signed payload is `${webhook-id}.${webhook-timestamp}.${body}`.
async function verifyDodo(
  secret: string, id: string, ts: string, body: string, sigHeader: string,
): Promise<boolean> {
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
  } catch {
    keyBytes = new TextEncoder().encode(rawSecret);
  }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`),
  );
  const bytes = new Uint8Array(mac);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const expected = btoa(bin);
  // Header holds space-separated "v1,<sig>" entries; accept any match.
  return sigHeader.split(" ").some((s) => {
    const [v, sig] = s.split(",");
    return v === "v1" && sig === expected;
  });
}

async function dodoFetch(env: Env, path: string, body: unknown): Promise<Response> {
  const key = env.DODO_API_KEY;
  if (!key) return json({ error: "DODO_API_KEY not configured" }, 503);
  return fetch(`${DODO_API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

// POST /api/v1/billing/checkout — create a Dodo checkout for a plan.
// Admin-token protected (the dashboard proxies with the internal token).
export async function handleBilling(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  // Public webhook — Dodo calls this on payment events. Signature uses
  // Standard Webhooks: sign `${id}.${timestamp}.${body}` with the whsec_ secret.
  if (req.method === "POST" && path === "/api/v1/billing/webhook") {
    const raw = await req.text();
    const secret = env.DODO_WEBHOOK_SECRET;
    if (secret) {
      const id = req.headers.get("webhook-id") ?? "";
      const ts = req.headers.get("webhook-timestamp") ?? "";
      const sigHeader = req.headers.get("webhook-signature") ?? "";
      const ok = await verifyDodo(secret, id, ts, raw, sigHeader);
      if (!ok) return json({ error: "bad signature" }, 401);
    }
    const evt = JSON.parse(raw) as {
      type?: string;
      data?: { metadata?: { plan?: string }; status?: string };
    };
    const plan = evt.data?.metadata?.plan;
    const type = evt.type ?? "";
    // Activate on payment/subscription success; downgrade to Founder on
    // cancellation/failure so the plan always reflects real billing state.
    const activate = type === "payment.succeeded" || type === "subscription.active" || type === "subscription.renewed";
    const downgrade = type === "subscription.cancelled" || type === "subscription.expired" || type === "subscription.on_hold" || type === "payment.failed";
    if (plan && (activate || downgrade)) {
      const name = activate ? plan : "Founder";
      await env.EPHEMERAL.put("plan", JSON.stringify({ name }));
      await env.DB.prepare(
        "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('billing.events', ?, datetime('now'))",
      ).bind(JSON.stringify({ type, plan: name, from: plan })).run();
    }
    return json({ ok: true });
  }

  // Checkout — internal token only (dashboard calls this server-side).
  if (req.method === "POST" && path === "/api/v1/billing/checkout") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { product_id?: string; plan?: string };
    if (!b.product_id) return json({ error: "product_id required" }, 400);
    const r = await dodoFetch(env, "/checkouts", {
      product_cart: [{ product_id: b.product_id, quantity: 1 }],
      return_url: "https://dashboard.lazynext.com/billing?success=1",
      metadata: { plan: b.plan ?? "" },
    });
    const d = (await r.json()) as { checkout_url?: string; session_id?: string };
    if (!r.ok) return json({ error: "checkout failed", detail: d }, 502);
    return json({ checkout_url: d.checkout_url, session_id: d.session_id });
  }

  // Current plan — public read for the dashboard.
  if (req.method === "GET" && path === "/api/v1/billing/plan") {
    const plan = await env.EPHEMERAL.get("plan");
    return json({ plan: plan ? JSON.parse(plan) : { name: "Founder" } });
  }

  return json({ error: "not found" }, 404);
}
