/**
 * 改善フィードバックの読み出し（管理コンソール用）。
 *
 * server-only: service-role クライアントを使う。呼び出し元は必ず先に
 * requireAdmin() を通していること。
 *
 * ## 添付画像の扱い
 * 利用者が送るスクリーンショットには **搭乗券・予約票・氏名が写り込む**。
 * バケットは非公開で、閲覧は毎回 **短命の署名 URL** を発行して行う。
 * 一覧では URL を作らず、詳細を開いたときだけ発行する
 * （一覧を開いただけで全員分の画像 URL が発行されるのを避ける）。
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

const FEEDBACK_BUCKET = "toritavi-feedback";
const TABLE = "toritavi_feedback";

export type FeedbackStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "done"
  | "wontfix";

export type FeedbackCategory = "bug" | "request" | "usability" | "other";

export type FeedbackRow = {
  id: string;
  userId: string;
  email: string | null;
  /** アプリが表示している会員番号。問い合わせと突き合わせる手がかり。 */
  memberId: string;
  category: FeedbackCategory;
  body: string;
  attachmentPath: string | null;
  appVersion: string | null;
  platform: string | null;
  osVersion: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
};

/**
 * UUID から会員番号を作る。
 * **アプリ側 `lib/features/account/domain/member_id.dart` と同じ規則。**
 * 片方だけ書式を変えると、利用者が読み上げた番号で検索できなくなる。
 */
export function memberIdFrom(userId: string): string {
  const head = userId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `CW-${head.slice(0, 4)}-${head.slice(4, 8)}`;
}

/** 会員番号 → UUID 前方一致用の小文字 hex。書式違いは null。 */
export function memberIdToUuidPrefix(memberId: string): string | null {
  const m = /^CW-([0-9A-F]{4})-([0-9A-F]{4})$/i.exec(memberId.trim());
  return m ? `${m[1]}${m[2]}`.toLowerCase() : null;
}

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "不具合",
  request: "要望",
  usability: "使いにくい",
  other: "その他",
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "未対応",
  triaged: "確認済み",
  in_progress: "対応中",
  done: "対応済み",
  wontfix: "対応しない",
};

/**
 * 一覧。既定では未完了のものだけ返す。
 * [status] を渡すとその状態だけに絞る。
 */
export async function fetchFeedback(
  limit = 100,
  status?: FeedbackStatus
): Promise<FeedbackRow[]> {
  const admin = createServiceClient();

  let q = admin
    .from(TABLE)
    .select(
      "id, user_id, category, body, attachment_path, app_version, platform, os_version, status, admin_note, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error || !data) return [];

  // メールは auth.users にしか無いので、必要な分だけ引く。
  const ids = [...new Set(data.map((r) => r.user_id as string))];
  const emails = await fetchEmails(ids);

  return data.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    email: emails.get(r.user_id as string) ?? null,
    memberId: memberIdFrom(r.user_id as string),
    category: r.category as FeedbackCategory,
    body: (r.body as string) ?? "",
    attachmentPath: (r.attachment_path as string | null) ?? null,
    appVersion: (r.app_version as string | null) ?? null,
    platform: (r.platform as string | null) ?? null,
    osVersion: (r.os_version as string | null) ?? null,
    status: r.status as FeedbackStatus,
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** user_id → email。取れなかったものは Map に入らない。 */
async function fetchEmails(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const admin = createServiceClient();
  for (const id of userIds) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) out.set(id, data.user.email);
    } catch {
      // 退会済みなど。メール無しで表示する。
    }
  }
  return out;
}

/**
 * 添付の署名 URL。**詳細を開いたときだけ呼ぶこと。**
 * パスが `<user_id>/...` の形で、その利用者のものであることを確認してから
 * 発行する（DB の値をそのまま信じない）。
 */
export async function signFeedbackAttachment(
  userId: string,
  path: string,
  expiresIn = 120
): Promise<string | null> {
  if (!path.startsWith(`${userId}/`)) return null;
  const admin = createServiceClient();
  const { data } = await admin.storage
    .from(FEEDBACK_BUCKET)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/** 対応状況・社内メモの更新。service-role からのみ。 */
export async function updateFeedback(
  id: string,
  patch: { status?: FeedbackStatus; adminNote?: string }
): Promise<boolean> {
  const admin = createServiceClient();
  const { error } = await admin
    .from(TABLE)
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.adminNote !== undefined ? { admin_note: patch.adminNote } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return !error;
}

/** 状態ごとの件数。ダッシュボードのバッジ用。 */
export async function countFeedbackByStatus(): Promise<
  Record<FeedbackStatus, number>
> {
  const admin = createServiceClient();
  const out: Record<FeedbackStatus, number> = {
    new: 0,
    triaged: 0,
    in_progress: 0,
    done: 0,
    wontfix: 0,
  };
  const { data } = await admin.from(TABLE).select("status");
  for (const r of data ?? []) {
    const s = r.status as FeedbackStatus;
    if (s in out) out[s] += 1;
  }
  return out;
}
