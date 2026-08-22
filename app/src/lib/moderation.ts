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
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-service";

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
  userId: string
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
 * effort: never throws, so it can be awaited from the AI guard without risk.
 * Uses the service-role client (the table is service-role only).
 */
export async function logAiRejection(
  userId: string,
  feature: "ocr" | "concierge",
  reason: string
): Promise<void> {
  try {
    const admin = createServiceClient();
    await admin
      .from("toritavi_ai_rejections")
      .insert({ user_id: userId, feature, reason });
  } catch (e) {
    console.error("[moderation] logAiRejection failed", e);
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
  userId: string
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
      { error: "account_" + status, message: data?.reason ?? "ご利用を停止しています。" },
      { status: 403 }
    );
  } catch (e) {
    console.error("[moderation] strict status read failed; blocking:", e);
    return NextResponse.json(
      {
        error: "moderation_unavailable",
        message: "ただいま自動読み取りをご利用いただけません。しばらくしてからお試しください。",
      },
      { status: 503 }
    );
  }
}
