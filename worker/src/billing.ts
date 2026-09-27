// Dodo Payments billing — checkout sessions + webhook handler.
// Merchant-of-record: Dodo handles tax/compliance; we just create
// a checkout link and update the plan on payment success.
// Host: test.dodopayments.com (test mode) or live.dodopayments.com.
import { Env, json, listAll } from "./gateway";
import { signwellSendFromTemplate } from "./services";

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
    ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}

// POST /api/v1/billing/checkout — create a Dodo checkout for a plan.
// Admin-token protected (the dashboard proxies with the internal token).
// `subs:active` maps subscription_id → {p: plan, e: email}. The owner email
// rides along so license:<email> can reflect "still owns an active sub", not
// "the last event seen" — a customer cancelling one of two subs keeps access.
type SubEntry = { p: string; e?: string };
async function loadSubs(env: Env): Promise<Record<string, SubEntry>> {
  const raw = await env.EPHEMERAL.get("subs:active");
  const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, SubEntry | string>;
  const subs: Record<string, SubEntry> = {};
  // Legacy values were bare plan strings — upgrade on read.
  for (const [k, v] of Object.entries(parsed)) subs[k] = typeof v === "string" ? { p: v } : v;
  return subs;
}
async function saveSubs(env: Env, subs: Record<string, SubEntry>): Promise<string> {
  await env.EPHEMERAL.put("subs:active", JSON.stringify(subs));
  const actives = Object.values(subs).map((s) => s.p);
  const name = actives.includes("pro") ? "pro" : (actives[0] ?? "Founder");
  await env.EPHEMERAL.put("plan", JSON.stringify({ name }));
  return name;
}
function ownedPlans(subs: Record<string, SubEntry>, email: string): string[] {
  return Object.values(subs).filter((s) => s.e === email).map((s) => s.p);
}

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

  const subs = await loadSubs(env);
  for (const key of Object.keys(subs)) {
    if (!live.has(key)) { delete subs[key]; repaired.push(`removed stale ${key}`); }
  }
  const liveEmails = new Set<string>();
  for (const [id, s] of live) {
    if (subs[id]?.p !== s.plan || subs[id]?.e !== s.email) {
      subs[id] = { p: s.plan, e: s.email };
      repaired.push(`upserted ${id}`);
    }
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
  await saveSubs(env, subs);

  // Downgrade pro licenses whose subscription is no longer active.
  const licKeys = await listAll(env.EPHEMERAL, "license:");
  for (const k of licKeys) {
    const email = k.name.slice(8);
    const v = await env.EPHEMERAL.get(k.name);
    if (v && v !== "free" && !liveEmails.has(email)) {
      // Operator-issued licenses (dogfooding, internal tooling) carry a
      // license_keep:<email> marker so reconcile can't demand a Dodo sub
      // that will never exist — without it the canary would be downgraded
      // at the next sweep and the monitor would silently pause.
      if (await env.EPHEMERAL.get(`license_keep:${email}`)) continue;
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
    // Accept either signing secret: the KV-stored one written by the
    // registration route (tracks the newest webhook — flips with live-mode
    // re-registration) or the deployed env secret (initial/manual setup).
    const secrets = [
      await env.EPHEMERAL.get("dodo:webhook_secret"),
      env.DODO_WEBHOOK_SECRET,
    ].filter((s): s is string => !!s);
    if (secrets.length) {
      const ts = req.headers.get("webhook-timestamp") ?? "";
      const sigHeader = req.headers.get("webhook-signature") ?? "";
      const results = await Promise.all(
        secrets.map((s) => verifyDodo(s, whId, ts, raw, sigHeader)),
      );
      if (!results.some(Boolean)) return json({ error: "bad signature" }, 401);
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
      const subs = await loadSubs(env);
      if (activate) subs[subKey] = { p: plan, e: email }; else delete subs[subKey];
      const name = await saveSubs(env, subs);
      // Product license: the buyer's email becomes their license key for the
      // product API (validated via license:<email> in KV). On downgrade the
      // license follows the email's remaining active subs — cancelling sub A
      // must not revoke access while the same email still pays for sub B.
      if (email) {
        const owned = ownedPlans(subs, email);
        const lic = activate ? plan : owned.includes("pro") ? "pro" : (owned[0] ?? "free");
        await env.EPHEMERAL.put(`license:${email}`, lic, { expirationTtl: 31_536_000 });
      }
      // Optional e-sign on activation — config:signwell_template names a
      // SignWell document template; when set, each new activation is emailed a
      // signature request. Renewals don't resend — signsent:<sub> dedups.
      if (email && activate && type !== "subscription.renewed") {
        const tpl = await env.EPHEMERAL.get("config:signwell_template");
        if (tpl && !(await env.EPHEMERAL.get(`signsent:${subKey}`))) {
          ctx.waitUntil((async () => {
            const r = await signwellSendFromTemplate(env, {
              template_id: tpl, signer_email: email,
              subject: "Lazynext service agreement",
            });
            if (r.ok) {
              await env.EPHEMERAL.put(`signsent:${subKey}`, "1", { expirationTtl: 31_536_000 });
            } else {
              await env.DB.prepare(
                "INSERT INTO bus_messages (channel, payload, created_at) VALUES ('signwell.errors', ?, datetime('now'))",
              ).bind(JSON.stringify({ email, tpl, status: r.status, connected: r.connected })).run();
            }
          })().catch(() => {}));
        }
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
    // Persist the new webhook's signing secret — Dodo rotates it per webhook,
    // so re-registering (e.g. the live-mode flip) would otherwise silently
    // break verification until DODO_WEBHOOK_SECRET was manually updated.
    const secret = d.secret ?? d.webhook_secret;
    if (typeof secret === "string" && secret) {
      await env.EPHEMERAL.put("dodo:webhook_secret", secret);
    }
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

  // Delete a registered Dodo webhook — internal token only. Needed at the
  // live-mode flip (the test-mode endpoint must not keep receiving events)
  // and for removing duplicate/stale registrations. The KV-stored signing
  // secret is left alone: verification also accepts DODO_WEBHOOK_SECRET, and
  // any surviving webhook keeps working against it.
  if (req.method === "DELETE" && path.startsWith("/api/v1/billing/webhooks/")) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const id = path.slice("/api/v1/billing/webhooks/".length);
    if (!id || id.includes("/")) return json({ error: "webhook id required" }, 400);
    const r = await dodoFetch(env, `/webhooks/${encodeURIComponent(id)}`, undefined, "DELETE");
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      return json({ error: "webhook delete failed", detail: body }, r.status === 404 ? 404 : 502);
    }
    return json({ ok: true, deleted: id });
  }

  // Create a Dodo discount code — internal token only. The 402 funnel
  // promises leads "we'll send you a discount"; this is what makes that
  // real (recreate in live mode at the flip).
  if (req.method === "POST" && path === "/api/v1/billing/discounts") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { code?: string; amount?: number; type?: string; name?: string; usage_limit?: number; expires_at?: string; restricted_to?: string[] };
    if (!b.code || !b.amount) return json({ error: "code and amount required" }, 400);
    const r = await dodoFetch(env, "/discounts", {
      code: b.code,
      type: b.type ?? "percentage",
      amount: b.amount,
      name: b.name ?? b.code,
      ...(b.usage_limit ? { usage_limit: b.usage_limit } : {}),
      ...(b.expires_at ? { expires_at: b.expires_at } : {}),
      ...(b.restricted_to ? { restricted_to: b.restricted_to } : {}),
    });
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok) return json({ error: "discount create failed", detail: d }, 502);
    return json({ ok: true, discount: d });
  }

  // Update a Dodo discount — internal token only. NOTE: Dodo's `amount` for
  // type=percentage is in BASIS POINTS (2000 = 20%), verified live.
  if (req.method === "PATCH" && path === "/api/v1/billing/discounts") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const b = (await req.json()) as { discount_id?: string; code?: string; amount?: number; name?: string; usage_limit?: number; expires_at?: string };
    if (!b.discount_id) return json({ error: "discount_id required" }, 400);
    const { discount_id, ...fields } = b;
    const r = await dodoFetch(env, `/discounts/${discount_id}`, fields, "PATCH");
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok) return json({ error: "discount update failed", detail: d }, 502);
    return json({ ok: true, discount: d });
  }

  // List Dodo discounts — internal token only (verify codes survived).
  if (req.method === "GET" && path === "/api/v1/billing/discounts") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const r = await dodoFetch(env, "/discounts", undefined, "GET");
    const d = (await r.json()) as Record<string, unknown>;
    if (!r.ok) return json({ error: "discount list failed", detail: d }, 502);
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
      return_url: "https://checker.lazynext.com/?upgraded=1",
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
    const subs = await loadSubs(env);
    delete subs[subId];
    const planName = await saveSubs(env, subs);
    if (subEmail) {
      // Same multi-sub rule as the webhook: only revoke when the email has
      // no remaining active subscription.
      const owned = ownedPlans(subs, subEmail);
      const lic = owned.includes("pro") ? "pro" : (owned[0] ?? "free");
      await env.EPHEMERAL.put(`license:${subEmail}`, lic, { expirationTtl: 31_536_000 });
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

  // Conversion funnel — internal token. Aggregates the product funnel for
  // the dashboard: scans → leads → trials → paying customers. Counts are
  // current-state views (KV records decay by TTL), not cumulative totals.
  if (req.method === "GET" && path === "/api/v1/billing/funnel") {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "unauthorized" }, 401);
    const [reports, leads, trials, licenses, mons] = await Promise.all([
      listAll(env.EPHEMERAL, "report:"),
      listAll(env.EPHEMERAL, "lead:"),
      listAll(env.EPHEMERAL, "trial:"),
      listAll(env.EPHEMERAL, "license:"),
      listAll(env.EPHEMERAL, "mon:"),
    ]);
    const leadCount = leads.filter(
      (k) => !k.name.endsWith(":stage") && !k.name.endsWith(":joined"),
    ).length;
    const trialCount = trials.filter((k) => !k.name.endsWith(":reminded")).length;
    const licVals = await Promise.all(licenses.map((k) => env.EPHEMERAL.get(k.name)));
    const proLicenses = licVals.filter((v) => v != null && v !== "free").length;
    const rawSubs = await env.EPHEMERAL.get("subs:active");
    const subsActive = rawSubs
      ? Object.keys(JSON.parse(rawSubs) as Record<string, string>).length
      : 0;
    const count = async (table: string) =>
      env.DB.prepare(`SELECT COUNT(*) c FROM ${table}`)
        .first<{ c: number }>()
        .then((r) => r?.c ?? 0)
        .catch(() => null);
    return json({
      scans_30d: reports.length,
      leads: leadCount,
      waitlist: await count("waitlist"),
      email_contacts: await count("email_contacts"),
      crm_leads: await count("crm_leads"),
      trials_active: trialCount,
      licenses_pro: proLicenses,
      licenses_free: licVals.length - proLicenses,
      subscriptions_active: subsActive,
      monitors: mons.filter((k) => k.name !== "mon:last_sweep").length,
    });
  }

  return json({ error: "not found" }, 404);
}
