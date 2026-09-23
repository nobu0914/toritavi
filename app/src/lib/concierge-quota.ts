/**
 * コンシェルジュの**原子的な予約**。
 *
 * ## なぜ要るか（2026-08-30 レーン 8・2026-09-22 に対処）
 *
 * `/api/concierge` は **`enforceAiLimits`（見る）→ AI 呼び出し →
 * `recordConciergeUsage`（足す）** の順だった。
 * **「読んでから足す」形なので、同時に投げた分は全部が判定を通る。**
 * 残り 1 件の状態で 10 本同時に投げれば 10 本とも通り、
 * **上限も予算も超えられる。実費は Anthropic に発生する。**
 *
 * `/api/ocr` はこれを直すために `toritavi_ocr_begin_request` で
 * 原子的に予約する形へ作り替えた（`ON CONFLICT ... DO UPDATE ... WHERE` が
 * 行ロックの下で条件を評価する）。**コンシェルジュは作り替え前の形が
 * 残っていた**ので、同じ考え方で揃える。
 *
 * ## 🔴 フェイルクローズ
 *
 * 予約できないときは**通さない**。ここをフェイルオープンにすると、
 * DB が不調な間だけ上限も予算も消える（019 の事故と同じ形）。
 *
 * 🔴 **関数がまだ本番に無いときも、ここで止まる。** `tool/concierge_reopen.sql`
 * を流すまでコンシェルジュは 503 を返す —— **開いているつもりで
 * 上限の無い状態になる**よりはるかに良い。
 */
import "server-only";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { apiMessage, type Lang } from "@/lib/api-messages";
import { msgsFor, CONCIERGE_GUARD, type Audience } from "@/lib/ai-guard";
import { logAiRejection } from "@/lib/moderation";

export type ConciergeBegin =
  | { ok: true; usedAfter: number }
  | { ok: false; response: NextResponse };

/**
 * 1 件ぶん予約する。**AI を呼ぶ前に必ず通す。**
 *
 * 返る `status`（DB 側）:
 *   - `ok`              … 予約できた
 *   - `ai_disabled`     … 非常停止スイッチ
 *   - `budget_exceeded` … 月予算（全体共有・無料のみ）
 *   - `quota_exceeded`  … その人の日次件数
 *   - `quota_tokens`    … その人の日次トークン
 *   - `rate_limited`    … その人の**分間**レート（2026-09-23 に追加）
 *   - `user_budget_exceeded` … **その人の月の原価**（2026-09-23 に追加）
 *
 * 🔴 **分間レートは、定義してあるのに誰も呼んでいなかった。**
 *    `CONCIERGE_GUARD.tiers.*.ratePerMin`（無料 5 / Pro 10）は env でも
 *    設定でき、429 の文面まで用意されていたのに、`/api/concierge` から
 *    **一度も参照されていなかった** —— それでいて `route.ts` の冒頭は
 *    「3 階層キャップ（**分** / 日 / 月予算）」と宣言していた。
 *    原因は 2026-09-22 の作り替えで、`enforceAiLimits`（分を見ていた）を
 *    この関数に置き換えたときに**分だけが落ちた**（`CLAUDE.md` §6-1）。
 *    **日次 500 件（Pro）を数十秒で焼き切れる**状態だった。
 */
export async function beginConcierge(args: {
  userId: string;
  audience: Audience;
  estTokens: number;
  lang: Lang;
}): Promise<ConciergeBegin> {
  const tier = CONCIERGE_GUARD.tiers[args.audience];
  const msgs = msgsFor(CONCIERGE_GUARD, args.audience, args.lang);
  const admin = createServiceClient();

  const { data, error } = await admin.rpc("toritavi_concierge_begin", {
    p_user_id: args.userId,
    p_audience: args.audience,
    p_limit_requests: tier.quotaRequests,
    p_limit_tokens: tier.quotaTokens,
    p_est_tokens: args.estTokens,
    p_budget_cents: CONCIERGE_GUARD.budgetMonthlyCents,
    // 🔴 **分間レート。** DB 側で席を取る前に見る（`toritavi_concierge_rate_buckets`）。
    p_rate_per_min: tier.ratePerMin,
    // 🔴 **その人 1 人あたりの月の原価の蓋**（2026-09-23 に追加）。
    //    上の `budgetMonthlyCents` は全体共有で、意図どおり **Pro には
    //    効かせていない。** その結果 **Pro には金額の蓋が 1 つも無かった。**
    p_user_budget_cents: tier.userBudgetMonthlyCents,
  });

  if (error) {
    // 🔴 **通さない。** 関数が無い／DB が不調 —— どちらでも同じ扱い。
    console.error("[concierge-quota] begin failed:", error.message);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "quota_unavailable",
          message: apiMessage("plan_unavailable", args.lang),
        },
        { status: 503 },
      ),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const status = String(row?.status ?? "");
  const usedAfter = Number(row?.used_after ?? 0);

  if (status === "ok") return { ok: true, usedAfter };

  // 🔴 **拒否を記録する**（2026-09-23）。`toritavi_ai_rejections` が
  //    `/admin/abuse`（「AI/OCR 制限に繰り返し当たった利用者」）の材料。
  //
  //    🔴 **`logAiRejection` は `feature: "concierge"` を受け取る形で
  //    最初から用意されていたのに、コンシェルジュから一度も呼ばれていなかった。**
  //    書いていたのは `enforceAiLimits` だけで、2026-09-22 に
  //    この関数へ置き換えたときに**記録ごと落ちた** ——
  //    分間レートが落ちたのと同じ作り替えで、同じ型の抜け。
  //    **違反検知の画面がコンシェルジュを一切見ていなかった。**
  await logAiRejection(args.userId, "concierge", status);

  if (status === "ai_disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ai_disabled", message: apiMessage("plan_unavailable", args.lang) },
        { status: 503 },
      ),
    };
  }
  if (status === "budget_exceeded") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "monthly_budget_exceeded", message: msgs.budgetExceeded },
        { status: 503 },
      ),
    };
  }
  if (status === "user_budget_exceeded") {
    // 🔴 **429 ではなく 503。** 全体の月予算と同じ「時間が経てば戻る」形で、
    //    翌月 1 日に開く。利用者側に直せることは無い。
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "user_budget_exceeded",
          message: apiMessage("concierge_user_budget", args.lang),
        },
        { status: 503 },
      ),
    };
  }
  if (status === "rate_limited") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "rate_limit", message: msgs.rateLimit(tier.ratePerMin) },
        { status: 429 },
      ),
    };
  }
  if (status === "quota_tokens") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "quota_token_limit", message: msgs.quotaToken },
        { status: 429 },
      ),
    };
  }
  // quota_exceeded ほか
  return {
    ok: false,
    response: NextResponse.json(
      { error: "quota_request_limit", message: msgs.quotaRequest },
      { status: 429 },
    ),
  };
}

/**
 * 予約を戻す。**AI が落ちたときに呼ぶ。**
 *
 * 🔴 **戻し損ねても、上限が緩む方向には壊れない**（フェイルクローズ）。
 * 失うのは利用者の枠が 1 減ることだけ。だから `await` して失敗しても
 * 要求そのものは続ける。
 */
export async function releaseConcierge(userId: string): Promise<void> {
  try {
    const admin = createServiceClient();
    const { error } = await admin.rpc("toritavi_concierge_release", {
      p_user_id: userId,
    });
    if (error) console.error("[concierge-quota] release failed:", error.message);
  } catch (e) {
    console.error("[concierge-quota] release threw:", e);
  }
}
