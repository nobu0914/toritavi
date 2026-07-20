import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiRejection } from "@/lib/moderation";

/**
 * AI 利用制限（OCR / コンシェルジュ共通）。
 *
 * P0: 3 層ガード（月予算 → 日次 → 分間バースト）を共通化・全 env 化。
 * P1: 利用者プラン（free / pro）別の日次・分間上限。free=現行と完全一致。
 * P2: getAiUsage() で残量を可視化（/api/ai-usage）。
 *
 * 機能ごとの非対称（保持必須）:
 * - 月予算超過は 503 / 日次・分間は 429。月予算はプラン非依存（全体共有）。
 * - 分間カウントの対象テーブルと role 絞り込み（concierge は role='user'）。
 * - 月キーの算出 tz（OCR=UTC / concierge=local）。Vercel は UTC 実行なので本番では一致。
 * - エラーメッセージ文言（「解析」/「送信」など機能差）。
 */

export type AiMonthTz = "utc" | "local";
export type Plan = "free" | "pro";

/** プラン別の日次・分間上限（月予算はプラン非依存なので含めない）。 */
export type TierLimits = {
  dailyRequests: number;
  dailyTokens: number;
  ratePerMin: number;
};

export type AiGuardConfig = {
  feature: string;
  /** 月予算（全体・共有・プラン非依存）。 */
  budgetMonthlyCents: number;
  tiers: { free: TierLimits; pro: TierLimits };
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

/**
 * 日次キーの基準タイムゾーン（JST = UTC+9）。
 *
 * 日本向けサービスなので「毎日 0:00 にリセット」がそのまま日本時間 0:00 を指す
 * ようにする。UTC 基準だと日本では 9:00 リセットになり説明しづらい。
 *
 * ⚠️ **書き込み側と必ず一致させること。** 使用量を書く RPC increment_ocr_usage
 * （本番DBに直接定義）が `(now() AT TIME ZONE 'Asia/Tokyo')::DATE` を day に
 * 使っている。ここを UTC に戻すと 0:00-9:00 JST の間だけ別キーを参照し、
 * 使用量 0 と誤認して**上限が全く効かなくなる**。
 * 変更する場合は SQL 側 → ここ の順で（逆順は上限が無効になる時間帯を作る）。
 * 正本: toritavi_app/docs/monetization-spec.md §2
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の今日（YYYY-MM-DD）。日次のキー。 */
function jstToday(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export const OCR_GUARD: AiGuardConfig = {
  feature: "ocr",
  budgetMonthlyCents: envNum(
    ["AI_OCR_BUDGET_MONTHLY_CENTS", "OCR_BUDGET_MONTHLY_CENTS"],
    2000,
  ), // $20
  tiers: {
    free: {
      dailyRequests: envNum(["AI_OCR_DAILY_REQUESTS", "OCR_DAILY_REQUEST_LIMIT"], 10),
      dailyTokens: envNum(["AI_OCR_DAILY_TOKENS", "OCR_DAILY_TOKEN_LIMIT"], 500_000),
      ratePerMin: envNum(["AI_OCR_RATE_PER_MIN", "OCR_RATE_LIMIT_PER_MIN"], 5),
    },
    pro: {
      dailyRequests: envNum(["AI_OCR_PRO_DAILY_REQUESTS"], 50),
      dailyTokens: envNum(["AI_OCR_PRO_DAILY_TOKENS"], 2_000_000),
      ratePerMin: envNum(["AI_OCR_PRO_RATE_PER_MIN"], 10),
    },
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
  budgetMonthlyCents: envNum(
    ["AI_CONCIERGE_BUDGET_MONTHLY_CENTS", "CONCIERGE_BUDGET_MONTHLY_CENTS"],
    5000,
  ), // $50
  tiers: {
    free: {
      dailyRequests: envNum(["AI_CONCIERGE_DAILY_REQUESTS"], 100),
      dailyTokens: envNum(["AI_CONCIERGE_DAILY_TOKENS"], 200_000),
      ratePerMin: envNum(["AI_CONCIERGE_RATE_PER_MIN"], 5),
    },
    pro: {
      dailyRequests: envNum(["AI_CONCIERGE_PRO_DAILY_REQUESTS"], 500),
      dailyTokens: envNum(["AI_CONCIERGE_PRO_DAILY_TOKENS"], 1_000_000),
      ratePerMin: envNum(["AI_CONCIERGE_PRO_RATE_PER_MIN"], 10),
    },
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
 * 利用者プランを解決。toritavi_user_plan に行が無い / テーブル未作成 / エラー時は
 * 'free'（= 現行挙動）にフォールバックする。SQL 適用前でも安全に動く。
 */
export async function resolvePlan(
  sb: SupabaseClient,
  userId: string,
): Promise<Plan> {
  try {
    const { data } = await sb
      .from("toritavi_user_plan")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.plan === "pro" ? "pro" : "free";
  } catch (e) {
    // テーブル未作成や一時的 DB エラーは free フォールバック（fail-safe）。
    // pro が課金対象になったら観測できるようログだけ残す。
    console.error("[ai-guard] resolvePlan failed; defaulting to free:", e);
    return "free";
  }
}

/**
 * 3 層ガードを順に評価。ブロック時は NextResponse（503/429）を返し、通過時は null。
 * 日次・分間はプラン別上限。月予算はプラン非依存。
 */
export async function enforceAiLimits(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
): Promise<NextResponse | null> {
  const plan = await resolvePlan(sb, userId);
  const tier = cfg.tiers[plan];

  // 拒否は toritavi_ai_rejections に記録して繰り返し違反者を可視化する
  // （規約 第9条6/7/8号）。記録はベストエフォートで await しても安全。
  const reject = async (
    reason: string,
    message: string,
    status: number,
  ): Promise<NextResponse> => {
    await logAiRejection(userId, cfg.feature as "ocr" | "concierge", reason);
    return NextResponse.json({ error: reason, message }, { status });
  };

  // 1) 月予算（全体・共有・プラン非依存）→ 503
  const { data: budget } = await sb
    .from(cfg.tables.budget)
    .select("spend_cents")
    .eq("month", firstOfThisMonth(cfg.monthTz))
    .maybeSingle();
  if (budget && budget.spend_cents >= cfg.budgetMonthlyCents) {
    return reject("monthly_budget_exceeded", cfg.messages.budgetExceeded, 503);
  }

  // 2) 日次（ユーザー別・プラン別）→ 429
  const { data: usage } = await sb
    .from(cfg.tables.usage)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq("day", jstToday())
    .maybeSingle();
  if (usage) {
    if (usage.requests_count >= tier.dailyRequests) {
      return reject("daily_request_limit", cfg.messages.dailyRequest, 429);
    }
    if (usage.tokens_total >= tier.dailyTokens) {
      return reject("daily_token_limit", cfg.messages.dailyToken, 429);
    }
  }

  // 3) 分間バースト（プラン別）→ 429
  const since = new Date(Date.now() - 60_000).toISOString();
  let q = sb
    .from(cfg.tables.events)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (cfg.eventsRoleFilter) q = q.eq("role", cfg.eventsRoleFilter);
  const { count: recentCount } = await q;
  if ((recentCount ?? 0) >= tier.ratePerMin) {
    return reject("rate_limit", cfg.messages.rateLimit(tier.ratePerMin), 429);
  }

  return null;
}

export type AiFeatureUsage = {
  usedRequests: number;
  limitRequests: number;
  usedTokens: number;
  limitTokens: number;
};

/** P2: 当日の使用量と（プラン別）上限を返す。残量表示用。 */
export async function getAiUsage(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
  plan: Plan,
): Promise<AiFeatureUsage> {
  const tier = cfg.tiers[plan];
  const { data: usage } = await sb
    .from(cfg.tables.usage)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq("day", jstToday())
    .maybeSingle();
  return {
    usedRequests: usage?.requests_count ?? 0,
    limitRequests: tier.dailyRequests,
    usedTokens: usage?.tokens_total ?? 0,
    limitTokens: tier.dailyTokens,
  };
}

/** 日次のリセット時刻（次の JST 0:00）の ISO 文字列。日キーと必ず同じ基準にする。 */
export function nextDailyResetIso(): string {
  // JST の壁時計を UTC メソッドで読むためにオフセットを足した時刻を作る。
  const jstNow = new Date(Date.now() + JST_OFFSET_MS);
  const nextJstMidnight = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate() + 1,
    0,
    0,
    0,
  );
  // 実時刻へ戻す（JST 0:00 = その UTC 表現から 9 時間前）。
  return new Date(nextJstMidnight - JST_OFFSET_MS).toISOString();
}
