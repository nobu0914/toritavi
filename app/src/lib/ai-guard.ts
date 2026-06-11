import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AI 利用制限（OCR / コンシェルジュ共通）。
 *
 * P0: 既存の 3 層ガード（月予算 → 日次 → 分間バースト）を 2 ルートから共通化し、
 * 全上限を env 化する。**既定値は現行挙動と完全一致**。旧 env 名も後方互換で読む。
 *
 * 機能ごとの非対称（保持必須）:
 * - 月予算超過は 503 / 日次・分間は 429。
 * - 分間カウントの対象テーブルと role 絞り込み（concierge は role='user'）。
 * - 月キーの算出 tz（OCR=UTC / concierge=local）。Vercel は UTC 実行なので本番では一致。
 * - エラーメッセージ文言（「解析」/「送信」など機能差）。
 */

export type AiMonthTz = "utc" | "local";

export type AiGuardConfig = {
  feature: string;
  limits: {
    budgetMonthlyCents: number;
    dailyRequests: number;
    dailyTokens: number;
    ratePerMin: number;
  };
  tables: { budget: string; usage: string; events: string };
  /** 指定時は分間カウントの events を role=該当 で絞る（concierge='user'）。 */
  eventsRoleFilter?: string;
  monthTz: AiMonthTz;
  messages: {
    budgetExceeded: string;
    dailyRequest: string;
    dailyToken: string;
    rateLimit: (perMin: number) => string;
  };
};

/** 複数 env 名を順に見て最初の有効値を数値で返す（新 AI_* → 旧名 の後方互換）。 */
function envNum(names: string[], fallback: number): number {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== "") {
      const num = Number(v);
      if (!Number.isNaN(num)) return num;
    }
  }
  return fallback;
}

/** 今月 1 日（YYYY-MM-01）。tz は現行ルートの挙動を保持（OCR=utc / concierge=local）。 */
function firstOfThisMonth(tz: AiMonthTz): string {
  const d = new Date();
  const year = tz === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const month = (tz === "utc" ? d.getUTCMonth() : d.getMonth()) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export const OCR_GUARD: AiGuardConfig = {
  feature: "ocr",
  limits: {
    budgetMonthlyCents: envNum(
      ["AI_OCR_BUDGET_MONTHLY_CENTS", "OCR_BUDGET_MONTHLY_CENTS"],
      2000,
    ), // $20
    dailyRequests: envNum(["AI_OCR_DAILY_REQUESTS", "OCR_DAILY_REQUEST_LIMIT"], 50),
    dailyTokens: envNum(["AI_OCR_DAILY_TOKENS", "OCR_DAILY_TOKEN_LIMIT"], 500_000),
    ratePerMin: envNum(["AI_OCR_RATE_PER_MIN", "OCR_RATE_LIMIT_PER_MIN"], 5),
  },
  tables: {
    budget: "toritavi_ocr_budget",
    usage: "toritavi_ocr_usage",
    events: "toritavi_ocr_events",
  },
  monthTz: "utc",
  messages: {
    budgetExceeded:
      "画像解析を一時停止中です。今月の想定利用量を超えたため翌月 1 日に再開します。",
    dailyRequest: "本日の解析回数上限に達しました。翌日 0:00 にリセットされます。",
    dailyToken: "本日の使用量が上限に達しました。翌日 0:00 にリセットされます。",
    rateLimit: (n) =>
      `少しお待ちください。短時間に解析が多すぎます（1 分あたり ${n} 回まで）。`,
  },
};

export const CONCIERGE_GUARD: AiGuardConfig = {
  feature: "concierge",
  limits: {
    budgetMonthlyCents: envNum(
      ["AI_CONCIERGE_BUDGET_MONTHLY_CENTS", "CONCIERGE_BUDGET_MONTHLY_CENTS"],
      5000,
    ), // $50
    dailyRequests: envNum(["AI_CONCIERGE_DAILY_REQUESTS"], 100),
    dailyTokens: envNum(["AI_CONCIERGE_DAILY_TOKENS"], 200_000),
    ratePerMin: envNum(["AI_CONCIERGE_RATE_PER_MIN"], 5),
  },
  tables: {
    budget: "toritavi_concierge_budget",
    usage: "toritavi_concierge_usage",
    events: "toritavi_concierge_messages",
  },
  eventsRoleFilter: "user",
  monthTz: "local",
  messages: {
    budgetExceeded:
      "コンシェルジュを一時停止中です。今月の想定利用量を超えたため翌月 1 日に再開します。",
    dailyRequest: "本日の利用上限に達しました。翌日 0:00 にリセットされます。",
    dailyToken: "本日の使用量が上限に達しました。翌日 0:00 にリセットされます。",
    rateLimit: (n) =>
      `少しお待ちください。短時間に送信が多すぎます（1 分あたり ${n} 回まで）。`,
  },
};

/**
 * 3 層ガードを順に評価。ブロック時は NextResponse（503/429）を返し、通過時は null。
 * 呼び出し位置は各ルートの従来位置（OCR=body 解析前 / concierge=text 検証後）に置くこと。
 */
export async function enforceAiLimits(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
): Promise<NextResponse | null> {
  // 1) 月予算（全体・共有）→ 503
  const { data: budget } = await sb
    .from(cfg.tables.budget)
    .select("spend_cents")
    .eq("month", firstOfThisMonth(cfg.monthTz))
    .maybeSingle();
  if (budget && budget.spend_cents >= cfg.limits.budgetMonthlyCents) {
    return NextResponse.json(
      { error: "monthly_budget_exceeded", message: cfg.messages.budgetExceeded },
      { status: 503 },
    );
  }

  // 2) 日次（ユーザー別）→ 429
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await sb
    .from(cfg.tables.usage)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq("day", today)
    .maybeSingle();
  if (usage) {
    if (usage.requests_count >= cfg.limits.dailyRequests) {
      return NextResponse.json(
        { error: "daily_request_limit", message: cfg.messages.dailyRequest },
        { status: 429 },
      );
    }
    if (usage.tokens_total >= cfg.limits.dailyTokens) {
      return NextResponse.json(
        { error: "daily_token_limit", message: cfg.messages.dailyToken },
        { status: 429 },
      );
    }
  }

  // 3) 分間バースト → 429
  const since = new Date(Date.now() - 60_000).toISOString();
  let q = sb
    .from(cfg.tables.events)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (cfg.eventsRoleFilter) q = q.eq("role", cfg.eventsRoleFilter);
  const { count: recentCount } = await q;
  if ((recentCount ?? 0) >= cfg.limits.ratePerMin) {
    return NextResponse.json(
      {
        error: "rate_limit",
        message: cfg.messages.rateLimit(cfg.limits.ratePerMin),
      },
      { status: 429 },
    );
  }

  return null;
}
