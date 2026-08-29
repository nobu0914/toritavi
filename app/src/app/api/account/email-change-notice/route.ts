import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { sendMail, maskEmail } from "@/lib/mailer";

/**
 * POST /api/account/email-change-notice
 *
 * メールアドレス変更が要求されたことを、**これまでのアドレスへ知らせる。**
 *
 * ## なぜ要るか
 *
 * 一般的な作りは「**新**アドレスで確認する／**旧**アドレスには通知だけ」
 * （Google・GitHub・Apple ID）。ところが Supabase の Secure email change を
 * OFF にすると、**旧アドレスには何も届かなくなる**。GoTrue に「通知だけ送る」
 * 経路が無いためで、そこは自前で埋めるしかない。
 *
 * 🔴 **この経路が動くより先に Secure email change を OFF にしないこと。**
 * 先に OFF にすると、その間ずっと旧アドレスへ何も届かない ——
 * いまより弱い状態になる。順番は
 * 「①この経路を出す → ②動作を確認 → ③OFF → ④アプリの文言を切替」。
 * アプリ側の切替は `kEmailChangeNoticeEnabled`。
 *
 * ## 何を防いでいるか
 *
 * ログイン済みのセッションを奪った相手が、アドレスを自分のものへ変え、
 * 自分で確認して**アカウントを恒久的に奪う**筋。旧アドレスへ通知が飛べば
 * 本人が気づける。このアプリのアカウントには搭乗券・予約票・パスポートの
 * 写真が入っており、乗っ取りはそのまま写真の流出になる（`CLAUDE.md` §5）。
 *
 * ## 🔴 宛先はサーバが DB から取る。クライアントから受け取らない
 *
 * 本文にも宛先にもリクエストボディを一切使わない。使うと
 * **任意の宛先へ当社ドメインからメールを出せるオープンリレー**になる。
 *
 * ## 濫用の抑え方
 *
 * 送るのは「本当に変更が要求されている」ときだけ:
 *   - `new_email` が入っている（＝保留中の変更がある）
 *   - `email_change_sent_at` が直近 [FRESH_MS] 以内
 *   - 同じ要求に対してまだ送っていない（`raw_user_meta_data` の印で重複除去）
 *
 * ⚠️ **印は利用者自身が書き換えられる**（`ai_consent_store.dart` と同じ性質）。
 * 消せば同じ要求で再送できるが、飛ぶ先は**自分の旧アドレスだけ**で、
 * 変更要求そのものは GoTrue 側でレート制限されている。より強い抑止が要るなら
 * service-role 専用テーブルへ移すこと。
 */

/** 変更要求からこの時間内なら通知を送る。過ぎた要求では送らない。 */
const FRESH_MS = 10 * 60 * 1000;

/** 重複除去の印。`raw_user_meta_data` に入れる。 */
const NOTICE_KEY = "email_change_notice_at";

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 🔴 **ここが肝。** 認証済みの userId で service-role から引き直す。
  // 宛先も保留中の変更も、すべてサーバ側の値だけを使う。
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.getUserById(auth.userId);
  if (error || !data.user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  const user = data.user;
  const oldEmail = user.email;
  const newEmail = user.new_email;

  // 保留中の変更が無い＝通知する理由が無い。
  if (!oldEmail || !newEmail) {
    return NextResponse.json({ ok: true, sent: false, reason: "no_pending_change" });
  }

  const sentAt = user.email_change_sent_at
    ? Date.parse(user.email_change_sent_at)
    : NaN;
  if (!Number.isFinite(sentAt) || Date.now() - sentAt > FRESH_MS) {
    return NextResponse.json({ ok: true, sent: false, reason: "stale_request" });
  }

  // 同じ要求に対してすでに送っていれば送らない。
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const noticedAt = typeof meta[NOTICE_KEY] === "string" ? Date.parse(meta[NOTICE_KEY]) : NaN;
  if (Number.isFinite(noticedAt) && noticedAt >= sentAt) {
    return NextResponse.json({ ok: true, sent: false, reason: "already_sent" });
  }

  const result = await sendMail({
    to: oldEmail,
    subject: "【JUNROS】メールアドレスの変更が要求されました",
    text: [
      "JUNROS のご登録メールアドレスを",
      `  ${maskEmail(newEmail)}`,
      "へ変更する要求を受け付けました。",
      "",
      "新しいアドレス宛の確認メールのリンクが開かれると、変更が完了します。",
      "このメールに対する操作は必要ありません。",
      "",
      "■ 心当たりがない場合",
      "第三者があなたのアカウントを操作している可能性があります。",
      "すぐに次を行ってください。",
      "  1. JUNROS のパスワードを変更する",
      "  2. 変更できない場合は下記へご連絡ください",
      "",
      "お問い合わせ: support@coyoteandpowell.com",
      "",
      "――――――――――――――――",
      "JUNROS / 合同会社 Coyote and Powell",
      "https://junros.coyoteandpowell.com",
    ].join("\n"),
  });

  if (!result.ok) {
    // 🔴 **黙って ok を返さない。** 送れていないのに成功を返すと、
    // 「通知しているつもり」で Secure email change を OFF にしてしまう。
    console.error(
      `[email-change-notice] 送信できなかった: ${result.reason} ${result.detail ?? ""}`
    );
    return NextResponse.json(
      { ok: false, sent: false, reason: result.reason },
      { status: result.reason === "not_configured" ? 503 : 502 }
    );
  }

  // 送れたときだけ印を残す。失敗したまま印を残すと、次も送らなくなる。
  const { error: markError } = await svc.auth.admin.updateUserById(auth.userId, {
    user_metadata: { ...meta, [NOTICE_KEY]: new Date(sentAt).toISOString() },
  });
  if (markError) {
    // 送信自体は成功しているので ok は返す。印が残らないと同じ要求で
    // もう一度送りうるが、宛先は本人の旧アドレスなので実害は小さい。
    console.error(`[email-change-notice] 印を残せなかった: ${markError.message}`);
  }

  return NextResponse.json({ ok: true, sent: true });
}
