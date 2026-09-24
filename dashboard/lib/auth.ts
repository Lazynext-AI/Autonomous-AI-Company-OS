// Multi-user auth helpers — PBKDF2 hashing, tokens, sessions.
// All Web Crypto — runs on Cloudflare Workers.

export async function hashPassword(password: string, salt?: string) {
  const s = salt ?? toHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(s), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return { salt: s, hash: toHex(new Uint8Array(bits)) };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const { hash } = await hashPassword(password, salt);
  return hash === expected;
}

export function genToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(24)));
}

// Member session cookies are HMAC-signed so middleware can verify them
// without a KV lookup; unsigned or malformed values are rejected.
export async function signSession(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return `${token}.${toHex(new Uint8Array(sig))}`;
}

export async function verifySession(value: string | undefined, secret: string | undefined) {
  if (!value || !secret) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const token = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const bytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(token));
}

function toHex(b: Uint8Array) {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
