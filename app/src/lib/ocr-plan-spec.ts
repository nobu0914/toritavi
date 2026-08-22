/**
 * 確定仕様（2026-08-22）の件数。**掲載文と課金の約束そのもの。**
 *
 * 🔴 ここを唯一の出どころにする。`ai-guard.ts` の既定値もこれを使う。
 * 既定が仕様と違うと、env の設定漏れが**静かに違う商品**になる。
 */
export const SPEC_FREE_REQUESTS = 5;
export const SPEC_PRO_REQUESTS = 50;
export const SPEC_GUEST_REQUESTS = 3;
