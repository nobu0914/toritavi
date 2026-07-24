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
 * **組織 `genbox` の中にプロジェクトが複数ある。`genbox2` を選ぶこと。**
 * JUNROS は GenBox と `auth.users` を共有しているため、認証設定は
 * このプロジェクトが持っている。別プロジェクトを触っても何も変わらない。
 */
export const SUPABASE_PROJECT = {
  org: "genbox",
  project: "genbox2",
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

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: "confirm_signup",
    tab: "Confirm signup",
    purpose: "新規登録時。ここを直さないと登録できた人全員に届く",
    subject: "【JUNROS】メールアドレスの確認",
    html: `<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0E1F33">
  <div style="font-size:26px;font-weight:700;color:#0B6E8F;letter-spacing:-.02em">JUNROS</div>
  <div style="font-size:13px;color:#5B7088;margin-top:2px">予約票をスキャンして、旅程に</div>

  <div style="border:1px solid #E4EAE8;border-radius:12px;padding:24px;margin-top:24px">
    <div style="font-size:17px;font-weight:700">メールアドレスの確認</div>
    <p style="font-size:14px;line-height:1.8;color:#33485F">
      JUNROS へのご登録ありがとうございます。<br>
      下のボタンを開くと登録が完了します。
    </p>
    <p style="margin:24px 0">
      <a href="{{ .ConfirmationURL }}"
         style="display:inline-block;background:#1184C7;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px">
        メールアドレスを確認する
      </a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#5B7088">
      このメールに心当たりがない場合は、破棄してください。<br>
      ボタンが開かない場合は、以下の URL をブラウザに貼り付けてください。
    </p>
    <p style="font-size:11px;word-break:break-all;color:#5B7088">{{ .ConfirmationURL }}</p>
  </div>

  <p style="font-size:11px;color:#90A3B8;margin-top:20px">
    JUNROS — 株式会社コヨーテ・アンド・パウエル
  </p>
</div>`,
  },
  {
    key: "reset_password",
    tab: "Reset Password",
    purpose: "パスワードを忘れたとき。recovery トークンを含む",
    subject: "【JUNROS】パスワードの再設定",
    html: `<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0E1F33">
  <div style="font-size:26px;font-weight:700;color:#0B6E8F;letter-spacing:-.02em">JUNROS</div>
  <div style="font-size:13px;color:#5B7088;margin-top:2px">予約票をスキャンして、旅程に</div>

  <div style="border:1px solid #E4EAE8;border-radius:12px;padding:24px;margin-top:24px">
    <div style="font-size:17px;font-weight:700">パスワードの再設定</div>
    <p style="font-size:14px;line-height:1.8;color:#33485F">
      パスワード再設定のリクエストを受け付けました。<br>
      下のボタンから新しいパスワードを設定してください。
    </p>
    <p style="margin:24px 0">
      <a href="{{ .ConfirmationURL }}"
         style="display:inline-block;background:#1184C7;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px">
        パスワードを再設定する
      </a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#5B7088">
      このメールに心当たりがない場合は、破棄してください。<br>
      ボタンが開かない場合は、以下の URL をブラウザに貼り付けてください。
    </p>
    <p style="font-size:11px;word-break:break-all;color:#5B7088">{{ .ConfirmationURL }}</p>
  </div>

  <p style="font-size:11px;color:#90A3B8;margin-top:20px">
    JUNROS — 株式会社コヨーテ・アンド・パウエル
  </p>
</div>`,
  },
  {
    key: "magic_link",
    tab: "Magic Link",
    purpose: "現在アプリは未使用。空にすると旧文面が残るため直しておく",
    subject: "【JUNROS】ログイン用リンク",
    html: `<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0E1F33">
  <div style="font-size:26px;font-weight:700;color:#0B6E8F;letter-spacing:-.02em">JUNROS</div>
  <div style="font-size:13px;color:#5B7088;margin-top:2px">予約票をスキャンして、旅程に</div>

  <div style="border:1px solid #E4EAE8;border-radius:12px;padding:24px;margin-top:24px">
    <div style="font-size:17px;font-weight:700">ログイン</div>
    <p style="font-size:14px;line-height:1.8;color:#33485F">
      下のボタンからログインできます。
    </p>
    <p style="margin:24px 0">
      <a href="{{ .ConfirmationURL }}"
         style="display:inline-block;background:#1184C7;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px">
        ログインする
      </a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#5B7088">
      このメールに心当たりがない場合は、破棄してください。<br>
      ボタンが開かない場合は、以下の URL をブラウザに貼り付けてください。
    </p>
    <p style="font-size:11px;word-break:break-all;color:#5B7088">{{ .ConfirmationURL }}</p>
  </div>

  <p style="font-size:11px;color:#90A3B8;margin-top:20px">
    JUNROS — 株式会社コヨーテ・アンド・パウエル
  </p>
</div>`,
  },
  {
    key: "change_email",
    tab: "Change Email Address",
    purpose: "アカウント設定でメールアドレスを変えたとき",
    subject: "【JUNROS】メールアドレス変更の確認",
    html: `<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0E1F33">
  <div style="font-size:26px;font-weight:700;color:#0B6E8F;letter-spacing:-.02em">JUNROS</div>
  <div style="font-size:13px;color:#5B7088;margin-top:2px">予約票をスキャンして、旅程に</div>

  <div style="border:1px solid #E4EAE8;border-radius:12px;padding:24px;margin-top:24px">
    <div style="font-size:17px;font-weight:700">メールアドレスの変更</div>
    <p style="font-size:14px;line-height:1.8;color:#33485F">
      新しいメールアドレスへの変更を確認します。<br>
      下のボタンを開くと変更が完了します。
    </p>
    <p style="margin:24px 0">
      <a href="{{ .ConfirmationURL }}"
         style="display:inline-block;background:#1184C7;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px">
        変更を確認する
      </a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#5B7088">
      このメールに心当たりがない場合は、破棄してください。<br>
      ボタンが開かない場合は、以下の URL をブラウザに貼り付けてください。
    </p>
    <p style="font-size:11px;word-break:break-all;color:#5B7088">{{ .ConfirmationURL }}</p>
  </div>

  <p style="font-size:11px;color:#90A3B8;margin-top:20px">
    JUNROS — 株式会社コヨーテ・アンド・パウエル
  </p>
</div>`,
  },
];
