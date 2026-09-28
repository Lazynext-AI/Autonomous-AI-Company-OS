/**
 * Self-hosted OAuth connect layer — replaces hosted social aggregators.
 *
 *   GET /api/v1/connect/{id}/start     → 302 to the provider authorize URL
 *   GET /api/v1/connect/{id}/callback  → code exchange → conn:{id} cred write
 *
 * Per-platform app credentials live in KV as conn:{id}:app = "client_id[:secret]"
 * (Meta-family connectors fall back to shared conn:meta_app, Google-family to
 * conn:google_app — one app covers each vendor's product set). Raw OAuth
 * material (refresh token, expiry, resolved suffix) lives in conn:{id}:oauth so
 * the cron refresh sweep can renew tokens and rewrite conn:{id} in the flat
 * format callConnector already expects.
 */

import { json, sha256, type Env } from "./gateway";

interface Provider {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  pkce?: boolean;                    // PKCE S256 (X requires it)
  basic?: boolean;                   // token request auths via Basic(client:secret)
  extraAuth?: Record<string, string>;
  refreshGrant?: "refresh_token" | "fb_exchange_token" | "refresh_access_token";
  appFallback?: string;              // shared app-cred key (meta_app / google_app)
}

export const OAUTH_CONNECTORS: Record<string, Provider> = {
  x: {
    authUrl: "https://x.com/i/oauth2/authorize", tokenUrl: "https://api.x.com/2/oauth2/token",
    scope: "tweet.read tweet.write users.read offline.access", pkce: true,
    refreshGrant: "refresh_token",
  },
  linkedin: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scope: "openid profile email w_member_social w_organization_social rw_organization_admin",
    refreshGrant: "refresh_token",
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "pages_manage_posts pages_show_list pages_read_engagement business_management",
    refreshGrant: "fb_exchange_token", appFallback: "meta_app",
  },
  instagram: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "instagram_content_publish pages_show_list business_management",
    refreshGrant: "fb_exchange_token", appFallback: "meta_app",
  },
  threads: {
    authUrl: "https://www.threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    scope: "threads_basic threads_content_publish",
    refreshGrant: "refresh_access_token", appFallback: "meta_app",
  },
  meta: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "ads_management business_management",
    refreshGrant: "fb_exchange_token", appFallback: "meta_app",
  },
  whatsapp: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "whatsapp_business_messaging whatsapp_business_management business_management",
    refreshGrant: "fb_exchange_token", appFallback: "meta_app",
  },
  pinterest: {
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scope: "boards:read pins:write", basic: true,
    refreshGrant: "refresh_token",
  },
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    extraAuth: { access_type: "offline", prompt: "consent" },
    refreshGrant: "refresh_token", appFallback: "google_app",
  },
  gmb: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/business.manage",
    extraAuth: { access_type: "offline", prompt: "consent" },
    refreshGrant: "refresh_token", appFallback: "google_app",
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scope: "video.upload video.publish", pkce: true,
    refreshGrant: "refresh_token",
  },
};

const DASHBOARD_OK = "https://dashboard.lazynext.com/settings?connected=";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function appCred(env: Env, id: string): Promise<{ id: string; secret: string } | null> {
  const p = OAUTH_CONNECTORS[id];
  const raw = (await env.EPHEMERAL.get(`conn:${id}:app`))
    ?? (p.appFallback ? await env.EPHEMERAL.get(`conn:${p.appFallback}`) : null);
  if (!raw) return null;
  const i = raw.indexOf(":");
  return i === -1 ? { id: raw, secret: "" } : { id: raw.slice(0, i), secret: raw.slice(i + 1) };
}

/** Admin-scope check for the browser-link ?key= path — same hash lookup as the
 *  gateway's authorize(), which only reads Authorization/x-api-key headers. */
async function authorizeAdmin(url: URL, env: Env): Promise<boolean> {
  const raw = url.searchParams.get("key") ?? "";
  if (!raw.startsWith("lzk_")) return false;
  const key = await env.DB.prepare(
    "SELECT scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
  ).bind(await sha256(raw)).first<{ scopes: string }>();
  return !!key && key.scopes.split(",").map((s) => s.trim()).includes("admin");
}

