/**
 * 旧アドレスへの変更通知を、**サーバ側でも閉じる**（JR000255）。
 *
 * ## なぜ要るか
 *
 * アプリ側は `kEmailChangeNoticeEnabled = false` で**呼ばないだけ。
 * API は生きている**（2026-09-08 に本番で `POST` に 401 を実測 ＝
 * ルートは在り、認証で弾いているだけ）。
 *
 * **アプリのフラグはサーバを閉じない**（`CLAUDE.md` §5「1 か所で ✅ に
 * しない」）。JR000081（`/api/ocr` の許諾）・JR000187（コンシェルジュ）と
 * 同じ型で、これが 3 件目。
 *
 * ## 何が漏れるか
 *
 * この経路は Resend 経由でメールを出す。**Resend は日本語 PP の委託先一覧に
 * 無い**（2026-09-08 に未稼働の例示ごと削除した）。開いた瞬間、
 * **公開文書に書いていない委託先へ利用者のアドレスと本文が渡る。**
 *
 * 🔴 **文面が日本語固定でもある。** 件名も本文も `lang` の分岐が無いので、
 * 開けると英語利用者にも日本語のセキュリティ通知が飛ぶ。
 *
 * ## 🔴 環境変数にしない
 *
 * `CONCIERGE_ENABLED` / `GUEST_MODE_ENABLED` と同じ形。環境変数だと
 * **コードに痕跡が残らず、git で戻せない**（`CLAUDE.md` §4）。
 * 「いつ誰が開けたか」が分からなくなる。**定数にして、変更をコミットに残す。**
 *
 * ## 🔴 判定不能なら送らない（フェイルクローズ）
 *
 * 両方が明示的に有効なときだけ送る。片方でも未設定・判定不能なら送らない。
 *
 * ## 開けるときに一緒に動かすもの
 *
 * 1. アプリの `kEmailChangeNoticeEnabled`
 * 2. ここ
 * 3. **通知の文面を日英に分ける**（`email-change-notice/route.ts`）
 * 4. **日英の PP に Resend を委託先として載せる**（いまは英語だけにある）
 * 5. Supabase の Secure email change を OFF（**②③④のあと**）
 *
 * 3・4 を飛ばせないよう、`toritavi_app` の
 * `test/features/auth/email_change_notice_bilingual_test.dart` と
 * サーバ側の `email-notice-flags.test.ts` が対で見張る。
 */
export const EMAIL_CHANGE_NOTICE_ENABLED = false;
