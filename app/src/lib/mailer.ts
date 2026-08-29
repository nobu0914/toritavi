/**
 * 送信メール（Resend の API を直接叩く）。
 *
 * ## なぜ依存を足さないか
 *
 * `resend` パッケージを入れずに `fetch` で済ませている。理由は
 * **「手元にあって本番に無い依存」で 2026-08-24 に本番の PDF が 1 件も
 * 読めなくなった**ため（`CLAUDE.md` §6）。増やさずに済むものは増やさない。
 *
 * ## 送信元は Supabase の認証メールと同じ
 *
 * `noreply@junros.coyoteandpowell.com`。Resend（Amazon SES 上）で
 * ドメイン認証済みで、Supabase の SMTP がすでにここから出している
 * （`docs/supabase-auth-setup.md` 手順 3・2026-08-13 実測）。
 * **別のドメインから出すと SPF/DKIM が付かず迷惑メールに落ちる。**
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** 送信元。Supabase の認証メールと**同じ**にすること。 */
export const MAIL_FROM = "JUNROS <noreply@junros.coyoteandpowell.com>";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured" | "failed"; detail?: string };

/**
 * メールを 1 通送る。
 *
 * 🔴 **鍵が無いときに「送った」と返さない。** 安全装置を静かに嘘つきに
 * しないための決まり（`CLAUDE.md` §5）。呼び出し側が `not_configured` を
 * 見て記録できるようにする。
 */
export async function sendMail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "not_configured" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
      // 送信に手間取っても要求全体を止めない。呼び出し側は本筋
      // （アドレス変更の要求）を先に終えていて、これは通知でしかない。
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 🔴 本文に宛先を出さない。ログに個人情報を残さないため。
      return { ok: false, reason: "failed", detail: `${res.status} ${detail.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch (e) {
    return { ok: false, reason: "failed", detail: String(e).slice(0, 200) };
  }
}

/**
 * アドレスの一部を伏せる。`kijiatora.regi@gmail.com` → `ki***@gmail.com`
 *
 * 通知の本文に**新しいアドレスをそのまま載せない**ため。載せると、
 * 乗っ取られた場合に「攻撃者のアドレス」を本人以外にも読める形で
 * 配ることになる（通知は旧アドレスへ行くので本人ではあるが、
 * 転送設定や共有端末を考えると伏せるほうが安全側）。
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***${domain}`;
}
