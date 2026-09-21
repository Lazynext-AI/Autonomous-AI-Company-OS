import { NextRequest, NextResponse } from "next/server";

// Session gate: everything except /login, /api/login, and static assets
// requires the lazynext_session cookie (set by /api/login with the
// owner passphrase stored in the DASHBOARD_PASSPHRASE secret).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }
  const token = req.cookies.get("lazynext_session")?.value;
  if (token === process.env.DASHBOARD_SESSION_TOKEN) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
