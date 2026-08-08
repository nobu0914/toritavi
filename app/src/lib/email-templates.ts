/**
 * JUNROS の認証メール（Supabase Auth の Email Templates）。
 *
 * **このファイルが本文の正本。** 手順書（toritavi_app の
 * `docs/supabase-auth-setup.md`）は本文を持たず、このページを参照する。
 * 同じ HTML を2箇所に置くと、片方だけ直った状態が必ず生まれる。
 *
 * SECURITY / 運用方針:
 *   ここは「掲示」だけを行う。Supabase の Management API を叩いて
 *   テンプレートを書き換える導線は**意図的に持たない**。書き換えには
 *   Personal Access Token が要り、それを本番の環境変数に置くと、
 *   管理コンソールが漏れたときにプロジェクト全体を触れる鍵まで漏れる。
 *   反映はダッシュボードで人が行う（`admin-maintenance-guide` と同じ方針）。
 *
 * 注意:
 *   `{{ .ConfirmationURL }}` は Supabase が用途ごとに中身を差し替える。
 *   **消さないこと。** 各テンプレートにボタンと末尾URLの2箇所ある。
 *
 * ロゴ（2026-08-06 に文字から画像へ）:
 *   `https://coyoteandpowell.com/images/junros-lockup-email.png`
 *   —— 実体は **company-site リポジトリ**（`images/junros-lockup-email.png`）。
 *   このリポジトリには無い。**消したり名前を変えたりすると、認証メールの
 *   ロゴだけが静かに落ちる**（メールは届き、リンクも効くので気づけない）。
 *   - SVG は使えない。Gmail が剥がす
 *   - PNG に白を焼き込んである。透過だと、`color-scheme` を無視して反転する
 *     クライアント（Gmail Android など）で濃紺のワードマークが消える
 *   - `alt="JUNROS"` に文字装飾を載せてあるのは、**画像がブロックされたときに
 *     以前の文字ロゴに近い見た目で出す**ため。20px なのは height:35px に収めるため
 */

export type EmailTemplateKey =
  | "confirm_signup"
  | "reset_password"
  | "magic_link"
  | "change_email";

export type EmailTemplate = {
  key: EmailTemplateKey;
  /** Supabase ダッシュボード左のタブ名（英語表記のまま照合する） */
  tab: string;
  /** どの経路で利用者に届くか */
  purpose: string;
  subject: string;
  html: string;
};

/**
 * 反映先の Supabase プロジェクト。
 *
 * **正は表示名ではなく project ref（`hugiyycgsmzhuldewwux`）。**
 * 2026-08-02 に 組織 `genbox` → `Coyote and Powell`、プロジェクト
 * `genbox2` → `JUNROS` へ改名した。**このファイルだけ追随が漏れていた**
 * （2026-08-06 に発見）。ref は改名で変わらないので、次に名前が変わっても
 * URL は古くならない。
 *
 * **組織の中にプロジェクトが複数ある。**（もう 1 つは `Mapint`。）
 * JUNROS は GenBox と `auth.users` を共有しているため、認証設定は
 * このプロジェクトが持っている。別プロジェクトを触っても何も変わらない。
 */
export const SUPABASE_PROJECT = {
  org: "Coyote and Powell",
  project: "JUNROS",
  ref: "hugiyycgsmzhuldewwux",
  templatesUrl:
    "https://supabase.com/dashboard/project/hugiyycgsmzhuldewwux/auth/templates",
  urlConfigUrl:
    "https://supabase.com/dashboard/project/hugiyycgsmzhuldewwux/auth/url-configuration",
} as const;

/** プレビュー表示でリンク先に入れるダミー（実体は置換しない）。 */
export const PREVIEW_URL = "https://example.invalid/confirm?token=SAMPLE";

/** プレビュー用に単体 HTML へ包む。テンプレート変数はダミーへ差し替える。 */
export function toPreviewDocument(html: string): string {
  return (
    '<!doctype html><meta charset="utf-8">' +
    "<style>html,body{margin:0;background:#fff}</style>" +
    html.split("{{ .ConfirmationURL }}").join(PREVIEW_URL)
  );
}

/**
 * 言語で出し分ける。**Supabase のテンプレートは 1 用途 1 本**で、言語ごとに
 * 別のテンプレートを持てない。Go テンプレートの条件分岐で切り替える。
 *
 * `.Data` は `auth.users.raw_user_meta_data`。アプリが登録時に
 * `data: {'lang': 'en'}` を入れる（`auth_repository.dart`）。
 *
 * 🔴 **`lang` を持たない利用者には日本語が出る。** この分岐を入れる前に
 * 登録した人と、`lang` を渡さない経路（Supabase ダッシュボードからの
 * 招待など）が該当する。**それでよい** —— 判定できないときは既定に倒す。
 * 英語話者に日本語が届くのは不便だが、その逆よりは害が小さい。
 */
