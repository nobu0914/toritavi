/*
 * GET /api/ai-usage — 当期の AI 利用状況（OCR / コンシェルジュ）を返す。
 *
 * - 認証必須（Cookie or Bearer = authenticateRequest）
 * - プラン（free/pro）を解決し、機能別に used/limit と次回リセット時刻を返す
 * - 「当期」は機能で異なる（OCR=月次 / コンシェルジュ=日次）。各 feature の
 *   period フィールドがどちらかを示す
 * - 読み取り専用（使用量は加算しない）
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import {
  OCR_GUARD,
  CONCIERGE_GUARD,
  resolvePlan,
  getAiUsage,
  nextResetIso,
} from "@/lib/ai-guard";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sb, userId } = auth;

  // 🔴 **読めなかったら 200 で `free` を返さない**（2026-08-30 レーン 3）。
  //    アプリは「サーバに聞けた・無料だった」と解釈し、契約者に
  //    「まだ反映されていません」を出す —— **課金の嘘**になる。
  //    503 なら `subscriptionSync` は「聞けなかった」として扱える。
  let plan;
  try {
    plan = await resolvePlan(sb, userId);
  } catch {
    return NextResponse.json(
      { error: "plan_unavailable", message: "利用状況を取得できませんでした。" },
      { status: 503 },
    );
  }
  // 🔴 `getAiUsage` は期間キーを SQL に聞くので、**取れなければ投げる**
  //    （`QuotaPeriodUnavailableError`）。包まないと生 500 になる。
  //    2026-08-30 に concierge で同じ見落としをしたばかり
  //    —— `CLAUDE.md` §6-1 の 3「同じ経路を通る呼び出しを数える」。
  let ocr, concierge;
  try {
    [ocr, concierge] = await Promise.all([
      getAiUsage(sb, userId, OCR_GUARD, plan),
      getAiUsage(sb, userId, CONCIERGE_GUARD, plan),
    ]);
  } catch {
    return NextResponse.json(
      { error: "plan_unavailable", message: "利用状況を取得できませんでした。" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    plan,
    // 機能ごとにリセット単位が違う（OCR=月次 / コンシェルジュ=日次）。
    // トップレベルの resetAt は**配布済みアプリが読んでいる**ので残す。
    // 値は OCR のもの（バッジが表示しているのは OCR の残量）。
    resetAt: nextResetIso(OCR_GUARD.quotaPeriod),
    ocr: { ...ocr, resetAt: nextResetIso(OCR_GUARD.quotaPeriod) },
    concierge: {
      ...concierge,
      resetAt: nextResetIso(CONCIERGE_GUARD.quotaPeriod),
    },
  });
}
