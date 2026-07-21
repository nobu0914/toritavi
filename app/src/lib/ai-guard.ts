import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiRejection } from "@/lib/moderation";

/**
 * AI 利用制限（OCR / コンシェルジュ共通）。
 *
 * 3 層ガード: 月予算 → クォータ（ユーザー別）→ 分間バースト。
 *
 * 機能ごとの非対称（保持必須）:
 * - 月予算超過は 503 / クォータ・分間は 429。
 * - **月予算は無料プランのみが対象。** 有料は件数上限だけで制御する（下記参照）。
 * - クォータの期間: OCR=月次（サブスクの商品そのもの）/ コンシェルジュ=日次（チャット）。
 * - 分間カウントの対象テーブルと role 絞り込み（concierge は role='user'）。
 * - エラーメッセージ文言（「解析」/「送信」など機能差）。
 *
 * ⚠️ 日キー・月キーは JST。**書き込み側（増分 RPC）と必ず一致させること。**
 * 対応する SQL: supabase_migrations/021_monthly_ocr_quota.sql
 * 正本: toritavi_app/docs/monetization-spec.md
 */

export type Plan = "free" | "pro";
export type QuotaPeriod = "day" | "month";

/** プラン別のクォータ・分間上限（月予算はプラン非依存なので含めない）。 */
export type TierLimits = {
  /** 期間あたりの件数上限。OCR は**ファイル数**（リクエスト数ではない）。 */
  quotaRequests: number;
  quotaTokens: number;
  ratePerMin: number;
};

export type AiGuardConfig = {
  feature: string;
  /**
   * 月予算（サービス全体で共有）。Anthropic への支出が青天井にならないための
   * 最外層。per-user 上限はユーザー数が無限なら総額を縛れないので、この層が要る。
   *
   * ⚠️ **無料プランにのみ適用する。** 共有のまま有料に効かせると、無料ユーザーが
   * 使い切った時点で課金者にも 503 が返り、返金請求と低評価に直結する。
   * 有料の原価は「人数 × 件数上限」で上界が計算できるので、予算という別軸は不要。
   */
  budgetMonthlyCents: number;
  tiers: { free: TierLimits; pro: TierLimits };
  tables: {
    budget: string;
    /** クォータ判定の正本テーブル。quotaPeriod に対応するキー列を持つこと。 */
    quota: string;
    events: string;
  };
  quotaPeriod: QuotaPeriod;
  /** 指定時は分間カウントの events を role=該当 で絞る（concierge='user'）。 */
  eventsRoleFilter?: string;
  messages: {
    budgetExceeded: string;
    quotaRequest: string;
    quotaToken: string;
    /** 残量より多いファイル数を一度に送った場合（残 n 件）。 */
    quotaUnits: (remaining: number) => string;
    rateLimit: (perMin: number) => string;
  };
};

/** 複数 env 名を順に見て最初の有効値を数値で返す。 */
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

/**
 * 日次・月次キーの基準タイムゾーン（JST = UTC+9）。
 *
 * 日本向けサービスなので「毎日 0:00 / 毎月 1 日 0:00 にリセット」がそのまま
 * 日本時間を指すようにする。UTC 基準だと日本では 9:00 リセットになり説明しづらい。
 *
 * ⚠️ **書き込み側と必ず一致させること。** 使用量を書く RPC
 * increment_ocr_usage_srv が `(now() AT TIME ZONE 'Asia/Tokyo')` を基準に
 * day / month を決めている。ここだけ UTC に戻すと別キーを参照し、使用量 0 と
 * 誤認して**上限が全く効かなくなる**（実際に 019 でこの穴が開いていた）。
 * 変更する場合は SQL 側 → ここ の順で。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の今日（YYYY-MM-DD）。日次のキー。 */
