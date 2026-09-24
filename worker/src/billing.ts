// Dodo Payments billing — checkout sessions + webhook handler.
// Merchant-of-record: Dodo handles tax/compliance; we just create
// a checkout link and update the plan on payment success.
// Host: test.dodopayments.com (test mode) or live.dodopayments.com.
import { Env, json } from "./gateway";

const DODO_API_DEFAULT = "https://test.dodopayments.com"; // set env.DODO_API_BASE to https://live.dodopayments.com when the account leaves test mode

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

async function dodoFetch(env: Env, path: string, body?: unknown, method = "POST"): Promise<Response> {
  const key = env.DODO_API_KEY;
  if (!key) return json({ error: "DODO_API_KEY not configured" }, 503);
  return fetch(`${env.DODO_API_BASE ?? DODO_API_DEFAULT}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}

// POST /api/v1/billing/checkout — create a Dodo checkout for a plan.
// Admin-token protected (the dashboard proxies with the internal token).
// Reconcile KV billing state against Dodo's live subscription list. Runs in
// the daily sweep and repairs drift from delayed or dropped webhooks in both
// directions: active subs get their license stamped, subs no longer active
// are removed from subs:active and their licenses downgraded. Idempotent —
// mirrors exactly what the webhook handler writes.
export async function reconcileBilling(env: Env): Promise<{ active: number; repaired: string[] }> {
  const r = await dodoFetch(env, "/subscriptions?status=active&limit=100", undefined, "GET");
  if (!r.ok) return { active: -1, repaired: ["subscription list failed"] };
  const d = (await r.json()) as {
    items?: { subscription_id?: string; customer?: { email?: string }; metadata?: { plan?: string; trial?: string } }[];
  };
  const live = new Map<string, { plan: string; email?: string; trial: boolean }>();
  for (const s of d.items ?? []) {
    const id = s.subscription_id;
    if (!id) continue;
    live.set(id, { plan: s.metadata?.plan ?? "pro", email: s.customer?.email?.toLowerCase(), trial: s.metadata?.trial === "1" });
  }
  const repaired: string[] = [];

  const rawSubs = await env.EPHEMERAL.get("subs:active");
  const subs: Record<string, string> = rawSubs ? JSON.parse(rawSubs) : {};
  for (const key of Object.keys(subs)) {
    if (!live.has(key)) { delete subs[key]; repaired.push(`removed stale ${key}`); }
  }
  const liveEmails = new Set<string>();
  for (const [id, s] of live) {
    if (subs[id] !== s.plan) { subs[id] = s.plan; repaired.push(`upserted ${id}`); }
    if (s.email) {
      liveEmails.add(s.email);
      const lic = await env.EPHEMERAL.get(`license:${s.email}`);
      if (lic !== s.plan) {
        await env.EPHEMERAL.put(`license:${s.email}`, s.plan, { expirationTtl: 31_536_000 });
        repaired.push(`license ${s.email}`);
      }
      if (s.trial && !(await env.EPHEMERAL.get(`trial:${s.email}`))) {
        await env.EPHEMERAL.put(`trial:${s.email}`, String(Date.now()), { expirationTtl: 31_536_000 });
        repaired.push(`trial ${s.email}`);
      }
      await env.EPHEMERAL.delete(`pastdue:${s.email}`);
    }
  }
  await env.EPHEMERAL.put("subs:active", JSON.stringify(subs));
  const actives = Object.values(subs);
  await env.EPHEMERAL.put("plan", JSON.stringify({ name: actives.includes("pro") ? "pro" : (actives[0] ?? "Founder") }));

  // Downgrade pro licenses whose subscription is no longer active.
  const licKeys = await env.EPHEMERAL.list({ prefix: "license:" });
  for (const k of licKeys.keys) {
    const email = k.name.slice(8);
    const v = await env.EPHEMERAL.get(k.name);
    if (v && v !== "free" && !liveEmails.has(email)) {
      await env.EPHEMERAL.put(k.name, "free", { expirationTtl: 31_536_000 });
      await env.EPHEMERAL.delete(`trial:${email}`);
      repaired.push(`downgraded ${email}`);
    }
  }
  return { active: live.size, repaired };
}

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
    const whId = req.headers.get("webhook-id") ?? "";
    const secret = env.DODO_WEBHOOK_SECRET;
    if (secret) {
      const ts = req.headers.get("webhook-timestamp") ?? "";
      const sigHeader = req.headers.get("webhook-signature") ?? "";
      const ok = await verifyDodo(secret, whId, ts, raw, sigHeader);
      if (!ok) return json({ error: "bad signature" }, 401);
    }
    // Replay/idempotency guard — Dodo retries deliver the same webhook-id;
    // process each id once so replays can't double-write events.
    const seenKey = `whseen:${whId}`;
    if (await env.EPHEMERAL.get(seenKey)) return json({ ok: true, deduped: true });
    await env.EPHEMERAL.put(seenKey, "1", { expirationTtl: 604_800 });

    const evt = JSON.parse(raw) as {
      type?: string;
      data?: { metadata?: { plan?: string; trial?: string }; status?: string; customer?: { email?: string } };
    };
    const plan = evt.data?.metadata?.plan;
    const email = evt.data?.customer?.email?.toLowerCase();
    const type = evt.type ?? "";
    // Activate on payment/subscription success; downgrade to Founder on
    // cancellation/failure so the plan always reflects real billing state.
    const activate = type === "payment.succeeded" || type === "subscription.active" || type === "subscription.renewed";
    const downgrade = type === "subscription.cancelled" || type === "subscription.expired" || type === "subscription.on_hold" || type === "payment.failed";
    // Dunning: a renewal payment failed but Dodo is still retrying. Flag the
    // account without revoking access — on_hold/expired do the real downgrade.
    if (type === "subscription.past_due" && email) {
      await env.EPHEMERAL.put(`pastdue:${email}`, "1", { expirationTtl: 604_800 });
      await env.DB.prepare(
        "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('billing.events', ?, datetime('now'))",
      ).bind(JSON.stringify({ type, plan, email })).run();
    }
    // Free-trial lifecycle: checkout sets metadata.trial='1'; on activation we
    // stamp trial:<email> so the daily sweep can email a 3-day warning. Any
    // later terminal event (renewal payment, cancel, expiry, failure) clears
    // it so converted/expired trials are never reminded.
    if (email) {
      if (type === "subscription.active" && evt.data?.metadata?.trial === "1") {
        await env.EPHEMERAL.put(`trial:${email}`, String(Date.now()), { expirationTtl: 31_536_000 });
      } else if (type !== "subscription.active") {
        await env.EPHEMERAL.delete(`trial:${email}`);
      }
    }
    if (plan && (activate || downgrade)) {
      // `plan` must reflect "any active subscription", not "the last event
      // seen" — cancelling one sub must not downgrade the global plan while
      // another stays active. Track active subs by subscription_id (email
      // fallback for payloads that lack it) and derive the plan from the set.
      const subKey = (evt.data as { subscription_id?: string })?.subscription_id ?? email ?? "unknown";
      const rawSubs = await env.EPHEMERAL.get("subs:active");
      const subs: Record<string, string> = rawSubs ? JSON.parse(rawSubs) : {};
      if (activate) subs[subKey] = plan; else delete subs[subKey];
      await env.EPHEMERAL.put("subs:active", JSON.stringify(subs));
      const actives = Object.values(subs);
      const name = actives.includes("pro") ? "pro" : (actives[0] ?? "Founder");
      await env.EPHEMERAL.put("plan", JSON.stringify({ name }));
      // Product license: the buyer's email becomes their license key for the
      // product API (validated via license:<email> in KV).
      if (email) {
        await env.EPHEMERAL.put(`license:${email}`, activate ? plan : "free", { expirationTtl: 31_536_000 });
      }
      await env.DB.prepare(
        "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('billing.events', ?, datetime('now'))",
      ).bind(JSON.stringify({ type, plan: name, from: plan, licensed: !!email })).run();
    }
    return json({ ok: true });
  }

  // Register this worker's webhook URL with Dodo — internal token only.
  // Without this, real payment events never reach /api/v1/billing/webhook.
  if (req.method === "POST" && path === "/api/v1/billing/webhooks") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const r = await dodoFetch(env, "/webhooks", {
      url: "https://ai-company-os.dry-hall-6a50.workers.dev/api/v1/billing/webhook",
      description: "Lazynext platform billing",
      events: [
        "payment.succeeded", "payment.failed",
        "subscription.active", "subscription.renewed", "subscription.past_due",
        "subscription.cancelled", "subscription.expired", "subscription.on_hold",
      ],
      metadata: {},
    });
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok) return json({ error: "webhook register failed", detail: d }, r.status === 404 ? 501 : 502);
    return json({ ok: true, webhook: d });
  }

  // List registered Dodo webhooks — internal token only. Verifies the live
  // registration still points at this worker (silent drops = dead billing).
  if (req.method === "GET" && path === "/api/v1/billing/webhooks") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const r = await dodoFetch(env, "/webhooks", undefined, "GET");
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok) return json({ error: "webhook list failed", detail: d }, 502);
    return json({ ok: true, ...d });
  }

  // Create a Dodo product — internal token only. Returns the product_id used
  // by /api/v1/billing/checkout and product workers' /checkout redirects.
  if (req.method === "POST" && path === "/api/v1/billing/products") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { name?: string; description?: string; price_cents?: number; currency?: string; recurring?: boolean; trial_days?: number };
    if (!b.name || !b.price_cents) return json({ error: "name and price_cents required" }, 400);
    const r = await dodoFetch(env, "/products", {
      name: b.name,
      description: b.description ?? "",
      tax_category: "saas",
      price: {
        type: b.recurring === false ? "one_time_price" : "recurring_price",
        price: b.price_cents,
        currency: b.currency ?? "USD",
        discount: 0,
        purchasing_power_parity: false,
        tax_inclusive: false,
        ...(b.recurring === false ? {} : {
          payment_frequency_count: 1, payment_frequency_interval: "Month",
          subscription_period_count: 1, subscription_period_interval: "Month",
          ...(b.trial_days ? { trial_period_days: b.trial_days } : {}),
        }),
      },
    });
    const d = (await r.json()) as { product_id?: string; id?: string };
    if (!r.ok) return json({ error: "product create failed", detail: d }, 502);
    return json({ product_id: d.product_id ?? d.id });
  }

  // Checkout — internal token only (dashboard calls this server-side).
  if (req.method === "POST" && path === "/api/v1/billing/checkout") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { product_id?: string; plan?: string; trial_days?: number };
    if (!b.product_id) return json({ error: "product_id required" }, 400);
    const trial = (b.trial_days ?? 0) > 0;
    const r = await dodoFetch(env, "/checkouts", {
      product_cart: [{ product_id: b.product_id, quantity: 1 }],
      return_url: "https://lazynext-platform.github.io/accessibility-checker/?upgraded=1",
      metadata: { plan: b.plan ?? "", ...(trial ? { trial: "1" } : {}) },
      // Card-upfront free trial: Dodo collects the payment method now and
      // auto-converts to the recurring price when trial_period_days elapse.
      ...(trial ? { subscription_data: { trial_period_days: b.trial_days } } : {}),
    });
    const d = (await r.json()) as { checkout_url?: string; session_id?: string };
    if (!r.ok) return json({ error: "checkout failed", detail: d }, 502);
    return json({ checkout_url: d.checkout_url, session_id: d.session_id });
  }

  // Cancel a subscription — internal token. Immediate cancellation only:
  // the webhook downgrades the license on subscription.cancelled, so access
  // ends when Dodo says it ends. Pass subscription_id, or email to resolve
  // the customer's first active subscription via the Dodo API.
  if (req.method === "POST" && path === "/api/v1/billing/cancel") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { subscription_id?: string; email?: string };
    let subId = b.subscription_id;
    if (!subId && b.email) {
      const cr = await dodoFetch(env, `/customers?email=${encodeURIComponent(b.email)}`, undefined, "GET");
      const cd = (await cr.json()) as { items?: { customer_id?: string }[] };
      const custId = cd.items?.[0]?.customer_id;
      if (!custId) return json({ error: "customer not found" }, 404);
      const sr = await dodoFetch(env, `/subscriptions?customer_id=${custId}&status=active`, undefined, "GET");
      const sd = (await sr.json()) as { items?: { subscription_id?: string }[] };
      subId = sd.items?.[0]?.subscription_id;
      if (!subId) return json({ error: "no active subscription" }, 404);
    }
    if (!subId) return json({ error: "subscription_id or email required" }, 400);
    const r = await dodoFetch(env, `/subscriptions/${subId}`, { status: "cancelled" }, "PATCH");
    const d = (await r.json()) as { status?: string; customer?: { email?: string }; metadata?: { plan?: string } };
    if (!r.ok) return json({ error: "cancel failed", detail: d }, 502);

    // Apply the downgrade synchronously — webhooks can lag or drop in test
    // mode, and a cancelled sub must not leave license:<email> = 'pro' while
    // we wait. When subscription.cancelled does arrive it repeats the same
    // writes (idempotent), so this is safe to do in both places.
    const subEmail = d.customer?.email?.toLowerCase() ?? b.email?.toLowerCase();
    const rawSubs = await env.EPHEMERAL.get("subs:active");
    const subs: Record<string, string> = rawSubs ? JSON.parse(rawSubs) : {};
    delete subs[subId];
    await env.EPHEMERAL.put("subs:active", JSON.stringify(subs));
    const actives = Object.values(subs);
    const planName = actives.includes("pro") ? "pro" : (actives[0] ?? "Founder");
    await env.EPHEMERAL.put("plan", JSON.stringify({ name: planName }));
    if (subEmail) {
      await env.EPHEMERAL.put(`license:${subEmail}`, "free", { expirationTtl: 31_536_000 });
      await env.EPHEMERAL.delete(`trial:${subEmail}`);
    }
    await env.DB.prepare(
      "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('billing.events', ?, datetime('now'))",
    ).bind(JSON.stringify({ type: "subscription.cancelled", plan: planName, from: "api", licensed: !!subEmail })).run();
    return json({ ok: true, subscription_id: subId, status: d.status });
  }

  // List active subscriptions — internal token. Billing visibility for the
  // dashboard/ops and the source of truth for reconciling `subs:active`.
  if (req.method === "GET" && path === "/api/v1/billing/subscriptions") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const r = await dodoFetch(env, "/subscriptions?status=active", undefined, "GET");
    const d = (await r.json()) as { items?: unknown[] };
    if (!r.ok) return json({ error: "list failed", detail: d }, 502);
    return json({ ok: true, subscriptions: d.items ?? [] });
  }

  // Current plan — public read for the dashboard.
  if (req.method === "GET" && path === "/api/v1/billing/plan") {
    const plan = await env.EPHEMERAL.get("plan");
    return json({ plan: plan ? JSON.parse(plan) : { name: "Founder" } });
  }

  return json({ error: "not found" }, 404);
}