function t(ja: string, en: string): string {
  return `{{ if eq .Data.lang "en" }}${en}{{ else }}${ja}{{ end }}`;
}

/** 4 通で変わるのは見出し・本文・ボタンの 3 つだけ。枠は共通。 */
function body(opts: {
  headingJa: string;
  headingEn: string;
  leadJa: string;
  leadEn: string;
  ctaJa: string;
  ctaEn: string;
}): string {
  return `<style>:root{color-scheme:light;supported-color-schemes:light}</style>
<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0E1F33;background-color:#ffffff">
  <img src="https://coyoteandpowell.com/images/junros-lockup-email.png"
       width="110" height="35" alt="JUNROS"
       style="display:block;border:0;width:110px;height:35px;font-size:20px;font-weight:700;color:#023964;letter-spacing:-.02em">
  <div style="font-size:13px;color:#5B7088;margin-top:8px">${t(
    "散らばった旅の予定を、ひとまとめに。",
    "All your travel plans in one place.",
  )}</div>

  <div style="border:1px solid #E4EAE8;border-radius:12px;padding:24px;margin-top:24px">
    <div style="font-size:17px;font-weight:700">${t(opts.headingJa, opts.headingEn)}</div>
    <p style="font-size:14px;line-height:1.8;color:#33485F">
      ${t(opts.leadJa, opts.leadEn)}
    </p>
    <p style="margin:24px 0">
      <a href="{{ .ConfirmationURL }}"
         style="display:inline-block;background:#1184C7;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px">
        ${t(opts.ctaJa, opts.ctaEn)}
      </a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#5B7088">
      ${t(
        "このメールに心当たりがない場合は、破棄してください。<br>ボタンが開かない場合は、以下の URL をブラウザに貼り付けてください。",
        "If you were not expecting this email, you can ignore it.<br>If the button does not work, paste the address below into your browser.",
      )}
    </p>
    <p style="font-size:11px;word-break:break-all;color:#5B7088">{{ .ConfirmationURL }}</p>
  </div>

  <p style="font-size:11px;color:#90A3B8;margin-top:20px">
    ${t("JUNROS — 合同会社 Coyote and Powell", "JUNROS — Coyote and Powell LLC")}
  </p>
</div>`;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: "confirm_signup",
    tab: "Confirm sign up",
    purpose: "新規登録時。ここを直さないと登録できた人全員に届く",
    subject: t("【JUNROS】メールアドレスの確認", "[JUNROS] Confirm your email address"),
    html: body({
      headingJa: "メールアドレスの確認",
      headingEn: "Confirm your email address",
      leadJa: "JUNROS へのご登録ありがとうございます。<br>下のボタンを開くと登録が完了します。",
      leadEn:
        "Thank you for signing up for JUNROS.<br>Open the button below to finish creating your account.",
      ctaJa: "メールアドレスを確認する",
      ctaEn: "Confirm my email address",
    }),
  },
  {
    key: "reset_password",
    tab: "Reset password",
    purpose: "パスワードを忘れたとき。recovery トークンを含む",
    subject: t("【JUNROS】パスワードの再設定", "[JUNROS] Reset your password"),
    html: body({
      headingJa: "パスワードの再設定",
      headingEn: "Reset your password",
      leadJa: "パスワード再設定のリクエストを受け付けました。<br>下のボタンから新しいパスワードを設定してください。",
      leadEn:
        "We received a request to reset your password.<br>Use the button below to set a new one.",
      ctaJa: "パスワードを再設定する",
      ctaEn: "Reset my password",
    }),
  },
  {
    key: "magic_link",
    tab: "Magic link or OTP",
    purpose: "現在アプリは未使用。空にすると旧文面が残るため直しておく",
    subject: t("【JUNROS】ログイン用リンク", "[JUNROS] Your log-in link"),
    html: body({
      headingJa: "ログイン",
      headingEn: "Log in",
      leadJa: "下のボタンからログインできます。",
      leadEn: "Use the button below to log in.",
      ctaJa: "ログインする",
      ctaEn: "Log in",
    }),
  },
  {
    key: "change_email",
    tab: "Change email address",
    purpose: "アカウント設定でメールアドレスを変えたとき",
    subject: t("【JUNROS】メールアドレス変更の確認", "[JUNROS] Confirm your new email address"),
    html: body({
      headingJa: "メールアドレスの変更",
      headingEn: "Change your email address",
      leadJa: "新しいメールアドレスへの変更を確認します。<br>下のボタンを開くと変更が完了します。",
      leadEn:
        "Please confirm the change to your new email address.<br>Opening the button below applies it.",
      ctaJa: "変更を確認する",
      ctaEn: "Confirm the change",
    }),
  },
];