export async function handleConnect(
  req: Request, env: Env, path: string, url: URL,
): Promise<Response> {
  const m = path.match(/^\/api\/v1\/connect\/([a-z]+)\/(start|callback)$/);
  if (!m || req.method !== "GET") return json({ error: "not found" }, 404);
  const [, id, phase] = m;
  const p = OAUTH_CONNECTORS[id];
  if (!p) return json({ error: `connector '${id}' has no OAuth flow — paste its credential in Settings` }, 404);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/v1/connect/${id}/callback`;

  if (phase === "start") {
    const authedHeader = req.headers.get("authorization") ?? "";
    if (!authedHeader && !(await authorizeAdmin(url, env)))
      return json({ error: "admin key required — pass ?key=<lzk_admin> or Authorization: Bearer" }, 401);
    const app = await appCred(env, id);
    if (!app)
      return json({ error: `set conn:${p.appFallback ?? `${id}:app`} = "client_id[:client_secret]" in Settings first` }, 409);
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const payload: Record<string, string> = { id };
    const params = new URLSearchParams({
      client_id: app.id, redirect_uri: redirectUri, response_type: "code",
      scope: p.scope, state, ...(p.extraAuth ?? {}),
    });
    if (id === "tiktok") { params.delete("client_id"); params.set("client_key", app.id); }
    if (p.pkce) {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
      payload.verifier = verifier;
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      params.set("code_challenge", challenge);
      params.set("code_challenge_method", "S256");
    }
    await env.EPHEMERAL.put(`oauth:state:${state}`, JSON.stringify(payload), { expirationTtl: 600 });
    const authorizeUrl = `${p.authUrl}?${params}`;
    // Header-auth API callers get the URL as JSON; browser ?key= links 302.
    if (authedHeader) return json({ authorize_url: authorizeUrl });
    return Response.redirect(authorizeUrl, 302);
  }

  // callback — public; the one-time state token is the authentication.
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const stored = await env.EPHEMERAL.get(`oauth:state:${state}`, "json") as Record<string, string> | null;
  if (!stored || stored.id !== id || !code)
    return json({ error: url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "invalid or expired state" }, 400);
  await env.EPHEMERAL.delete(`oauth:state:${state}`);
  const app = await appCred(env, id);
  if (!app) return json({ error: "app credential deleted mid-flow" }, 500);

  const body = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
  });
  if (id === "tiktok") { body.set("client_key", app.id); body.set("client_secret", app.secret); }
  else { body.set("client_id", app.id); if (app.secret) body.set("client_secret", app.secret); }
  if (p.pkce && stored.verifier) body.set("code_verifier", stored.verifier);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (p.basic) headers.authorization = `Basic ${btoa(`${app.id}:${app.secret}`)}`;
  const tr = await fetch(p.tokenUrl, { method: "POST", headers, body });
  const tok = (await tr.json().catch(() => ({}))) as Record<string, unknown>;
  if (!tr.ok || !tok.access_token)
    return json({ error: `token exchange failed: ${tr.status} ${JSON.stringify(tok).slice(0, 300)}` }, 502);

  const cred = await resolveCred(env, id, String(tok.access_token));
  const oauth = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    expires_at: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null,
    cred_suffix: cred.suffix, obtained_at: Date.now(),
  };
  await env.EPHEMERAL.put(`conn:${id}`, cred.cred);
  await env.EPHEMERAL.put(`conn:${id}:oauth`, JSON.stringify(oauth));
  return Response.redirect(`${DASHBOARD_OK}${id}`, 302);
}

/** Turn a fresh access token into the flat conn:{id} string callConnector
 *  expects, resolving account/page/board ids through each provider's API. */
async function resolveCred(env: Env, id: string, token: string): Promise<{ cred: string; suffix: string }> {
  const auth = { authorization: `Bearer ${token}` };
  const get = async (u: string) => {
    const r = await fetch(u, { headers: auth });
    return r.ok ? ((await r.json().catch(() => ({}))) as Record<string, unknown>) : {};
  };
  switch (id) {
    case "facebook": {
      // exchange to a long-lived user token, then pick the first managed page.
      const pages = (await get("https://graph.facebook.com/v19.0/me/accounts?fields=id,access_token")).data as
        { id: string; access_token: string }[] | undefined;
      const page = pages?.[0];
      return page ? { cred: `${page.access_token}:${page.id}`, suffix: `:${page.id}` }
                  : { cred: token, suffix: "" };
    }
    case "instagram": {
      const pages = (await get("https://graph.facebook.com/v19.0/me/accounts?fields=id,access_token,instagram_business_account")).data as
        { id: string; access_token: string; instagram_business_account?: { id: string } }[] | undefined;
      for (const pg of pages ?? []) {
        if (pg.instagram_business_account?.id)
          return { cred: `${pg.access_token}:${pg.instagram_business_account.id}`, suffix: `:${pg.instagram_business_account.id}` };
      }
      return { cred: token, suffix: "" };
    }
    case "threads": {
      const me = await get("https://graph.threads.net/v1.0/me?fields=id");
      return me.id ? { cred: `${token}:${me.id}`, suffix: `:${me.id}` } : { cred: token, suffix: "" };
    }
    case "meta": {
      const accts = (await get("https://graph.facebook.com/v19.0/me/adaccounts?fields=id")).data as { id: string }[] | undefined;
      const act = accts?.[0]?.id?.replace(/^act_/, "") ?? "";
      return act ? { cred: `${token}:${act}`, suffix: `:${act}` } : { cred: token, suffix: "" };
    }
    case "whatsapp": {
      // WABA → phone_number_id resolution chain; falls back to bare token (the
      // adapter then tells the user to append ":<phone_number_id>").
      const biz = (await get("https://graph.facebook.com/v19.0/me/businesses?fields=id")).data as { id: string }[] | undefined;
      for (const b of biz ?? []) {
        const wabas = (await get(`https://graph.facebook.com/v19.0/${b.id}/owned_whatsapp_business_accounts?fields=id`)).data as { id: string }[] | undefined;
        for (const w of wabas ?? []) {
          const nums = (await get(`https://graph.facebook.com/v19.0/${w.id}/phone_numbers?fields=id`)).data as { id: string }[] | undefined;
          if (nums?.[0]?.id) return { cred: `${token}:${nums[0].id}`, suffix: `:${nums[0].id}` };
        }
      }
      return { cred: token, suffix: "" };
    }
    case "linkedin": {
      const me = await get("https://api.linkedin.com/v2/userinfo");
      const sub = String(me.sub ?? "");
      const urn = sub ? `urn:li:person:${sub}` : "";
      return urn ? { cred: `${token}:${urn}`, suffix: `:${urn}` } : { cred: token, suffix: "" };
    }
    case "pinterest": {
      const boards = (await get("https://api.pinterest.com/v5/boards")).items as { id: string }[] | undefined;
      const board = boards?.[0]?.id ?? "";
      return board ? { cred: `${token}:${board}`, suffix: `:${board}` } : { cred: token, suffix: "" };
    }
    case "gmb": {
      const accts = (await get("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")).accounts as { name: string }[] | undefined;
      const acct = accts?.[0]?.name ?? "";
      const locs = acct ? ((await get(`https://mybusinessbusinessinformation.googleapis.com/v1/${acct}/locations?readMask=name`)).locations as { name: string }[] | undefined) : undefined;
      const loc = locs?.[0]?.name ?? "";
      return acct && loc ? { cred: `${token}:${loc}`, suffix: `:${loc}` } : { cred: token, suffix: "" };
    }
    case "tiktok":
      // open_id comes back in the token response for tiktok — caller appends.
      return { cred: token, suffix: "" };
    case "x":
    case "youtube":
    default:
      return { cred: token, suffix: "" };
  }
}

