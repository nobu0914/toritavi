/**
 * 1 リクエスト全体の**絶対締切**。
 *
 * 🔴 **段ごとのタイムアウトを足すと合計が上限を超える。**
 * 以前は `count_tokens` と `messages.create` にそれぞれ 50 秒を与えていて、
 * 合計 100 秒。関数の上限は 60 秒なので、**AI が返ったあとに精算する時間が
 * 残らないままプラットフォームに殺されうる**。殺されると `reserved` が
 * 残り、件数と予算を握ったままになる（掃除が拾うまで 15 分）。
 *
 * ここでは開始時刻から締切を引き、**精算のぶんを必ず取り置く**。
 */

/** `export const maxDuration` と揃える。 */
export const TOTAL_MS = 60_000;
/** プラットフォーム側の起動・終了に食われる分。 */
export const PLATFORM_SAFETY_MS = 3_000;
/** 精算（RPC 最大 3 回 + 応答）に必ず残す時間。 */
export const SETTLE_RESERVE_MS = 8_000;
/** トークン計測に与える上限。長引くなら諦めて落とす。 */
export const COUNT_MAX_MS = 10_000;
/** これを下回るなら AI を呼び始めない（呼んでも間に合わない）。 */
export const MIN_CALL_MS = 5_000;

export type Budget =
  | { ok: true; countMs: number }
  | { ok: false; reason: "no_time" };

/** 計測に使ってよい時間。 */
export function countBudget(startedAt: number, now: number): Budget {
  const remaining = startedAt + TOTAL_MS - PLATFORM_SAFETY_MS - now;
  const usable = remaining - SETTLE_RESERVE_MS - MIN_CALL_MS;
  if (usable <= 0) return { ok: false, reason: "no_time" };
  return { ok: true, countMs: Math.min(usable, COUNT_MAX_MS) };
}

/** AI 呼び出しに使ってよい時間。**精算のぶんは残す。** */
export function callBudget(startedAt: number, now: number): Budget {
  const remaining = startedAt + TOTAL_MS - PLATFORM_SAFETY_MS - now;
  const usable = remaining - SETTLE_RESERVE_MS;
  if (usable < MIN_CALL_MS) return { ok: false, reason: "no_time" };
  return { ok: true, countMs: usable };
}
