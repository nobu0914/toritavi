/**
 * Moderation enforcement — shared by consumer API routes (OCR, concierge,
 * push/test) to reject suspended/banned users, and by the AI guard to log
 * rate-limit rejections.
 *
 * server-only: touches the service-role client for the rejection log.
 *
 * SAFETY: every function here FAILS OPEN. If toritavi_user_status does not
 * exist yet (migration not run), or a lookup errors, getUserStatus returns
 * "active" and assertActiveOr403 returns null — the user is NOT blocked.
 * A moderation-infra outage must never lock the whole user base out.
 */
import "server-only";
import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-service";
import { apiMessage, DEFAULT_LANG, type Lang } from "@/lib/api-messages";

export type UserStatus = "active" | "suspended" | "banned";

export type UserStatusRow = {
  status: UserStatus;
  reason: string | null;
};

/**
 * Read a user's moderation status via the caller's session client (RLS lets
 * a user read their own row). Fails open to "active" on any error.
 */
export async function getUserStatus(
  sb: SupabaseClient,
  userId: string
): Promise<UserStatusRow> {
  try {
    const { data, error } = await sb
      .from("toritavi_user_status")
      .select("status, reason")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return { status: "active", reason: null };
    const status = (data.status as UserStatus) ?? "active";
    return { status, reason: (data.reason as string | null) ?? null };
  } catch {
    return { status: "active", reason: null };
  }
}

/**
 * Guard for consumer API routes. Returns a 403 NextResponse if the user is
 * suspended or banned, otherwise null. Fails open (returns null) on error.
 */
export async function assertActiveOr403(
  sb: SupabaseClient,
  userId: string,
  lang: Lang = DEFAULT_LANG,
): Promise<NextResponse | null> {
  const { status, reason } = await getUserStatus(sb, userId);
  if (status === "active") return null;
  return NextResponse.json(
    {
      error: "account_suspended",
      status,
      message:
        reason ??
        "アカウントが一時的に制限されています。お問い合わせください。",
    },
    { status: 403 }
  );
}

/**
 * Append a rate-limit / budget rejection to toritavi_ai_rejections. Best
 * effort: never throws. Uses the service-role client (the table is
 * service-role only).
 *
 * 🔴 **応答を待たせない。`after()` で応答のあとに書く**（2026-10-19・夜間検査 7-41）。
 *
 * この表は `/admin/abuse` と `/admin/concierge` が**読むだけ**の記録で、
 * 上限を効かせる判定には一切使っていない（上限は DB の予約関数が持つ）。
 * 以前は呼び出し側が await しており、**上限に当たった利用者は 429 / 503 を
 * 受け取るまで、この記録の往復ぶん余計に待っていた。**
 *
 * 🔴 **記録をやめたのではない。** after() は応答のあとも関数の寿命を延ばして
 * 走らせる（Vercel の waitUntil）。だから戻り値は void —— **呼び出し側で
 * await しないこと**（しても何も待たない）。
 */
export function logAiRejection(
  userId: string,
  feature: "ocr" | "concierge",
  reason: string
): void {
  const write = async () => {
    try {
      const admin = createServiceClient();
      const { error } = await admin
        .from("toritavi_ai_rejections")
        .insert({ user_id: userId, feature, reason });
      // 🔴 **返ってきた error を捨てない。** supabase-js は失敗を throw せず
      //    `{ error }` で返すので、以前の catch だけでは**書けなかったことが
      //    どこにも出なかった**。コードだけ出す（本文に値が混ざりうる）。
      if (error) console.error("[moderation] logAiRejection failed", error.code ?? "unknown");
    } catch (e) {
      console.error("[moderation] logAiRejection failed", e);
    }
  };
  try {
    after(write);
  } catch {
    // リクエストの外（スクリプト等）では after() が投げる。その場で書いておく。
    void write();
  }
}

/**
 * **高原価の処理向けのフェイルクローズ版。**
 *
 * `assertActiveOr403` は障害時に "active" へ倒す。ログインや閲覧なら
 * それが正しい（モデレーション基盤の障害で全利用者を締め出さない）。
 * **AI 読み取りは違う** —— 1 回ごとに外部への支払いが発生するので、
 * 「停止したはずの利用者かどうか分からない」状態で通すと、
 * 凍結した相手に金を払い続けることになる。
 *
 * 通すのは **status を実際に読めて active だったときだけ**。
 */
export async function assertActiveOr403Strict(
  userId: string,
  lang: Lang = DEFAULT_LANG,
): Promise<NextResponse | null> {
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from("toritavi_user_status")
      .select("status, reason")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    // 行が無い = 一度も処分されていない = active。これは「読めた」状態。
    const status = (data?.status as UserStatus | undefined) ?? "active";
    if (status === "active") return null;
    return NextResponse.json(
      { error: "account_" + status, // 🔴 `reason` は運営が個別に入れた文面。**翻訳しない**
        //    （運営の言葉を機械が言い換えると意味が変わる）。既定文だけ出し分ける。
        message: data?.reason ?? apiMessage("account_blocked_fallback", lang) },
      { status: 403 }
    );
  } catch (e) {
    console.error("[moderation] strict status read failed; blocking:", e);
    return NextResponse.json(
      {
        error: "moderation_unavailable",
        message: apiMessage("ocr_suspended", lang),
      },
      { status: 503 }
    );
  }
}
