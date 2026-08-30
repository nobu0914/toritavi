/**
 * 利用者プランの解決。**`next/server` に依存しない**ので、素の node テストから
 * 検査できる（`plan-resolve.test.ts`）。`ai-guard.ts` は再エクスポートする。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Plan = "free" | "pro";

/**
 * 利用者プランを解決。toritavi_user_plan に行が無い / テーブル未作成 / エラー時は
 * 行が無い（未契約）なら `free`。**読めなかったときは投げる** —— 下記。
 */
export async function resolvePlan(
  sb: SupabaseClient,
  userId: string,
): Promise<Plan> {
  try {
    const { data, error } = await sb
      .from("toritavi_user_plan")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();
    // 🔴 **`error` を捨てない**（2026-08-30 レーン 3）。
    //
    //    supabase-js は PostgREST のエラーを **throw せず `{data:null, error}`
    //    で返す**ので、`error` を見なければ下の catch は実質デッドコード。
    //    読み取りが一時的に失敗しただけで **Pro 契約者が黙って free に落ち**、
    //    上限 5 件で 429「今月の上限に達しました」を食らう。
    //    `/api/ai-usage` も同じ関数を使うので **200 + plan:'free'** を返し、
    //    アプリ側は「サーバに聞けた・無料だった」と解釈して
    //    「まだ反映されていません」を出す —— **課金の嘘になる。**
    //
    //    読めなかったときは throw して、呼び出し側に 503 を出させる。
    //    **「分からない」を「無料」に変換しない**（`CLAUDE.md` §5）。
    if (error) throw error;
    return data?.plan === "pro" ? "pro" : "free";
  } catch (e) {
    console.error("[ai-guard] resolvePlan failed:", e);
    throw new PlanUnavailableError();
  }
}

/**
 * プランを読めなかった。**free と区別する。**
 *
 * 呼び出し側は 503 を返すこと —— 429（上限）にすると、
 * 契約者に「今月の上限に達しました」と嘘をつく。
 */
export class PlanUnavailableError extends Error {
  constructor() {
    super("plan unavailable");
    this.name = "PlanUnavailableError";
  }
}
