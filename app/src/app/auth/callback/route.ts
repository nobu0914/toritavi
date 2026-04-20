import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Supabase redirects here after:
//   - email verification (signup)
//   - password-reset email confirmation
//   - OAuth (Google) completion
// We exchange the `code` param for a session then bounce to the right page.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const type = searchParams.get("type"); // "recovery" for password reset

  // Sanitize `next` to block open-redirect abuse.
  //   - Must start with "/" (same-origin path)
  //   - Must NOT start with "//" (protocol-relative URL like //evil.com)
  //   - Reject other schemes (javascript:, data:, etc.)
  const nextRaw = searchParams.get("next") || "/";
  const next = /^\/(?!\/)/.test(nextRaw) ? nextRaw : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  if (type === "recovery") {
    // Recovery links grant a full Supabase session (exchangeCodeForSession
    // above). Without further restriction the user — or anyone who holds
    // their email briefly — can navigate anywhere in the app without
    // actually changing the password. We stamp a short-lived
    // `toritavi_recovery` cookie here and let the proxy (middleware) pin
    // the session to /reset-password until the password update completes.
    const res = NextResponse.redirect(`${origin}/reset-password`);
    res.cookies.set("toritavi_recovery", "1", {
      path: "/",
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60, // matches Supabase recovery token default lifetime
    });
    return res;
  }

  return NextResponse.redirect(`${origin}${next}`);
}
