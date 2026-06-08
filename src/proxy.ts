import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware runs on the Edge before every matched request.
 *
 * Strategy:
 *  - If the user hits a protected route (/dashboard, /tasks, …) without the
 *    sentinel cookie → redirect to /  (login page).
 *  - If an already-authenticated user hits / → redirect to /dashboard.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("has_session");

  // ── Protect everything under /dashboard (and any other future routes) ──
  if (pathname.startsWith("/dashboard")) {
    if (!hasSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/";
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Redirect authenticated users away from the login page ──
  if (pathname === "/" && hasSession) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on every route except static assets and Next.js internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};