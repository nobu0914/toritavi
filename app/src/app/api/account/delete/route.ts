import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

/**
 * POST /api/account/delete
 *
 * Self-service account deletion. Authenticates the caller via the
 * request's session cookie, then uses the service-role client to
 * delete the auth user. `ON DELETE CASCADE` on the tables
 * (toritavi_journeys / toritavi_steps / toritavi_user_settings) drops
 * the user's data in the same transaction.
 *
 * Note: the Storage bucket `toritavi-avatars` is not cascaded — any
 * avatar object is removed explicitly before the user row goes away.
 * If that removal fails we still proceed with user deletion so the
 * user is never left in a half-deleted state (orphan avatar objects
 * are cleaned up by a periodic janitor elsewhere).
 */
export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      .remove([`${user.id}/avatar.jpg`, `${user.id}/avatar.png`, `${user.id}/avatar.webp`]);
  } catch (e) {
    console.warn("[account/delete] avatar cleanup failed (continuing)", e);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account/delete] deleteUser failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: invalidate the caller's session cookies so the browser
  // doesn't keep stale credentials around after the server-side user
  // record has been removed.
  try {
    await sb.auth.signOut();
  } catch {
    /* session cookie clearing is nice-to-have */
  }

  return NextResponse.json({ ok: true });
}
