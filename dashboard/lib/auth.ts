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

function toHex(b: Uint8Array) {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