function jstToday(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の今月 1 日（YYYY-MM-01）。月次のキー。 */
function jstFirstOfMonth(): string {
  return `${jstToday().slice(0, 7)}-01`;
}

/** quotaPeriod に対応するキー列名と値。 */
function quotaKey(period: QuotaPeriod): { col: string; val: string } {
  return period === "month"
    ? { col: "month", val: jstFirstOfMonth() }
    : { col: "day", val: jstToday() };
}

export const OCR_GUARD: AiGuardConfig = {
  feature: "ocr",
  budgetMonthlyCents: envNum(
    ["AI_OCR_BUDGET_MONTHLY_CENTS", "OCR_BUDGET_MONTHLY_CENTS"],
    2000,
  ), // $20（無料プランのみ）
  tiers: {
    // ⚠️ env 名は *_MONTHLY_*。旧 *_DAILY_* にはフォールバックしない
    // （日次向けの値が月次上限として黙って適用されるのを防ぐため）。
    free: {
      quotaRequests: envNum(["AI_OCR_MONTHLY_REQUESTS"], 10),
      quotaTokens: envNum(["AI_OCR_MONTHLY_TOKENS"], 500_000),
      ratePerMin: envNum(["AI_OCR_RATE_PER_MIN", "OCR_RATE_LIMIT_PER_MIN"], 5),
    },
    pro: {
      quotaRequests: envNum(["AI_OCR_PRO_MONTHLY_REQUESTS"], 100),
      quotaTokens: envNum(["AI_OCR_PRO_MONTHLY_TOKENS"], 3_000_000),
      ratePerMin: envNum(["AI_OCR_PRO_RATE_PER_MIN"], 10),
    },
  },
  tables: {
    budget: "toritavi_ocr_budget",
    quota: "toritavi_ocr_usage_monthly",
    events: "toritavi_ocr_events",
  },
  quotaPeriod: "month",
  messages: {
    budgetExceeded:
      "画像解析を一時停止中です。今月の想定利用量を超えたため翌月 1 日に再開します。",
    quotaRequest:
      "今月の読み取り上限に達しました。翌月 1 日にリセットされます。",
    quotaToken: "今月の使用量が上限に達しました。翌月 1 日にリセットされます。",
    quotaUnits: (n) =>
      `今月の残りは ${n} 件です。選択した枚数を減らしてお試しください。`,
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
      quotaRequests: envNum(["AI_CONCIERGE_DAILY_REQUESTS"], 100),
      quotaTokens: envNum(["AI_CONCIERGE_DAILY_TOKENS"], 200_000),
      ratePerMin: envNum(["AI_CONCIERGE_RATE_PER_MIN"], 5),
    },
    pro: {
      quotaRequests: envNum(["AI_CONCIERGE_PRO_DAILY_REQUESTS"], 500),
      quotaTokens: envNum(["AI_CONCIERGE_PRO_DAILY_TOKENS"], 1_000_000),
      ratePerMin: envNum(["AI_CONCIERGE_PRO_RATE_PER_MIN"], 10),
    },
  },
  tables: {
    budget: "toritavi_concierge_budget",
    quota: "toritavi_concierge_usage",
    events: "toritavi_concierge_messages",
  },
  // チャットは日次が自然な単位。サブスクのクォータ商品ではないので月次にしない。
  quotaPeriod: "day",
  eventsRoleFilter: "user",
  messages: {
    budgetExceeded:
      "コンシェルジュを一時停止中です。今月の想定利用量を超えたため翌月 1 日に再開します。",
    quotaRequest: "本日の利用上限に達しました。翌日 0:00 にリセットされます。",
    quotaToken: "本日の使用量が上限に達しました。翌日 0:00 にリセットされます。",
    quotaUnits: (n) => `本日の残りは ${n} 件です。`,
    rateLimit: (n) =>
      `少しお待ちください。短時間に送信が多すぎます（1 分あたり ${n} 回まで）。`,
  },
};

/**
 * 利用者プランを解決。toritavi_user_plan に行が無い / テーブル未作成 / エラー時は
 * 'free'（= 制限が厳しい側）にフォールバックする。フェイルクローズ。
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
    console.error("[ai-guard] resolvePlan failed; defaulting to free:", e);
    return "free";
  }
}

/** ガードを通過したときの情報。呼び出し側が枚数チェックに使う。 */
export type AiGuardPass = {
  plan: Plan;
  /** この期間に残っている件数（OCR はファイル数）。 */
  remaining: number;
};

/**
 * 3 層ガードを順に評価。ブロック時は NextResponse（503/429）、通過時は AiGuardPass。
 *
 * 呼び出し側はボディを読んだあと、実際の件数が `remaining` を超えていないかを
 * assertUnitsWithinQuota() で確認すること。ここではボディを読む前に済ませられる
 * 判定だけを行う（巨大なボディを読んでから弾くのは無駄なため）。
 */
