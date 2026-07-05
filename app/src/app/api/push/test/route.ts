import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { sendToUser } from "@/lib/fcm";

/**
 * POST /api/push/test
 *
 * 認証済みユーザーが「自分の端末」へテスト通知を送る。APNs/FCM の配線が
 * 通っているかを実機で確認するための導線。他人へは送れない（自分の userId のみ）。
 *
 * 本番運用の通知（リマインド/お知らせ）はサーバ側のトリガ・/api/push/broadcast
 * から送る。これはあくまで疎通確認用。
 */
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
  try {
    const result = await sendToUser(auth.userId, {
      title: "Curlew テスト通知",
      body: "プッシュ通知の設定が正しく動いています。",
      data: { kind: "test" },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed";
    console.error("[push/test] failed", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
