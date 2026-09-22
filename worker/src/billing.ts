// Dodo Payments billing — checkout sessions + webhook handler.
// Merchant-of-record: Dodo handles tax/compliance; we just create
// a checkout link and update the plan on payment success.
import { Env, json } from "./gateway";

const DODO_API = "https://api.dodopayments.com";

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
  // Public webhook — Dodo calls this on payment events.
  if (req.method === "POST" && path === "/api/v1/billing/webhook") {
    const evt = (await req.json()) as {
      type?: string;
      data?: { metadata?: { plan?: string }; status?: string };
    };
    // Verify signature if Dodo webhook secret is set.
    const secret = env.DODO_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers.get("webhook-signature") ?? "";
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
      );
      const mac = await crypto.subtle.sign(
        "HMAC", key, enc.encode(await req.clone().text()),
      );
      const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (sig !== expected) return json({ error: "bad signature" }, 401);
    }
    const plan = evt.data?.metadata?.plan;
    const paid = evt.type === "payment.succeeded" || evt.type === "subscription.active";
    if (paid && plan) {
      await env.EPHEMERAL.put("plan", JSON.stringify({ name: plan }));
      await env.DB.prepare(
        "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('billing.events', ?, datetime('now'))",
      ).bind(JSON.stringify({ type: evt.type, plan })).run();
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
