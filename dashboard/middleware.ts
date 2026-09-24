import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

// Session gate: everything except /login, /api/login, and static assets
// requires the lazynext_session cookie (set by /api/login with the
// owner passphrase stored in the DASHBOARD_PASSPHRASE secret).
// Internal /api/* routes proxy to the worker with the owner bearer token,
// so they require the owner session specifically — a member session
// (lz_user_session, HMAC-signed by /api/auth) only grants page access.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/forgot" ||
    pathname === "/signup" ||
    pathname === "/verify" ||
    pathname === "/reset" ||
    pathname === "/api/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }
  const owner = req.cookies.get("lazynext_session")?.value === process.env.DASHBOARD_SESSION_TOKEN;
  const member = await verifySession(
    req.cookies.get("lz_user_session")?.value,
    process.env.DASHBOARD_SESSION_TOKEN
  );
  if (pathname.startsWith("/api/")) {
    // /api/logout only clears the caller's own cookies — members allowed.
    if (owner || (pathname === "/api/logout" && member)) return NextResponse.next();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (owner || member) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
