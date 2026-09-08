/**
 * POST /api/account/consent —— AI 送信の許諾を**サーバ側へ記録する**（§5.1）。
 * DELETE /api/account/consent —— 撤回する。
 *
 * ## なぜ要るか
 *
 * 許諾はいままで `raw_user_meta_data` にあり、**利用者自身が
 * `supabase.auth.updateUser(data:)` で書き換えられた。** それでは
 * 「同意した」の証跡にならない。書けるのがサーバだけの表へ移す。
 *
 * ## 🔴 版はサーバが決める
 *
 * クライアントから受け取るのは **表示言語と同意時刻だけ。**
 * 版（`AI_CONSENT_VERSION`）を受け取ると「古い版に同意した」と申告できて
 * しまい、専用表にした意味が消える。
 *
 * ## 🔴 画面は新設しない
 *
 * 許諾を訊く画面は既にある（`ai_consent_screen.dart`）。ここはその画面が
 * 押されたときの**記録先**であって、2 枚目の同意画面ではない。
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { recordAiConsent, withdrawAiConsent } from "@/lib/consent-store";

/** 受け取る値。**版は入っていない。** */
type Body = {
  legal_locale?: unknown;
  accepted_at?: unknown;
  app_version?: unknown;
};

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // 🔴 **知らない値は受け取らない。** ja / en 以外は拒否する
  //    （表の check 制約にも同じものが入っているが、ここでも止める）。
  const locale = body.legal_locale;
  if (locale !== "ja" && locale !== "en") {
    return NextResponse.json({ error: "bad_locale" }, { status: 400 });
  }

  // 🔴 **未来の時刻を受け取らない。** 表にも制約があるが、
  //    400 で返した方が原因が分かる。
  const acceptedAt =
    typeof body.accepted_at === "string" ? new Date(body.accepted_at) : null;
  if (!acceptedAt || Number.isNaN(acceptedAt.getTime())) {
    return NextResponse.json({ error: "bad_accepted_at" }, { status: 400 });
  }
  if (acceptedAt.getTime() > Date.now() + 5 * 60_000) {
    return NextResponse.json({ error: "accepted_at_future" }, { status: 400 });
  }

  const appVersion =
    typeof body.app_version === "string" && body.app_version.length <= 32
      ? body.app_version
      : undefined;

  const r = await recordAiConsent({
    userId: auth.userId,
    legalLocale: locale,
    acceptedAt: acceptedAt.toISOString(),
    appVersion,
  });
  if (!r.ok) {
    // 🔴 **成功したことにしない**（CLAUDE.md §5）。表が未適用のあいだも
    //    ここへ来る。呼び出し側は失敗を握り潰さず、次の起動で再送する。
    console.warn(`[consent] 記録できなかった reason=${r.reason}`);
    return NextResponse.json(
      { error: "record_failed", reason: r.reason },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await withdrawAiConsent(auth.userId);
  if (!r.ok) {
    console.warn(`[consent] 撤回を記録できなかった reason=${r.reason}`);
    return NextResponse.json(
      { error: "withdraw_failed", reason: r.reason },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}
