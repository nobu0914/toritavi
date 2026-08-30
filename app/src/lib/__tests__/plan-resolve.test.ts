// 🔴 **「分からない」を「無料」に変換しない。**
//
// 2026-08-30 のレーン 3 で見つけた形。`resolvePlan` はこうだった:
//
//     const { data } = await sb.from("toritavi_user_plan")...maybeSingle();
//     return data?.plan === "pro" ? "pro" : "free";
//
// **`error` を分割代入していない。** supabase-js は PostgREST のエラーを
// **throw せず `{data:null, error}` で返す**ので、下の catch は実質
// デッドコードだった。結果:
//
//   - 読み取りが一時的に失敗しただけで **Pro 契約者が黙って free に落ちる**
//     → 上限 5 件で 429「今月の読み取り上限に達しました」
//   - `/api/ai-usage` も同じ関数を使うので **200 + plan:'free'** を返し、
//     アプリは「サーバに聞けた・無料だった」と解釈して
//     **「まだ反映されていません」**を出す —— 課金の嘘
//
// `CLAUDE.md` §5「安全装置は静かに嘘をつかせない」。

import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanUnavailableError, resolvePlan } from "../plan-resolve.ts";
// 🔴 **`ai-guard.ts` からは import しない。** あちらは `next/server` を読むので
// `node --test` が解決できず、テストごと落ちる（2026-08-30 に踏んだ）。
// だから純粋な `plan-resolve.ts` に切り出してある。

/** `sb.from(...).select(...).eq(...).maybeSingle()` の形だけ真似る。 */
function fakeSb(result: { data?: unknown; error?: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as never;
}

test("pro の行が読めたら pro", async () => {
  assert.equal(await resolvePlan(fakeSb({ data: { plan: "pro" } }), "u1"), "pro");
});

test("行が無ければ free（未契約は正常な free）", async () => {
  assert.equal(await resolvePlan(fakeSb({ data: null }), "u1"), "free");
});

test("🔴 読み取りが失敗したら free に落とさず投げる", async () => {
  // ここが本番。**error があるのに free を返したら、契約者に嘘をつく。**
  await assert.rejects(
    () => resolvePlan(fakeSb({ data: null, error: { message: "boom" } }), "u1"),
    PlanUnavailableError,
  );
});

test("🔴 例外でも free に落とさない", async () => {
  const throwing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            throw new Error("network");
          },
        }),
      }),
    }),
  } as never;
  await assert.rejects(() => resolvePlan(throwing, "u1"), PlanUnavailableError);
});
