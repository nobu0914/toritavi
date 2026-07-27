/**
 * 退会時に消すユーザー所有データの**台帳**。
 *
 * ## なぜ 1 か所にまとめるか
 *
 * 書き手と消し手が別のリポジトリにある。Storage に書くのは Flutter アプリ
 * （`~/Dev/toritavi_app`）で、消すのはこのサーバ。片方だけ増えても、
 * どちらのリポジトリを見ても矛盾が見えない。
 *
 * 実際に起きた: 改善フィードバックの添付画像（`toritavi-feedback`）が
 * 2026-07-23 に本番へ入ったが、退会 API の削除対象に追加されなかった。
 * `022_feedback.sql` は投稿者に消させない設計（UPDATE/DELETE ポリシーを
 * 作っていない）なので、**本人も消せず退会でも消えない**画像が残っていた。
 * 予約票・搭乗券が写り込むスクリーンショットである。
 *
 * `increment_ocr_usage_srv` に `013` の JST 修正が入っていなかったのと同じ形
 * ——「複製した側／後から増えた側に、既知の対応が入らない」。
 *
 * ## 増やすときは 3 か所
 *
 * 1. ここに 1 行足す
 * 2. アプリ側の `test/core/storage_buckets_test.dart` の一覧を更新する
 *    （変えないとそのテストが落ちる＝気づける）
 * 3. 公開プライバシーポリシーの保存期間表に行を足す
 *    （`~/Dev/company-site/junros/privacy/index.html`）
 */

/** ユーザー所有の Storage バケット。パスは必ず `{userId}/` で始まる。 */
export type UserOwnedBucket = {
  id: string;
  /**
   * `{userId}/` から下の階層数。
   * - 1: `{userId}/{file}`（avatars, feedback）
   * - 2: `{userId}/{stepId}/{file}`（step-attachments）
   */
  depth: 1 | 2;
};

export const USER_OWNED_BUCKETS: readonly UserOwnedBucket[] = [
  // プロフィール画像。拡張子は決め打ちにしない（jpg/png/webp 以外が
  // 増えても取りこぼさないよう、列挙ではなく list() で拾う）。
  { id: "toritavi-avatars", depth: 1 },
  // スキャン元画像・予定への添付。**最も流出させてはいけない中身。**
  { id: "step-attachments", depth: 2 },
  // 改善フィードバックの添付。本人に削除手段が無いぶん、退会が唯一の出口。
  { id: "toritavi-feedback", depth: 1 },
];

/**
 * `auth.users` への `ON DELETE CASCADE` FK を持たないユーザー別テーブル。
 * 明示的に消さないと退会後に孤立する（`trip_contacts` は電話番号を持つ）。
 */
export const NON_CASCADING_USER_TABLES = [
  "trip_contacts",
  "trip_task_states",
  "affiliate_clicks",
] as const;

/**
 * 退会の後始末に失敗した記録を残すテーブル。
 *
 * **`auth.users` への FK を張っていない。** 張るとユーザー削除で
 * 一緒に消え、「消し損ねた記録」自体が消える。
 */
export const DELETION_FAILURE_TABLE = "toritavi_deletion_failures";
