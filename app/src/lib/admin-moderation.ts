/**
 * Admin-side moderation operations: user status (suspend/ban/flag), the
 * abuse-signal dashboard, per-user file management (Storage), the AI
 * rejection history, and targeted user notifications.
 *
 * server-only: everything here uses the service-role client and is called
 * exclusively from /api/admin/* routes and admin server components, all of
 * which independently call requireAdmin() first.
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";
import { recordAuditLog } from "@/lib/admin-audit";
import type { AdminContext } from "@/lib/admin-auth";
import { maskEmail } from "@/lib/admin-queries";
import { sendToUser } from "@/lib/fcm";
import type { UserStatus } from "@/lib/moderation";

const STEP_ATTACHMENTS_BUCKET = "step-attachments";
const AVATARS_BUCKET = "toritavi-avatars";

// ---------- user status ----------

export type UserStatusDetail = {
  status: UserStatus;
  reason: string | null;
  note: string | null;
  flagged: boolean;
  updatedAt: string | null;
};

export async function fetchUserStatus(
  userId: string
): Promise<UserStatusDetail> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("toritavi_user_status")
    .select("status, reason, note, flagged, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return { status: "active", reason: null, note: null, flagged: false, updatedAt: null };
  }
  return {
    status: (data.status as UserStatus) ?? "active",
    reason: (data.reason as string | null) ?? null,
    note: (data.note as string | null) ?? null,
    flagged: !!data.flagged,
    updatedAt: (data.updated_at as string | null) ?? null,
  };
}

/**
 * Set a user's access status (active / suspended / banned). super_admin only
 * (enforced at the route). Records an audit entry. `reason` is user-facing.
 */
