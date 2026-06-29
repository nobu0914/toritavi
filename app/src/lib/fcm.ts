/**
 * FCM 送信（サーバ専用 / firebase-admin）。
 *
 * 認証情報は環境変数 `FIREBASE_SERVICE_ACCOUNT`（Firebase コンソールの
 * プロジェクト設定 → サービスアカウント → 新しい秘密鍵 で発行した JSON 全文）
 * を読む。Vercel の Project Env に設定する。未設定なら送信は例外になる。
 *
 * 端末トークンは toritavi_device_tokens（service-role で全件取得）から引く。
 * 配信に失敗した無効トークンはこの場で掃除する。
 */
import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { createServiceClient } from "./supabase-service";

let cached: App | null = null;

function adminApp(): App {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not set — paste the Firebase service-account JSON into .env.local and the Vercel project env."
    );
  }
  const sa = JSON.parse(raw);
  cached = getApps()[0] ?? initializeApp({ credential: cert(sa) });
  return cached;
}

export interface PushPayload {
  title: string;
  body: string;
  /** タップ時にアプリへ渡す任意データ（例: { journeyId }）。 */
  data?: Record<string, string>;
}

export interface SendResult {
  sent: number;
  failed: number;
  cleaned: number;
}

async function sendToTokens(
  tokens: string[],
  payload: PushPayload
): Promise<SendResult> {
  if (tokens.length === 0) return { sent: 0, failed: 0, cleaned: 0 };
  const messaging = getMessaging(adminApp());
  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];

  // FCM のマルチキャストは 1 回あたり最大 500 トークン。
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
      },
    });
    res.responses.forEach((r, idx) => {
      if (r.success) {
        sent++;
      } else {
        failed++;
        const code = r.error?.code ?? "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument") ||
          code.includes("invalid-registration-token")
        ) {
          invalid.push(batch[idx]);
        }
      }
    });
  }

  let cleaned = 0;
  if (invalid.length > 0) {
    try {
      const admin = createServiceClient();
      await admin.from("toritavi_device_tokens").delete().in("token", invalid);
      cleaned = invalid.length;
    } catch (e) {
      console.warn("[fcm] failed to clean invalid tokens", e);
    }
  }

  return { sent, failed, cleaned };
}

/** 特定ユーザーの全端末へ送信。 */
export async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<SendResult> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("toritavi_device_tokens")
    .select("token")
    .eq("user_id", userId);
  if (error) throw error;
  const tokens = (data ?? []).map((r) => r.token as string);
  return sendToTokens(tokens, payload);
}

/** 全ユーザー（全端末）へ一斉送信。お知らせ配信用。 */
export async function broadcast(payload: PushPayload): Promise<SendResult> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("toritavi_device_tokens")
    .select("token");
  if (error) throw error;
  const tokens = (data ?? []).map((r) => r.token as string);
  return sendToTokens(tokens, payload);
}