/** Cron sweep: renew any conn:{id}:oauth token inside its expiry window and
 *  rewrite the flat conn:{id} cred with the preserved account suffix. */
export async function refreshConnectorTokens(env: Env): Promise<{ refreshed: string[]; failed: string[] }> {
  const out = { refreshed: [] as string[], failed: [] as string[] };
  for (const [id, p] of Object.entries(OAUTH_CONNECTORS)) {
    const raw = await env.EPHEMERAL.get(`conn:${id}:oauth`, "json") as Record<string, unknown> | null;
    if (!raw?.access_token) continue;
    const expires = Number(raw.expires_at ?? 0);
    const windowMs = Math.max(14 * 86400e3, (expires - Number(raw.obtained_at ?? 0)) * 0.2);
    if (expires && Date.now() < expires - windowMs) continue;
    if (!raw.refresh_token && p.refreshGrant !== "fb_exchange_token" && p.refreshGrant !== "refresh_access_token") continue;
    try {
      const app = await appCred(env, id);
      if (!app) continue;
      const grant = p.refreshGrant === "fb_exchange_token" ? "fb_exchange_token"
        : p.refreshGrant === "refresh_access_token" ? "refresh_access_token" : "refresh_token";
      const body = new URLSearchParams({ grant_type: grant });
      if (grant === "fb_exchange_token") {
        body.set("fb_exchange_token", String(raw.access_token));
        body.set("client_id", app.id); body.set("client_secret", app.secret);
      } else if (grant === "refresh_access_token") {
        body.set("access_token", String(raw.access_token));
        body.set("client_secret", app.secret);
      } else {
        body.set("refresh_token", String(raw.refresh_token));
        if (id === "tiktok") { body.set("client_key", app.id); body.set("client_secret", app.secret); }
        else { body.set("client_id", app.id); if (app.secret) body.set("client_secret", app.secret); }
      }
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (p.basic) headers.authorization = `Basic ${btoa(`${app.id}:${app.secret}`)}`;
      const r = await fetch(p.tokenUrl, { method: "POST", headers, body });
      const tok = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok || !tok.access_token) { out.failed.push(id); continue; }
      const suffix = String(raw.cred_suffix ?? "");
      await env.EPHEMERAL.put(`conn:${id}`, `${tok.access_token}${suffix}`);
      await env.EPHEMERAL.put(`conn:${id}:oauth`, JSON.stringify({
        ...raw, access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? raw.refresh_token,
        expires_at: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : raw.expires_at,
        obtained_at: Date.now(),
      }));
      out.refreshed.push(id);
    } catch { out.failed.push(id); }
  }
  return out;
}
