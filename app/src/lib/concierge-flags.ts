/**
 * コンシェルジュをサーバ側で閉じる（JR000187）。
 *
 * ## なぜ要るか
 *
 * アプリ側は `kConciergeEnabled = false` で**導線が無いだけ。API は生きていた。**
 * `/api/concierge` の POST には機能フラグの門が **0 件**で、
 * 通っていたのは Origin・`ai-guard`（回数）・モデレーションだけ。
 *
 * 🔴 **`src/lib/concierge-context.ts` は確認番号とメモを文脈に含める。**
 * つまり素通しだと、**旅程の題名・メモ・確認番号が Anthropic へ出うる。**
 *
 * **アプリのフラグはサーバを閉じない**（`CLAUDE.md` §5「1 か所で ✅ に
 * しない」）。JR000081（`/api/ocr` の許諾）と同じ型。
 *
 * ## なぜ閉じたままなのか
 *
 * 2026-08-01 に画面を降ろした理由は **AI が実在しない URL を出しうるのに
 * 誰も検査していない**こと（`toritavi_app/docs/feature-flags.md` §1.4）。
 * その表が片付くまで開けない。
 *
 * ## 🔴 環境変数にしない
 *
 * `GUEST_MODE_ENABLED` と同じ形にしてある。環境変数だと**コードに痕跡が
 * 残らず、git で戻せない**（`CLAUDE.md` §4）。「いつ誰が開けたか」が
 * 分からなくなる。**定数にして、変更をコミットに残す。**
 *
 * ## 開けるときに一緒に動かすもの
 *
 * 1. アプリの `kConciergeEnabled`
 * 2. ここ
 * 3. **AI 送信の許諾**（`decideAiConsent`）をこの経路にも配線する ——
 *    いまは `/api/ocr` だけ（JR000206）
 * 4. `docs/feature-flags.md` §1.4 の表
 */
export const CONCIERGE_ENABLED = false;
