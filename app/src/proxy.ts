import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Generate a per-request CSP nonce and the full CSP header value.
 *
 *   - script-src uses 'nonce-xxx' + 'strict-dynamic'. Next.js automatically
 *     applies the nonce to its bootstrap/hydration scripts when it's pulled
 *     from the x-nonce request header (set below).
 *   - style-src keeps 'unsafe-inline' because Mantine v7 injects SSR styles
 *     as inline <style> tags. A separate migration path is needed to
 *     nonce/hash those (tracked as follow-up).
 *   - dev mode re-enables 'unsafe-eval' to let Next HMR work.
 */
function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function generateNonce(): string {
  // Web Crypto is available on the Edge Runtime.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Base64 per the CSP spec. btoa over a binary string works on Edge.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
];

const PROTECTED_PATHS = ["/", "/scan", "/alerts", "/unfiled", "/account", "/trips", "/concierge"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PROTECTED_PATHS.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Attach Vary: Origin (as append — Next.js adds its own RSC-related Vary
 * which would otherwise clobber a static set) and the per-request CSP.
 */
function withSecHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.append("Vary", "Origin");
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Per-request CSP nonce. Forward it to the app via a request header so
  // the root layout can pick it up (`headers().get('x-nonce')`) and Next.js
  // automatically tags its own bootstrap scripts with it.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // Guest mode cookie: bypass auth for protected pages
  const guestCookie = request.cookies.get("toritavi_guest")?.value;
  const isGuest = guestCookie === "1";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

  // If Supabase not configured, let everything through (dev convenience)
  if (!supabaseUrl || !supabaseKey) {
    return withSecHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Recovery session guard: while a recovery session is active (cookie
  // stamped by /auth/callback?type=recovery), the user must be on
  // /reset-password. Otherwise anyone holding the email briefly can click
  // the reset link and use the resulting full session without ever
  // changing the password.
  const isRecovery = request.cookies.get("toritavi_recovery")?.value === "1";
  if (
    isRecovery &&
    user &&
    pathname !== "/reset-password" &&
    pathname !== "/auth/callback"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/reset-password";
    return withSecHeaders(NextResponse.redirect(url), csp);
  }

  // Authenticated user hitting public auth pages → send to home.
  // /reset-password is excluded: a live recovery session needs to stay
  // there to finish the password change.
  if (
    user &&
    isPublicPath(pathname) &&
    pathname !== "/auth/callback" &&
    pathname !== "/reset-password"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withSecHeaders(NextResponse.redirect(url), csp);
  }

  // Unauth & non-guest hitting protected → send to login
  if (!user && !isGuest && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withSecHeaders(NextResponse.redirect(url), csp);
  }

  return withSecHeaders(response, csp);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static, _next/image
     * - favicon.ico, icons/, manifest.json, sw.js, cmaps/
     * - api routes (handled inline)
     */
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|pdf.worker.min.mjs|cmaps|api|robots.txt|.well-known).*)",
  ],
};
