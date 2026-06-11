/*
 * GET /api/ai-usage — 当日の AI 利用状況（OCR / コンシェルジュ）を返す。
 *
 * - 認証必須（Cookie or Bearer = authenticateRequest）
 * - プラン（free/pro）を解決し、機能別に used/limit と次回リセット時刻を返す
 * - 読み取り専用（使用量は加算しない）
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import {
  OCR_GUARD,
  CONCIERGE_GUARD,
  resolvePlan,
  getAiUsage,
  nextDailyResetIso,
} from "@/lib/ai-guard";

const ALLOWED_ORIGINS = new Set([
  "https://toritavi.com",
  "https://app-lime-seven-80.vercel.app",
  "http://localhost:3000",
]);

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

  const plan = await resolvePlan(sb, userId);
  const [ocr, concierge] = await Promise.all([
    getAiUsage(sb, userId, OCR_GUARD, plan),
    getAiUsage(sb, userId, CONCIERGE_GUARD, plan),
  ]);

  return NextResponse.json({
    plan,
    resetAt: nextDailyResetIso(),
    ocr,
    concierge,
  });
}
