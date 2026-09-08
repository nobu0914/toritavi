/**
 * AI 送信の許諾を、**サーバ側でも見る**（JR000206）。
 *
 * ## なぜ要るか
 *
 * 2026-09-06 のデータ保護監査 レーン 4 —— 許諾の門は
 * **クライアントの 1 か所だけ**（`lib/features/scan/data/ocr_service.dart`）で、
 * サーバは `/api/ocr` `/api/concierge` とも `consent` の出現が **0 件**だった。
 * 許諾は `user_metadata` に入っており、`getUser` で**追加の往復なしに読める**
 * のに、見ていなかった。`CLAUDE.md` §5「1 か所で ✅ にしない」。
 *
 * ## 🔴 これは悪意ある利用者を止めない
 *
 * アプリ側の `ai_consent.dart` が明記しているとおり、
 * **メタデータは利用者自身が書き換えられる。** 止まるのは
 * 「改造していないクライアント」「将来の別入口」「うっかりの素通り」で、
 * 併せて **5.1.2(i) に対して「サーバ側にも門がある」と言える**ようになる。
 *
 * ## 🔴 いまは観測だけ。拒否しない
 *
 * 2026-09-06 の実測で、**20 人中 14 人が許諾の記録を持っていない**
 * （許諾は初回スキャンで訊くので、まだ読み取っていない人は当然そうなる）。
 * ここでいきなり 403 にすると、**課金中の利用者の OCR が止まる。**
 * 週次検査の観点 1「払った人が損をする経路」に正面から当たる。
 *
 * **先に広げて、後で締める**（`013` / `021` で学んだ順序）。
 * ログで「許諾なし」が 0 件になったら `enforceAiConsent` へ切り替える。
 */

/**
 * いまの許諾の版。
 *
 * 🔴 **アプリ側の `kAiConsentVersion` と必ず同じにする。**
 * ずれると、アプリは「許諾済み」と思っているのにサーバは「未許諾」と数える。
 * `src/lib/__tests__/ai-consent.test.ts` が両方を読んで突き合わせる。
 */
export const AI_CONSENT_VERSION = "2026-08-18";

export type UserMetadata = Record<string, unknown> | null | undefined;

/** いまの版に許諾しているか。**判定だけを持つ純粋関数**（アプリ側と同じ形）。 */
export function hasAiConsent(meta: UserMetadata): boolean {
  if (!meta) return false;
  return meta["ai_consent_version"] === AI_CONSENT_VERSION;
}

export type ConsentObservation =
  | { state: "ok" }
  | { state: "missing" }
  | { state: "stale"; recorded: string };

/** 何が起きているかを分類する。**副作用なし。** */
export function classifyAiConsent(meta: UserMetadata): ConsentObservation {
  const v = meta?.["ai_consent_version"];
  if (typeof v !== "string" || v.length === 0) return { state: "missing" };
  if (v !== AI_CONSENT_VERSION) return { state: "stale", recorded: v };
  return { state: "ok" };
}

/**
 * 観測してログに残す。**通す・通さないは変えない。**
 *
 * 🔴 **利用者を特定できる値を書かない**（レーン 7 の所見 —— ログは
 * アクセスログだけで PII が無い状態を保つ）。版と分類だけ出す。
 */
export function observeAiConsent(meta: UserMetadata, route: string): ConsentObservation {
  const o = classifyAiConsent(meta);
  if (o.state === "missing") {
    console.warn(`[ai-consent] ${route}: 許諾の記録なし（いまは通す・JR000206）`);
  } else if (o.state === "stale") {
    console.warn(
      `[ai-consent] ${route}: 許諾の版が古い recorded=${o.recorded} expected=${AI_CONSENT_VERSION}（いまは通す）`
    );
  }
  return o;
}

/**
 * 🔴 **2 段目の門を閉めるか。**
 *
 * `false` のあいだは**観測だけ**で、通す・通さないは変わらない。
 *
 * ## 閉めるまでの手順
 *
 * 1. Vercel のログで `[ai-consent]` の警告が **0 件**になるのを確かめる
 *    （残っているうちに閉めると、**課金中の利用者の OCR が止まる**）
 * 2. ここを `true` にして出す
 * 3. 出したあと、`403 ai_consent_required` が出ていないことを確かめる
 *
 * ## 🔴 環境変数にしない
 *
 * 環境変数だと**コードに痕跡が残らず、git で戻せない**（`CLAUDE.md` §4）。
 * 「いつ誰が閉めたか」が分からなくなる。**定数にして、変更をコミットに残す。**
 *
 * ## 🔴 これは悪意ある利用者を止めない
 *
 * メタデータは利用者自身が書き換えられる。止まるのは
 * 「改造していないクライアント」「将来の別入口」「うっかりの素通り」。
 */
export const AI_CONSENT_ENFORCE = false;

export type ConsentDecision =
  | { allow: true; observation: ConsentObservation }
  | { allow: false; status: 403; code: "ai_consent_required"; observation: ConsentObservation };

/**
 * 通すかどうかを決める。**投げない・書かない。** 呼ぶ側が応答を組む。
 *
 * `AI_CONSENT_ENFORCE` が false のあいだは**必ず通す**（観測は残る）。
 * 判定そのものは常に走らせる —— 閉める日に初めて動く経路を作らないため。
 */
export function decideAiConsent(meta: UserMetadata, route: string): ConsentDecision {
  const observation = observeAiConsent(meta, route);
  if (!AI_CONSENT_ENFORCE || observation.state === "ok") {
    return { allow: true, observation };
  }
  return {
    allow: false,
    status: 403,
    code: "ai_consent_required",
    observation,
  };
}