export async function enforceAiLimits(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
): Promise<NextResponse | AiGuardPass> {
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

  // 1) 月予算（全体共有）→ 503。**無料プランのみ。**
  //    有料に効かせると無料ユーザーの消費で課金者が止まる。
  if (plan === "free") {
    const { data: budget } = await sb
      .from(cfg.tables.budget)
      .select("spend_cents")
      .eq("month", jstFirstOfMonth())
      .maybeSingle();
    if (budget && budget.spend_cents >= cfg.budgetMonthlyCents) {
      return reject("monthly_budget_exceeded", cfg.messages.budgetExceeded, 503);
    }
  }

  // 2) クォータ（ユーザー別・プラン別）→ 429
  const key = quotaKey(cfg.quotaPeriod);
  const { data: usage } = await sb
    .from(cfg.tables.quota)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq(key.col, key.val)
    .maybeSingle();
  const used = usage?.requests_count ?? 0;
  if (usage) {
    if (used >= tier.quotaRequests) {
      return reject("quota_request_limit", cfg.messages.quotaRequest, 429);
    }
    if (usage.tokens_total >= tier.quotaTokens) {
      return reject("quota_token_limit", cfg.messages.quotaToken, 429);
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

  return { plan, remaining: Math.max(0, tier.quotaRequests - used) };
}

/**
 * ボディを読んだあとの件数チェック。
 *
 * /api/ocr は 1 リクエストで複数ファイルを受け付けるので、「残り 1 件」の状態で
 * 10 枚送られると上限を 10 倍すり抜ける。enforceAiLimits はボディを読む前に
 * 走るため件数を知らない。ここで塞ぐ。
 */
export async function assertUnitsWithinQuota(
  userId: string,
  cfg: AiGuardConfig,
  pass: AiGuardPass,
  units: number,
): Promise<NextResponse | null> {
  if (units <= pass.remaining) return null;
  await logAiRejection(userId, cfg.feature as "ocr" | "concierge", "quota_units");
  return NextResponse.json(
    {
      error: "quota_request_limit",
      message: cfg.messages.quotaUnits(pass.remaining),
      remaining: pass.remaining,
    },
    { status: 429 },
  );
}

export type AiFeatureUsage = {
  usedRequests: number;
  limitRequests: number;
  usedTokens: number;
  limitTokens: number;
  /** リセットの単位。アプリが「今月／本日」の文言を選ぶのに使う。 */
  period: QuotaPeriod;
  /**
   * 有料プランの件数上限。**購入画面が「月 100 件になります」と書くための値。**
   * アプリ側にこの数字を持たせると、env で上限を変えたときに購入画面だけが
   * 嘘をつく（端末集計を廃した ocr_quota.dart と同じ二重管理の再来で、
   * しかも今度は課金の約束になる）。サーバが正本を返す。
   */
  proLimitRequests: number;
};

/** 当期の使用量と（プラン別）上限を返す。残量表示用。 */
export async function getAiUsage(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
  plan: Plan,
): Promise<AiFeatureUsage> {
  const tier = cfg.tiers[plan];
  const key = quotaKey(cfg.quotaPeriod);
  const { data: usage } = await sb
    .from(cfg.tables.quota)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq(key.col, key.val)
    .maybeSingle();
  return {
    usedRequests: usage?.requests_count ?? 0,
    limitRequests: tier.quotaRequests,
    usedTokens: usage?.tokens_total ?? 0,
    limitTokens: tier.quotaTokens,
    period: cfg.quotaPeriod,
    proLimitRequests: cfg.tiers.pro.quotaRequests,
  };
}

/**
 * 次のリセット時刻（ISO）。クォータのキーと必ず同じ基準（JST）にする。
 * day → 次の JST 0:00 ／ month → 翌月 1 日の JST 0:00。
 */
export function nextResetIso(period: QuotaPeriod): string {
  // JST の壁時計を UTC メソッドで読むためにオフセットを足した時刻を作る。
  const jstNow = new Date(Date.now() + JST_OFFSET_MS);
  const next =
    period === "month"
      ? Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth() + 1, 1, 0, 0, 0)
      : Date.UTC(
          jstNow.getUTCFullYear(),
          jstNow.getUTCMonth(),
          jstNow.getUTCDate() + 1,
          0,
          0,
          0,
        );
  // 実時刻へ戻す（JST 0:00 = その UTC 表現から 9 時間前）。
  return new Date(next - JST_OFFSET_MS).toISOString();
}
