import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Generate a per-request CSP nonce and the full CSP header value.
 *
 *   - script-src uses 'nonce-xxx' + 'strict-dynamic'. Next.js stamps its
 *     bootstrap/hydration scripts (and preload <link>s) with the nonce it
 *     parses out of the *request* Content-Security-Policy header — see
 *     getScriptNonceFromHeader() in next/dist/server/app-render. It does NOT
 *     read 'x-nonce'. We set the same nonce on the request CSP header
 *     (consumed by the renderer) and the response CSP header (sent to the
 *     browser), so the two are identical by construction. The force-dynamic
 *     in app/layout.tsx keeps every route rendered at request time, so the
 *     live request header is always present — a statically prerendered page
 *     would instead carry a build-time nonce that no longer matches the fresh
 *     per-request response header.
 *   - style-src keeps 'unsafe-inline'. Mantine v9 has no emotion/CSS-in-JS
 *     runtime — it ships a static styles.css loaded via <link> (covered by
 *     'self'). But MantineProvider still injects un-nonced
 *     <style data-mantine-styles> blocks (theme CSS variables + classes) at
 *     runtime, and Mantine components emit pervasive inline style="" attrs
 *     (CSS variables, style props). Inline style *attributes* cannot be
 *     nonced or hashed under CSP, so 'unsafe-inline' is unavoidable here
 *     regardless of whether the <style> blocks themselves were nonced.
 *   - dev mode re-enables 'unsafe-eval' to let Next HMR work.
 */
function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  const directives = [
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
  ];
  // Only upgrade subresource requests to https in production. In local dev the
  // app is served over plain http (including to the Capacitor WebView on a LAN
  // IP), where upgrading the same-origin CSS/asset <link>s to https points them
  // at a non-existent TLS listener and silently breaks styling.
  if (isProd) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
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

const PROTECTED_PATHS = ["/", "/scan", "/alerts", "/unfiled", "/account", "/trips", "/concierge", "/admin"];

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

  // Per-request CSP nonce.
  //
  // Next.js stamps its own bootstrap/hydration scripts (and preload <link>s)
  // with the nonce it parses from the *request* Content-Security-Policy header
  // set just below — not from x-nonce. Setting that request header is
  // load-bearing: drop it and the scripts render without a nonce, which under
  // 'strict-dynamic' means every script is blocked.
  //
  // x-nonce is exposed only so first-party inline <script>/<style> in app code
  // can read the same nonce via headers().get('x-nonce'). Nothing reads it
  // today; it's kept as the conventional Next.js hook for when something does.
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

  // /admin is never accessible in guest mode — force a real session,
  // even if the guest cookie is set. The admin layout does a second
  // role check with requireAdmin().
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!user && isAdminPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
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
