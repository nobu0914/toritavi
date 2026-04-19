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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Guest mode cookie: bypass auth for protected pages
  const guestCookie = request.cookies.get("toritavi_guest")?.value;
  const isGuest = guestCookie === "1";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

  // If Supabase not configured, let everything through (dev convenience)
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next();
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
    return NextResponse.redirect(url);
  }

  // Unauth & non-guest hitting protected → send to login
  if (!user && !isGuest && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
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
