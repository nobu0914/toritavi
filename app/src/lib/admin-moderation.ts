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
import { sendToUser } from "@/lib/fcm";
import type { UserStatus } from "@/lib/moderation";
import { USER_OWNED_BUCKETS } from "@/lib/user-data-ledger";

/**
 * 🔴 **バケットの一覧は台帳から取る。ここに書かない。**
 *
 * 2026-08-30 まで、この 2 つを直書きしていた。台帳
 * （`user-data-ledger.ts`）は **3 つ**あり、`toritavi-feedback` が
 * 落ちていた。結果:
 *
 * - 利用者詳細の「ファイル」に**フィードバック添付が出ない**
 *   （予約票・搭乗券が写り込む前提のスクリーンショット）。エラーも出ない
 * - super_admin が消そうとしても `invalid bucket` で拒否される
 *
 * **同じ漏れで一度事故っている** —— 台帳が生まれた理由がまさに
 * 「退会 API から `toritavi-feedback` が漏れた」こと。
 * **その修正が、閲覧・削除側に入っていなかった。**
 *
 * 台帳に足せばここも自動で追随する（`admin_buckets_match_ledger` が見張る）。
 */
const ADMIN_VISIBLE_BUCKETS = USER_OWNED_BUCKETS;

/** `list()` が返す 1 件。SDK の `FileObject` をそのまま受ける。 */
type StorageEntry = Awaited<
  ReturnType<
    ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>["list"]
  >
>["data"] extends (infer T)[] | null
  ? T
  : never;

/** Supabase Storage の `list()` は 1 回 1000 件で頭打ち。捲らないと黙って切れる。 */
const LIST_PAGE = 1000;

/**
 * `prefix` 配下を全件返す。短いページが返るまで捲る。
 *
 * 🔴 **捲らないと、重い利用者のフォルダが黙って切れる。**
 * `api/account/delete` の `listAll` が同じ理由で捲っている
 * （あちらは「消し残す」、こちらは「見えない」）。**同じ罠の別の面。**
 */
async function listAllObjects(
  bucket: ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>,
  prefix: string
): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset });
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < LIST_PAGE) break;
  }
  return out;
}

// ---------- user status ----------

