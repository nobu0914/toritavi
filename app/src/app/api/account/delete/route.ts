import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";

/**
 * POST /api/account/delete
 *
 * Self-service account deletion. Authenticates the caller via either the
 * browser session cookie (web) or a Bearer JWT (mobile app) using
 * `authenticateRequest`, then uses the service-role client to delete the
 * auth user. Most per-user tables (toritavi_journeys / toritavi_steps /
 * toritavi_user_settings / toritavi_concierge_* / toritavi_ocr_* /
 * toritavi_user_plan) have an `ON DELETE CASCADE` FK to auth.users and are
 * dropped automatically when the auth user is removed.
 *
 * Tables WITHOUT such an FK (trip_contacts / trip_task_states /
 * affiliate_clicks) and Storage buckets (toritavi-avatars, step-attachments)
 * are NOT cascaded, so we delete them explicitly here before removing the
 * auth user. All cleanup is best-effort: failures are logged but never block
 * user deletion, so the user is never left in a half-deleted state.
 */

// Per-user tables lacking an ON DELETE CASCADE FK to auth.users — must be
// purged explicitly or they orphan after account deletion (trip_contacts
// holds PII such as phone numbers).
const NON_CASCADING_USER_TABLES = [
  "trip_contacts",
  "trip_task_states",
  "affiliate_clicks",
] as const;

/**
 * Remove everything under {userId}/ in the step-attachments bucket.
 * Path convention: {userId}/{stepId}/{uuid}.{ext} (two levels).
 */
const PAGE = 1000; // Supabase Storage list() の 1 ページあたり上限

/**
 * List every entry under `prefix`, paging until the API returns a short page.
 * A single list() call caps at 1000 entries, so a heavy user's folders would
 * otherwise be silently left behind on account deletion.
 */
async function listAll(
  bucket: ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>,
  prefix: string
): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw error; // 呼び出し元で捕捉し、削除不完全を明示ログする
    if (!data?.length) break;
    names.push(...data.map((e) => e.name));
    if (data.length < PAGE) break;
  }
  return names;
}

async function removeUserStepAttachments(
  admin: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<void> {
  const bucket = admin.storage.from("step-attachments");
  const stepFolders = await listAll(bucket, userId);
  const paths: string[] = [];
  for (const folder of stepFolders) {
    const files = await listAll(bucket, `${userId}/${folder}`);
    for (const f of files) paths.push(`${userId}/${folder}/${f}`);
  }
  // remove() も一度に渡せる件数に上限があるためチャンクで消す。
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
}

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

  // Best-effort: purge per-user tables that lack an ON DELETE CASCADE FK to
  // auth.users (otherwise they orphan). service-role bypasses RLS.
  for (const table of NON_CASCADING_USER_TABLES) {
    const { error: delErr } = await admin.from(table).delete().eq("user_id", userId);
    if (delErr) {
      console.warn(`[account/delete] ${table} cleanup failed (continuing)`, delErr);
    }
  }

  // Best-effort: remove the user's uploaded step attachments from Storage
  // (the step-attachments bucket is not cascaded by the auth user deletion).
  try {
    await removeUserStepAttachments(admin, userId);
  } catch (e) {
    console.warn("[account/delete] step-attachments cleanup failed (continuing)", e);
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
