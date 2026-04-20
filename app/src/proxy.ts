import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
 * Ensure HTML responses advertise Origin as a Vary key. We return an
 * Origin-restricted Access-Control-Allow-Origin via next.config, so caches
 * must split by Origin — otherwise a cache populated by a cross-origin
 * request's 403 could be served to a legitimate same-origin browser.
 * Next.js adds its own Vary for RSC (`rsc, next-router-state-tree, ...`),
 * which was previously replacing the static header we set in next.config,
 * so we append here instead of set.
 */
function withVary(res: NextResponse): NextResponse {
  res.headers.append("Vary", "Origin");
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Guest mode cookie: bypass auth for protected pages
  const guestCookie = request.cookies.get("toritavi_guest")?.value;
  const isGuest = guestCookie === "1";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

  // If Supabase not configured, let everything through (dev convenience)
  if (!supabaseUrl || !supabaseKey) {
    return withVary(NextResponse.next());
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Authenticated user hitting public auth pages → send to home
  if (user && isPublicPath(pathname) && pathname !== "/auth/callback") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withVary(NextResponse.redirect(url));
  }

  // Unauth & non-guest hitting protected → send to login
  if (!user && !isGuest && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withVary(NextResponse.redirect(url));
  }

  return withVary(response);
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