export type UserStatusDetail = {
  /** 監査ログに残せたか。false なら「記録なしで実行された」（画面で警告する）。 */
  audited?: boolean;
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

  // 🔴 **記録できなかったことを黙って捨てない**（2026-08-16 の検査）。
  //    監査失敗で業務は止めない設計（`admin-audit.ts` 冒頭）だが、
  //    捨てると「誰がやったか分からない特権操作」が成功として返る。
  //    呼び出し側へ渡し、画面に警告を出させる。
  const audited = await recordAuditLog(actor, {
    action: "admin.user.status_changed",
    targetType: "user",
    targetId: userId,
    // 🔴 **自由記述を監査へ写さない**（2026-08-16 の検査）。
    //    停止理由に氏名・予約番号・病名を書く運用が起きうる。監査ログは
    //    support_viewer にも見え、保持も長い —— **PII の複製が増える。**
    //    理由の本文は `toritavi_user_status.reason` に一次情報として残るので、
    //    監査には「書かれたかどうか」だけを残す。
    summary: `status=${status} reasonLen=${reason ? reason.length : 0}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    status: (data.status as UserStatus) ?? status,
    reason: (data.reason as string | null) ?? null,
    note: (data.note as string | null) ?? null,
    flagged: !!data.flagged,
    updatedAt: (data.updated_at as string | null) ?? null,
    audited,
  };
}

/** Toggle the non-blocking "under review" flag + optional internal note. */
export async function setUserFlag(
  actor: AdminContext,
  userId: string,
  flagged: boolean,
  note: string | null,
  meta: { ip: string | null; userAgent: string | null }
): Promise<{ audited: boolean }> {
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

  // 🔴 **記録できなかったことを黙って捨てない**（2026-08-16 の検査）。
  //    監査失敗で業務は止めない設計（`admin-audit.ts` 冒頭）だが、
  //    捨てると「誰がやったか分からない特権操作」が成功として返る。
  //    呼び出し側へ渡し、画面に警告を出させる。
  const audited = await recordAuditLog(actor, {
    action: "admin.user.flag_changed",
    targetType: "user",
    targetId: userId,
    summary: `flagged=${flagged}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { audited };
}

// ---------- abuse signals ----------

export type AbuseSignalRow = {
  userId: string;
  email: string | null;
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

  // 3) enrich: **raw** email + today's usage
  //
  // 🔴 ここは masked ではない（2026-08-16 の検査 L-2。コメントが実装と
  //    逆を言っていた）。乱用調査では宛先を突き合わせる必要があるため
  //    生のまま返す。**返す先が管理コンソールだけであることが前提**で、
  //    ここを外部へ出す面に繋ぐときは masked へ変えること。
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

  // email 解決は 1 件ずつ getUserById が必要（listUsers はメール検索不可）。
  // 逐次だと遅いので並列で引く。
  const emails = await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data } = await admin.auth.admin.getUserById(uid);
        return data?.user?.email ?? null;
      } catch {
        return null;
      }
    })
  );

  const rows: AbuseSignalRow[] = userIds.map((uid, i) => {
    const rej = byUser.get(uid)!;
    const st = statusByUser.get(uid);
    return {
      userId: uid,
      email: emails[i],
      status: st?.status ?? "active",
      flagged: st?.flagged ?? false,
      rejections7d: rej.count,
      ocrToday: ocrByUser.get(uid) ?? 0,
      conciergeToday: conciergeByUser.get(uid) ?? 0,
      lastRejectionAt: rej.last || null,
    };
  });

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

  for (const spec of ADMIN_VISIBLE_BUCKETS) {
    const bucket = admin.storage.from(spec.id);
    if (spec.depth === 1) {
      // {userId}/{file}
      for (const f of await listAllObjects(bucket, userId)) {
        files.push({
          bucket: spec.id,
          path: `${userId}/${f.name}`,
          name: f.name,
          sizeBytes: (f.metadata?.size as number | undefined) ?? null,
          createdAt: f.created_at ?? null,
        });
      }
    } else {
      // {userId}/{stepId}/{file}
      for (const folder of await listAllObjects(bucket, userId)) {
        for (const f of await listAllObjects(bucket, `${userId}/${folder.name}`)) {
          files.push({
            bucket: spec.id,
            path: `${userId}/${folder.name}/${f.name}`,
            name: f.name,
            sizeBytes: (f.metadata?.size as number | undefined) ?? null,
            createdAt: f.created_at ?? null,
          });
        }
      }
    }
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
): Promise<{ audited: boolean }> {
  if (!ADMIN_VISIBLE_BUCKETS.some((b) => b.id === bucket)) {
    throw new Error("invalid bucket");
  }
  if (!isPathOwnedBy(userId, bucket, path)) {
    throw new Error("path does not belong to user");
  }
  const admin = createServiceClient();
  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) throw error;

  // 🔴 **記録できなかったことを黙って捨てない**（2026-08-16 の検査）。
  //    監査失敗で業務は止めない設計（`admin-audit.ts` 冒頭）だが、
  //    捨てると「誰がやったか分からない特権操作」が成功として返る。
  //    呼び出し側へ渡し、画面に警告を出させる。
  const audited = await recordAuditLog(actor, {
    action: "admin.user.file_deleted",
    targetType: "user",
    targetId: userId,
    // 🔴 **ここはパスを残す。** 閲覧（`files_viewed`）では件数だけにしたが、
    //    削除は「どれを消したか」が記録の本体で、消した後は他に辿る術が無い。
    //    頻度も低い。**同じ表に見えて要件が逆**なので、両方に理由を書いておく。
    summary: `bucket=${bucket} path=${path}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { audited };
}

/** A path is owned by the user iff its first folder segment is the user id. */
function isPathOwnedBy(userId: string, bucket: string, path: string): boolean {
  if (!path || path.includes("..")) return false;
  const first = path.split("/")[0];
  return first === userId && ADMIN_VISIBLE_BUCKETS.some((b) => b.id === bucket);
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
): Promise<{ sent: number; failed: number; cleaned: number; audited: boolean }> {
  const result = await sendToUser(userId, {
    title,
    body,
    data: { kind: "admin_notice" },
  });

  // 🔴 **記録できなかったことを黙って捨てない**（2026-08-16 の検査）。
  //    監査失敗で業務は止めない設計（`admin-audit.ts` 冒頭）だが、
  //    捨てると「誰がやったか分からない特権操作」が成功として返る。
  //    呼び出し側へ渡し、画面に警告を出させる。
  const audited = await recordAuditLog(actor, {
    action: "admin.user.notified",
    targetType: "user",
    targetId: userId,
    // 通知タイトルも自由記述。長さだけ残す（本文は通知そのものに残る）。
    summary: `push titleLen=${title.length} sent=${result.sent} failed=${result.failed}`,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { ...result, audited };
}
