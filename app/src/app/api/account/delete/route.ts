import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

/**
 * POST /api/account/delete
 *
 * Self-service account deletion. Authenticates the caller via either the
 * browser session cookie (web) or a Bearer JWT (mobile app) using
 * `authenticateRequest`, then uses the service-role client to delete the
 * auth user. `ON DELETE CASCADE` on the tables
 * (toritavi_journeys / toritavi_steps / toritavi_user_settings) drops the
 * user's data in the same transaction.
 *
 * Note: the Storage bucket `toritavi-avatars` is not cascaded — any
 * avatar object is removed explicitly before the user row goes away.
 * If that removal fails we still proceed with user deletion so the user
 * is never left in a half-deleted state.
 */
const ALLOWED_ORIGINS = new Set([
  "https://toritavi.com",
  "https://app-lime-seven-80.vercel.app",
  "http://localhost:3000",
]);

export async function POST(request: NextRequest) {
  // Reject cross-site browser callers. Origin is absent on native (mobile)
  // requests, so skip the check when it is not present.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sb, userId } = auth;

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[account/delete] service client unavailable", e);
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  // Best-effort avatar cleanup. Failures are non-fatal.
  try {
    await admin.storage
      .from("toritavi-avatars")
      .remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.webp`]);
  } catch (e) {
    console.warn("[account/delete] avatar cleanup failed (continuing)", e);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[account/delete] deleteUser failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: clear the caller's cookie session (web). Mobile clients
  // sign out locally after a successful response.
  try {
    await sb.auth.signOut();
  } catch {
    /* session cookie clearing is nice-to-have */
  }

  return NextResponse.json({ ok: true });
}
