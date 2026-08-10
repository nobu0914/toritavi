/**
 * 法務文書の URL と、同意を取った版。
 *
 * **なぜ版を持つのか。** 「同意ボタンを押させた」だけでは、後から「どの内容に
 * 同意したのか」を示せない。米国の裁判例が clickwrap に求めるのは、目立つ通知と
 * 明確な同意行為に加えて、**それを再現できる記録**なので、版と時刻を残さないと
 * 同意を取った意味が半分になる。
 *
 * **モバイル側と揃えること。** 正本は
 * `~/Dev/toritavi_app/lib/features/auth/domain/legal_consent.dart`。
 * Web とモバイルは同じ Supabase プロジェクト・同じ `auth.users` を共有するので、
 * 片方だけ更新すると、どちらで登録したかによってメタデータの形が変わってしまう。
 *
 * **更新のしかた。** company-site の法務文書を実質改訂したら、対応する定数を
 * その「最終更新日」に合わせる。正本は
 * `~/Dev/company-site/legal-drafts/*.ja.md` 冒頭の `最終更新:` 行。
 */

export const TERMS_URL = "https://coyoteandpowell.com/junros/terms/";
export const PRIVACY_URL = "https://coyoteandpowell.com/junros/privacy/";
export const TOKUSHOHO_URL = "https://coyoteandpowell.com/junros/tokushoho/";

/** 利用規約の版（`junros-terms.ja.md` の最終更新日）。 */
export const TERMS_VERSION = "2026-07-27";

/** プライバシーポリシーの版（`shared-privacy.ja.md` の最終更新日）。 */
export const PRIVACY_VERSION = "2026-07-27";

/** 本サービスを利用できる最低年齢。利用規約 第3条1項と一致させること。 */
export const MINIMUM_AGE = 13;

/**
 * 登録時に `raw_user_meta_data` へ入れる同意の記録。
 *
 * 🔴 **クライアントが申告する値**なので、これ単体では改ざん不能な証跡にならない。
 * 同意しなければ登録できない実装（チェックボックス必須）と合わせて、
 * 「いつ・どの版に同意したか」を後から示せるようにしておくもの。
 */
export function consentMetadata(acceptedAt: Date) {
  return {
    terms_version: TERMS_VERSION,
    privacy_version: PRIVACY_VERSION,
    terms_accepted_at: acceptedAt.toISOString(),
    age_confirmed_min: MINIMUM_AGE,
  };
}