export async function setUserStatus(
  actor: AdminContext,
  userId: string,
  status: UserStatus,
  reason: string | null,
  meta: { ip: string | null; userAgent: string | null }
): Promise<UserStatusDetail> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("toritavi_user_status")
    .upsert(
      {
        user_id: userId,
        status,
        reason: reason?.trim() || null,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("status, reason, note, flagged, updated_at")
    .single();
  if (error) throw error;

  await recordAuditLog(actor, {
    action: "admin.user.status_changed",
    targetType: "user",
    targetId: userId,
    summary: `status=${status}${reason ? ` reason="${reason.slice(0, 80)}"` : ""}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    status: (data.status as UserStatus) ?? status,
    reason: (data.reason as string | null) ?? null,
    note: (data.note as string | null) ?? null,
    flagged: !!data.flagged,
    updatedAt: (data.updated_at as string | null) ?? null,
  };
}

/** Toggle the non-blocking "under review" flag + optional internal note. */
export async function setUserFlag(
  actor: AdminContext,
  userId: string,
  flagged: boolean,
  note: string | null,
  meta: { ip: string | null; userAgent: string | null }
): Promise<void> {
  const admin = createServiceClient();
  const { error } = await admin.from("toritavi_user_status").upsert(
    {
      user_id: userId,
      flagged,
      note: note?.trim() || null,
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;

  await recordAuditLog(actor, {
    action: "admin.user.flag_changed",
    targetType: "user",
    targetId: userId,
    summary: `flagged=${flagged}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

// ---------- abuse signals ----------

export type AbuseSignalRow = {
  userId: string;
  emailMasked: string;
  status: UserStatus;
  flagged: boolean;
  rejections7d: number;
  ocrToday: number;
  conciergeToday: number;
  lastRejectionAt: string | null;
};

/**
 * Surface users worth a look: those with recent AI rejections (repeat
 * limit-hitters), plus anyone already flagged/suspended. Computed from
 * toritavi_ai_rejections + usage counters. Read-only.
 */
export async function fetchAbuseSignals(limit = 100): Promise<AbuseSignalRow[]> {
  const admin = createServiceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1) rejection counts per user over the last 7 days
  const { data: rejections } = await admin
    .from("toritavi_ai_rejections")
    .select("user_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  const byUser = new Map<string, { count: number; last: string }>();
  for (const r of rejections ?? []) {
    const uid = r.user_id as string | null;
    if (!uid) continue;
    const prev = byUser.get(uid);
    if (prev) prev.count += 1;
    else byUser.set(uid, { count: 1, last: r.created_at as string });
  }

  // 2) any flagged / non-active user (even without recent rejections)
  const { data: statuses } = await admin
    .from("toritavi_user_status")
    .select("user_id, status, flagged")
    .or("flagged.eq.true,status.neq.active")
    .limit(500);

  const statusByUser = new Map<string, { status: UserStatus; flagged: boolean }>();
  for (const s of statuses ?? []) {
    statusByUser.set(s.user_id as string, {
      status: (s.status as UserStatus) ?? "active",
      flagged: !!s.flagged,
    });
    if (!byUser.has(s.user_id as string)) {
      byUser.set(s.user_id as string, { count: 0, last: "" });
    }
  }

  const userIds = [...byUser.keys()];
  if (userIds.length === 0) return [];

  // 3) enrich: email (masked) + today's usage
  const today = new Date().toISOString().slice(0, 10);
  const [ocrRes, conciergeRes] = await Promise.all([
    admin
      .from("toritavi_ocr_usage")
      .select("user_id, requests_count")
      .in("user_id", userIds)
      .eq("day", today),
    admin
      .from("toritavi_concierge_usage")
      .select("user_id, requests_count")
      .in("user_id", userIds)
      .eq("day", today),
  ]);
  const ocrByUser = new Map(
    (ocrRes.data ?? []).map((r) => [r.user_id as string, r.requests_count as number])
  );
  const conciergeByUser = new Map(
    (conciergeRes.data ?? []).map((r) => [r.user_id as string, r.requests_count as number])
  );

  const rows: AbuseSignalRow[] = [];
  for (const uid of userIds) {
    const rej = byUser.get(uid)!;
    const st = statusByUser.get(uid);
    let emailMasked = "—";
    try {
      const { data } = await admin.auth.admin.getUserById(uid);
      emailMasked = maskEmail(data?.user?.email ?? null);
    } catch {
      /* leave masked placeholder */
    }
    rows.push({
      userId: uid,
      emailMasked,
      status: st?.status ?? "active",
      flagged: st?.flagged ?? false,
      rejections7d: rej.count,
      ocrToday: ocrByUser.get(uid) ?? 0,
      conciergeToday: conciergeByUser.get(uid) ?? 0,
      lastRejectionAt: rej.last || null,
    });
  }

  // most rejections first, then flagged/suspended
  rows.sort((a, b) => {
    if (b.rejections7d !== a.rejections7d) return b.rejections7d - a.rejections7d;
    return Number(b.flagged) - Number(a.flagged);
  });
  return rows.slice(0, limit);
}

export async function fetchUserRejections(
  userId: string,
  limit = 50
): Promise<{ feature: string; reason: string; created_at: string }[]> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("toritavi_ai_rejections")
    .select("feature, reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as { feature: string; reason: string; created_at: string }[];
}

// ---------- file management ----------

export type UserFile = {
  bucket: string;
  path: string;
  name: string;
  sizeBytes: number | null;
  createdAt: string | null;
};

/**
 * List a user's uploaded files across the step-attachments bucket
 * ({userId}/{stepId}/{uuid}.ext) and their avatar. Service-role list.
 */
export async function fetchUserFiles(userId: string): Promise<UserFile[]> {
  const admin = createServiceClient();
  const files: UserFile[] = [];

  // step attachments: two-level {userId}/{stepId}/{file}
  const stepBucket = admin.storage.from(STEP_ATTACHMENTS_BUCKET);
  const { data: stepFolders } = await stepBucket.list(userId, { limit: 1000 });
  for (const folder of stepFolders ?? []) {
    // folders have no metadata.size; skip file-like entries defensively
    const { data: inner } = await stepBucket.list(`${userId}/${folder.name}`, {
      limit: 1000,
    });
    for (const f of inner ?? []) {
      files.push({
        bucket: STEP_ATTACHMENTS_BUCKET,
        path: `${userId}/${folder.name}/${f.name}`,
        name: f.name,
        sizeBytes: (f.metadata?.size as number | undefined) ?? null,
        createdAt: (f.created_at as string | undefined) ?? null,
      });
    }
  }

  // avatar: {userId}/avatar.*
  const avatarBucket = admin.storage.from(AVATARS_BUCKET);
  const { data: avatarFiles } = await avatarBucket.list(userId, { limit: 20 });
  for (const f of avatarFiles ?? []) {
    files.push({
      bucket: AVATARS_BUCKET,
      path: `${userId}/${f.name}`,
      name: f.name,
      sizeBytes: (f.metadata?.size as number | undefined) ?? null,
      createdAt: (f.created_at as string | undefined) ?? null,
    });
  }

  return files;
}

/** Signed URL for previewing a single file (short TTL). Path must belong to the user. */
export async function signUserFile(
  userId: string,
  bucket: string,
  path: string,
  expiresIn = 120
): Promise<string | null> {
  if (!isPathOwnedBy(userId, bucket, path)) return null;
  const admin = createServiceClient();
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/**
 * Delete a single user file. super_admin only (enforced at route). The path
 * MUST live under the target user's folder — guards against a crafted path
 * deleting another user's or an arbitrary object. Audited.
 */
export async function deleteUserFile(
  actor: AdminContext,
  userId: string,
  bucket: string,
  path: string,
  meta: { ip: string | null; userAgent: string | null }
): Promise<void> {
  if (bucket !== STEP_ATTACHMENTS_BUCKET && bucket !== AVATARS_BUCKET) {
    throw new Error("invalid bucket");
  }
  if (!isPathOwnedBy(userId, bucket, path)) {
    throw new Error("path does not belong to user");
  }
  const admin = createServiceClient();
  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) throw error;

  await recordAuditLog(actor, {
    action: "admin.user.file_deleted",
    targetType: "user",
    targetId: userId,
    summary: `bucket=${bucket} path=${path}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** A path is owned by the user iff its first folder segment is the user id. */
function isPathOwnedBy(userId: string, bucket: string, path: string): boolean {
  if (!path || path.includes("..")) return false;
  const first = path.split("/")[0];
  return first === userId && (bucket === STEP_ATTACHMENTS_BUCKET || bucket === AVATARS_BUCKET);
}

// ---------- targeted notification ----------

/**
 * Send a push notification to one specific user's devices. support_operator+
 * (enforced at route). Audited. Returns delivery counts.
 */
export async function notifyUser(
  actor: AdminContext,
  userId: string,
  title: string,
  body: string,
  meta: { ip: string | null; userAgent: string | null }
): Promise<{ sent: number; failed: number; cleaned: number }> {
  const result = await sendToUser(userId, {
    title,
    body,
    data: { kind: "admin_notice" },
  });

  await recordAuditLog(actor, {
    action: "admin.user.notified",
    targetType: "user",
    targetId: userId,
    summary: `push title="${title.slice(0, 60)}" sent=${result.sent} failed=${result.failed}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return result;
}
