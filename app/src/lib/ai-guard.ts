import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiRejection } from "@/lib/moderation";
import { createServiceClient } from "@/lib/supabase-service";
import { getAiMode, MODE_MESSAGE } from "@/lib/ai-switch";

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
  /**
   * 🔴 **上限は `Plan` ではなく `Audience` で引く。**
   *
   * 2026-08-30 まで `{ free, pro }` だった。ゲストは `Audience` にしか
   * 存在せず件数の軸に無かったので、**匿名ログインを開けた瞬間に
   * ゲストが無料会員と同じ 5 件を使える**状態だった
   * （`toritavi_app/docs/guest-mode-spec.md` §2-1）。
   *
   * `Record` にして**3 つとも書かせる**。省略可にすると、足し忘れが
   * 「静かに free と同じ」に化ける —— それが元の欠陥そのもの。
   */
  tiers: Record<Audience, TierLimits>;
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
  /** ゲストにだけ差し替える文言。無ければ `messages` をそのまま使う。 */
  guestMessages?: Partial<AiGuardConfig["messages"]>;
  /** Pro にだけ差し替える文言。無ければ `messages` をそのまま使う。 */
  proMessages?: Partial<AiGuardConfig["messages"]>;
};

/**
 * 確定仕様の件数を**超えないように**上限を決める。
 *
 * 🔴 **env で増やせてはいけない。** ログに出すだけでは、打ち間違いが
 * そのまま「違う商品を売る」ことになる（掲載文は 5 件・50 件と書く）。
 * 減らす方向は事故対応に要るので許す。
 */
function cappedQuota(names: string[], spec: number): number {
  const raw = envNum(names, spec);
  if (raw > spec) {
    console.error(
      `[ai-guard] env が確定仕様を超えている（${raw} > ${spec}）。仕様値へ丸めた`,
    );
    return spec;
  }
  return Math.max(0, raw);
}

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

/** JST の今日（YYYY-MM-DD）。日次のキーと、OCR プロンプトの「今日」。 */
export function jstToday(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の今月 1 日（YYYY-MM-01）。月次のキー。 */
function jstFirstOfMonth(): string {
  return `${jstToday().slice(0, 7)}-01`;
}

/**
 * 期間キーを決められなかった。**free に倒さず、ここで止める。**
 * 呼び出し側は 503 を返すこと（`plan_unavailable` と同じ扱い）。
 */
export class QuotaPeriodUnavailableError extends Error {
  constructor() {
    super("quota period unavailable");
    this.name = "QuotaPeriodUnavailableError";
  }
}

/**
 * quotaPeriod に対応するキー列名と値。
 *
 * 🔴 **月次のキーは自分で計算しない。SQL の `ocr_period_start()` に聞く。**
 *
 * ここが今回の本題。**書く側（`increment_ocr_usage_srv`）と読む側（ここ）が
 * 別々に同じキーを計算していた**ことが、過去 2 回の事故の原因だった:
 *
 *   - `019` の関数に `013` の JST 修正が入っておらず、
 *     **上限が毎日 9 時間まったく効いていなかった**（2 か月気づかず）
 *
 * 契約日起点（2026-08-30）にすると計算はさらに複雑になり、二重実装のままでは
 * また必ずずれる。**片方を消す**のが唯一の確実な手。往復が 1 回増えるが、
 * 「上限が静かに無効になる」より安い。
 *
 * 🔴 **取れなかったら投げる。** ここで暦月に落とすと、落ちた瞬間だけ
 * 別のバケツを見て**上限が実質リセットされる**（`CLAUDE.md` §5 フェイルクローズ）。
 *
 * 日次（コンシェルジュ）は書く側も `v_now_jst::DATE` の単純な値なので、
 * 従来どおり TS で計算する。**複雑さのある方だけを寄せている。**
 */
async function quotaKey(
  sb: SupabaseClient,
  userId: string,
  period: QuotaPeriod,
): Promise<{ col: string; val: string }> {
  if (period !== "month") return { col: "day", val: jstToday() };
  const { data, error } = await sb.rpc("ocr_period_start", { p_user_id: userId });
  if (error || typeof data !== "string") {
    console.error("[ai-guard] ocr_period_start failed:", error);
    throw new QuotaPeriodUnavailableError();
  }
  return { col: "month", val: data };
}

export {
  SPEC_FREE_REQUESTS,
  SPEC_GUEST_REQUESTS,
  SPEC_PRO_REQUESTS,
} from "./ocr-plan-spec.ts";
import {
  SPEC_FREE_REQUESTS,
  SPEC_GUEST_REQUESTS,
  SPEC_PRO_REQUESTS,
} from "./ocr-plan-spec.ts";

/**
 * 実際に効いている上限が確定仕様と違っていないかを見る。
 *
 * 🔴 **黙って違う商品を売らない。** env の設定漏れ・打ち間違いは
 * コードに痕跡が残らない（`docs/feature-flags.md` の RevenueCat 鍵と同型）。
 * 違っていたら理由を返す。呼び出し側がログに残す。
 */
export function quotaSpecMismatch(): string | null {
  // 🔴 **guest も見る。** 2026-08-30 まで free と pro しか比べておらず、
  //    `SPEC_GUEST_REQUESTS` は**本番コードから 1 度も読まれていなかった**。
  //    仕様に 3 と書いてあるのに実装が 5 でも、落ちも警告も出なかった。
  //    **見張りに足し忘れると、同じ沈黙をもう一度作る。**
  const g = OCR_GUARD.tiers.guest.quotaRequests;
  const f = OCR_GUARD.tiers.free.quotaRequests;
  const p = OCR_GUARD.tiers.pro.quotaRequests;
  if (
    g === SPEC_GUEST_REQUESTS &&
    f === SPEC_FREE_REQUESTS &&
    p === SPEC_PRO_REQUESTS
  ) {
    return null;
  }
  return (
    `guest=${g}(spec ${SPEC_GUEST_REQUESTS}) ` +
    `free=${f}(spec ${SPEC_FREE_REQUESTS}) ` +
    `pro=${p}(spec ${SPEC_PRO_REQUESTS})`
  );
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
      // 🔴 既定値は**確定仕様と同じ数字**にする（2026-08-22: Free 5 / Pro 50）。
      //    既定が仕様と違うと、env の設定漏れが「静かに違う商品」になる。
      //    `assertQuotaMatchesSpec()` が食い違いを検知する。
      quotaRequests: cappedQuota(["AI_OCR_MONTHLY_REQUESTS"], SPEC_FREE_REQUESTS),
      quotaTokens: envNum(["AI_OCR_MONTHLY_TOKENS"], 500_000),
      ratePerMin: envNum(["AI_OCR_RATE_PER_MIN", "OCR_RATE_LIMIT_PER_MIN"], 5),
    },
    pro: {
      quotaRequests: cappedQuota(["AI_OCR_PRO_MONTHLY_REQUESTS"], SPEC_PRO_REQUESTS),
      quotaTokens: envNum(["AI_OCR_PRO_MONTHLY_TOKENS"], 3_000_000),
      ratePerMin: envNum(["AI_OCR_PRO_RATE_PER_MIN"], 10),
    },
    // 🔴 **ゲスト（未登録）。件数は「生涯 3 件」で、月ごとには戻らない。**
    //    戻らないのはここではなく DB が決める —— `ocr_period_start()` が
    //    匿名利用者に固定の番兵日付を返すので、集計のキーが動かない
    //    （`supabase_migrations/027_ocr_period_guest.sql`）。
    //    **この 2 つは対。片方だけ入れても「3 件 / 月」になる。**
    guest: {
      quotaRequests: cappedQuota(["AI_OCR_GUEST_REQUESTS"], SPEC_GUEST_REQUESTS),
      quotaTokens: envNum(["AI_OCR_GUEST_TOKENS"], 300_000),
      // 会員より厳しくする。ゲストは 1 台 3 件しか無いので、
      // まとめ撮りの必要が薄い一方、攻撃の入口になりやすい。
      ratePerMin: envNum(["AI_OCR_GUEST_RATE_PER_MIN"], 3),
    },
  },
  tables: {
    budget: "toritavi_ocr_budget",
    quota: "toritavi_ocr_usage_monthly",
    events: "toritavi_ocr_events",
  },
  quotaPeriod: "month",
  messages: {
    // 503（月予算）。**「あなたの枠を使い切った」と読ませない。**
    // 主語を省いた「今月の想定利用量を超えたため」は自分の使用量に読め、
    // 残っているのに諦める人が出る。これはサービス全体を止めている状態で、
    // 個人のクォータ（429）とは原因も復旧手段も違う
    // （docs/monetization-spec.md §2「429 と 503 を同一文言にまとめない」）。
    budgetExceeded:
      "現在混み合っています（JUNROS 全体で画像解析を一時停止中です）。" +
      "あなたの読み取り可能数は減っていません。翌月 1 日に再開します。",
    quotaRequest:
      "今月の読み取り上限に達しました。翌月 1 日にリセットされます。",
    quotaToken: "今月の使用量が上限に達しました。翌月 1 日にリセットされます。",
    quotaUnits: (n) =>
      `今月の残りは ${n} 件です。選択した枚数を減らしてお試しください。`,
    rateLimit: (n) =>
      `少しお待ちください。短時間に解析が多すぎます（1 分あたり ${n} 回まで）。`,
  },
  // 🔴 **ゲストに「今月」「翌月 1 日」と言わない。** お試し枠にリセットは
  //    無く、待てば戻ると読ませてしまう（2026-08-31 に実機で発覚）。
  //    アプリ側の文言は直したが、**画面はサーバの `message` を優先する**
  //    ので、ここを直さないと出るのは会員向けの文言のままだった。
  // 🔴 **Pro に「今月」「翌月 1 日」と言わない。** 契約応当日が入ると
  //    リセットは月初ではない（`ocr_period_start` / `ocr_period_next`）。
  //    日付を書かずに「次の更新日」と言う —— 実際の日付は
  //    `/api/ai-usage` の `resetAt` が返し、画面がそれを出す。
  //    外部レビュー（2026-08-31）P1 の指摘。
  proMessages: {
    quotaRequest:
      "ご契約期間の読み取り上限に達しました。次の更新日にリセットされます。",
    quotaToken:
      "ご契約期間の使用量が上限に達しました。次の更新日にリセットされます。",
    quotaUnits: (n) =>
      `ご契約期間の残りは ${n} 件です。選択した枚数を減らしてお試しください。`,
  },
  guestMessages: {
    quotaRequest:
      "お試しの読み取り上限に達しました。ご登録いただくと続けてご利用いただけます。",
    quotaToken:
      "お試しの使用量が上限に達しました。ご登録いただくと続けてご利用いただけます。",
    quotaUnits: (n) =>
      `お試しの残りは ${n} 件です。選択した枚数を減らしてお試しください。`,
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
    // 🔴 **ゲストはコンシェルジュを使えない。すべて 0。**
    //
    //    ゲストの枠は「読み取りを 3 件試せる」ためのもので、チャットは
    //    含まない。0 にしておけば、仮にどこかで呼ばれても**通らない**。
    //
    //    **env で開けられるようにしない**（`envNum` を使わない）。
    //    設定 1 つでゲストにチャットが開くのは、意図しない開放になる。
    //    開けると決めた日に、ここを書き換えること。
    guest: { quotaRequests: 0, quotaTokens: 0, ratePerMin: 0 },
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

// `resolvePlan` と `PlanUnavailableError` は `plan-resolve.ts` へ移した。
// **`ai-guard.ts` は `next/server` を読むので、素の node テストから
// import できない。** 純粋なロジックは別ファイルに置くと検査できる
// （`ocr-limits` / `file-validate` / `revenuecat-signature` と同じ形）。
import { resolvePlan, PlanUnavailableError } from "./plan-resolve";
export { resolvePlan, PlanUnavailableError };

/** ガードを通過したときの情報。呼び出し側が枚数チェックに使う。 */
export type AiGuardPass = {
  plan: Plan;
  /**
   * この pass が誰に対して出たか。**文言の出し分けに使う。**
   *
   * 🔴 引数で回さずここに持たせる。`reserveOcrUnits` / `assertUnitsWithinQuota`
   *    へ足すと、呼び出し側が増えたときに渡し忘れて**会員向けの文言が
   *    ゲストに出る**（`CLAUDE.md` §6-1 の 3「同じ経路を通る呼び出しを数える」）。
   */
  audience: Audience;
  /** この期間に残っている件数（OCR はファイル数）。 */
  remaining: number;
  /** この期間の上限件数。**原子的な予約（reserveOcrUnits）に要る。** */
  limitRequests: number;
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
  // 🔴 **匿名かどうかを呼び出し側から渡す。**
  //    内部の `resolvePlan` は行の無い匿名利用者に `free` を返すので、
  //    これを受け取らないと**ゲストが無料会員の枠でコンシェルジュを使える**。
  //    既定 `false` にしてあるのは既存の呼び出しを壊さないためだが、
  //    **新しい呼び出しでは必ず渡すこと**（省略は「会員として扱う」の意味）。
  isAnonymous = false,
): Promise<NextResponse | AiGuardPass> {
  const plan = await resolvePlan(sb, userId);
  const audience = audienceOf(plan, isAnonymous);
  const tier = cfg.tiers[audience];

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
  const key = await quotaKey(sb, userId, cfg.quotaPeriod);
  const { data: usage } = await sb
    .from(cfg.tables.quota)
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq(key.col, key.val)
    .maybeSingle();
  const used = usage?.requests_count ?? 0;
  if (usage) {
    if (used >= tier.quotaRequests) {
      return reject("quota_request_limit", msgsFor(cfg, audience).quotaRequest, 429);
    }
    if (usage.tokens_total >= tier.quotaTokens) {
      return reject("quota_token_limit", msgsFor(cfg, audience).quotaToken, 429);
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

  return {
    plan,
    audience,
    remaining: Math.max(0, tier.quotaRequests - used),
    limitRequests: tier.quotaRequests,
  };
}

/**
 * ボディを読んだあとの件数チェック。
 *
 * /api/ocr は 1 リクエストで複数ファイルを受け付けるので、「残り 1 件」の状態で
 * 10 枚送られると上限を 10 倍すり抜ける。enforceAiLimits はボディを読む前に
 * 走るため件数を知らない。ここで塞ぐ。
 */
/**
 * OCR の件数を**原子的に予約**する。
 *
 * 🔴 **`assertUnitsWithinQuota` は並列要求で抜けられる**（2026-08-16 の外部検査）。
 * 「読んでから足す」形なので、無料利用者（月 10 件）が使用量 0 の状態で
 * 10 枚入りの要求を 2 本同時に投げると、**両方が「残り 10 件」と判定して通過**し
 * 20 枚が処理される。10 本なら 100 枚。実費は Anthropic に発生する。
 *
 * ここでは DB 側で `INSERT ... ON CONFLICT DO UPDATE ... WHERE` を使い、
 * 行ロックの下で条件を評価する。同時に来た要求は直列化され、上限に当たった側は
 * 更新されない（`supabase/ocr_quota_atomic_reserve.sql`）。
 *
 * **予約してから AI を呼ぶ**ので、AI が落ちた分は `release()` で戻すこと。
 * 戻し損ねても、失うのは利用者の枠が少し減ることだけで、
 * **上限が緩む方向には壊れない**（フェイルクローズ・`CLAUDE.md` §5）。
 *
 * ⚠️ 予約は件数だけを数える。成功後のトークン・コストは
 * `recordOcrTokensOnly` で記録する（`recordOcrUsage` を併用すると**二重計上**）。
 */
export async function reserveOcrUnits(
  userId: string,
  cfg: AiGuardConfig,
  pass: AiGuardPass,
  units: number,
): Promise<NextResponse | { release: () => Promise<void> }> {
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("toritavi_reserve_ocr_units", {
    p_user_id: userId,
    p_units: units,
    p_limit: pass.limitRequests,
  });

  if (error) {
    // 🔴 **予約できないときは通さない。** ここをフェイルオープンにすると、
    //    DB が不調な間だけ上限が消える（019 の事故と同じ形）。
    console.error("[ai-guard] reserve failed:", error.message);
    return NextResponse.json(
      { error: "quota_unavailable", message: cfg.messages.rateLimit(0) },
      { status: 503 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const granted = row?.granted === true;
  if (!granted) {
    const usedAfter = Number(row?.used_after ?? pass.limitRequests);
    const remaining = Math.max(0, pass.limitRequests - usedAfter);
    await logAiRejection(userId, cfg.feature as "ocr" | "concierge", "quota_units");
    return NextResponse.json(
      {
        error: "quota_request_limit",
        message: msgsFor(cfg, pass.audience).quotaUnits(remaining),
        remaining,
      },
      { status: 429 },
    );
  }

  return {
    release: async () => {
      try {
        const { error: relErr } = await admin.rpc("toritavi_release_ocr_units", {
          p_user_id: userId,
          p_units: units,
        });
        if (relErr) console.error("[ai-guard] release failed:", relErr.message);
      } catch (e) {
        console.error("[ai-guard] release threw:", e);
      }
    },
  };
}

/**
 * @deprecated 並列要求で抜けられる。`reserveOcrUnits` を使うこと。
 * コンシェルジュ側にまだ原子的な予約が無いため残してある。
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
      message: msgsFor(cfg, pass.audience).quotaUnits(pass.remaining),
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
  // 🔴 **`Audience`。** 残数バッジはゲストにも出る。plan で引くと
  //    ゲストの画面に「0 / 5」と出て、実際は 3 件で止まる —— **画面が嘘をつく**。
  audience: Audience,
): Promise<AiFeatureUsage> {
  const tier = cfg.tiers[audience];
  const key = await quotaKey(sb, userId, cfg.quotaPeriod);
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

// ===========================================================================
// Phase 1（2026-08-22）— 原子的な予約・精算と冪等性
//
// 🔴 上の `enforceAiLimits` / `reserveOcrUnits` は**コンシェルジュが使い続ける**
//    ので残す。OCR はこちらへ移した。混在させないこと。
// ===========================================================================

/** 予算を分ける単位。**ゲスト攻撃で会員が止まらないようにするための軸。** */
export type Audience = "guest" | "free" | "pro";

/**
 * 匿名（ゲスト）かどうかは JWT の `is_anonymous` を正本にする。
 * Phase 3 で匿名認証を開けるまでは常に false。
 */
/**
 * その相手に出す文言。**ゲストは `guestMessages` で上書きする。**
 *
 * 🔴 ここを通さずに `cfg.messages.…` を直接読むと、ゲストに
 *    「今月」「翌月 1 日」と出る。**リセットが無いので嘘になる。**
 */
export function msgsFor(cfg: AiGuardConfig, audience: Audience) {
  if (audience === "guest" && cfg.guestMessages) {
    return { ...cfg.messages, ...cfg.guestMessages };
  }
  if (audience === "pro" && cfg.proMessages) {
    return { ...cfg.messages, ...cfg.proMessages };
  }
  return cfg.messages;
}

export function audienceOf(plan: Plan, isAnonymous: boolean): Audience {
  if (isAnonymous) return "guest";
  return plan;
}

/**
 * 分間バースト。**`toritavi_ocr_events` を読む。**
 *
 * 🔴 この表に書く経路は 2026-08-16〜08-22 のあいだ存在しなかった
 *    （記録用 RPC を差し替えたときに INSERT が移らなかった）。
 *    書き戻しは `toritavi_ocr_begin_request` の中にある。
 *    **読む側だけを直しても意味が無い。**
 */
export async function checkMinuteRate(
  sb: SupabaseClient,
  userId: string,
  cfg: AiGuardConfig,
  // 🔴 **`Plan` ではなく `Audience`。** ゲストの分間上限を効かせるため。
  //    `Plan` は `Audience` の部分型なので、既存の呼び出しはそのまま通る。
  audience: Audience,
): Promise<NextResponse | null> {
  const perMin = cfg.tiers[audience].ratePerMin;
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await sb
    .from(cfg.tables.events)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) {
    // 読めないときは通す。**件数と予算は別の層で原子的に守られている**ので、
    // ここでフェイルクローズにすると RLS の綻び 1 つで全停止になる。
    console.error("[ai-guard] minute rate read failed:", error.message);
    return null;
  }
  if ((count ?? 0) >= perMin) {
    await logAiRejection(userId, cfg.feature as "ocr" | "concierge", "rate_limit");
    return NextResponse.json(
      { error: "rate_limit", message: cfg.messages.rateLimit(perMin) },
      { status: 429 },
    );
  }
  return null;
}

/**
 * 全利用者合算の 1 分あたり試行上限。
 *
 * 試行 1 回につき `count_tokens` を 1 回呼ぶので、アカウントを増やされると
 * 組織全体のレート上限を枯渇させ、**正規の利用者まで OCR が使えなくなる**。
 * 金銭ではなく可用性の防御なので、予算では止められない。
 */
export const GLOBAL_ATTEMPTS_PER_MIN = envNum(["AI_OCR_GLOBAL_RATE_PER_MIN"], 120);

/**
 * **Pro のために空けておく枠**（全体上限のうち何件を予約するか）。
 *
 * 🔴 **共有バケットは受け手を区別しない**（2026-09-04 の外部監査・P1）。
 * 上の注記が言うとおり、アカウントを増やされると全体上限が枯渇する。
 * そのとき**払っている人まで 429 になる。**
 *
 * 予算（`toritavi_ai_budget_limits`）は受け手ごとに分かれているので
 * 「ゲストが使い切っても Pro は止まらない」は**金銭には真だが、
 * 可用性には偽**だった。
 *
 * ここを空けると、全体が 90 を超えた時点で **free / guest は断られ、
 * pro だけが 120 まで通る。** 攻撃側は無料アカウントをいくら増やしても
 * 90 で頭打ちになり、**Pro の 30 件には手が届かない。**
 *
 * 🔴 **DDL は要らない。** DB 側は `hits + 1 <= p_global_per_min` を見るだけで、
 * 上限は呼び出しごとに渡している。**渡す数を変えるだけで予約になる。**
 */
export const GLOBAL_RESERVED_FOR_PRO = envNum(
  ["AI_OCR_GLOBAL_RESERVE_PRO"],
  30,
);

/**
 * この受け手が使ってよい**全体**の上限。
 *
 * pro は全体をそのまま使える。それ以外は予約分を引いた残りまで。
 * **1 を下回らせない**（0 だと誰も通らなくなる）。
 */
export function globalCapFor(audience: Audience): number {
  if (audience === "pro") return GLOBAL_ATTEMPTS_PER_MIN;
  return Math.max(1, GLOBAL_ATTEMPTS_PER_MIN - GLOBAL_RESERVED_FOR_PRO);
}

/**
 * 安価な試行制限。**ファイルを開く前に呼ぶ。**
 *
 * 🔴 以前は「件数を読む → 別のトランザクションで書く」形だったので、
 *    (a) 同時要求が同じ数を読んで全部通り、
 *    (b) **PDF の解析より後**にあったので解析 DoS を止められなかった。
 *    DB 側で advisory lock を取って数えて書く形に変え、呼ぶ位置を前へ出した。
 */
export async function tryOcrAttempt(
  userId: string,
  audience: Audience,
): Promise<NextResponse | null> {
  const perMin = OCR_GUARD.tiers[audience].ratePerMin;
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("toritavi_ocr_try_attempt", {
      p_user_id: userId,
      p_per_min: perMin,
      // 🔴 **必ず明示的に渡す。** DB 側の既定値は外してあるので、
      //    書き忘れるとエラーになる（黙って「全体上限なし」にならない）。
      //
      // 🔴 **受け手で変える**（2026-09-04）。pro には予約枠を残す ——
      //    そうしないと、無料アカウントを増やされたときに
      //    **払っている人まで 429 になる。**
      p_global_per_min: globalCapFor(audience),
    });
    if (error) throw error;
    if (data === true) return null;
    await logAiRejection(userId, "ocr", "rate_limit");
    return NextResponse.json(
      { error: "rate_limit", message: OCR_GUARD.messages.rateLimit(perMin) },
      { status: 429 },
    );
  } catch (e) {
    // 🔴 **数えられないなら通さない。** ここはファイルを開く前の最も安い門で、
    //    通してしまうと解析 DoS がそのまま抜ける。件数・予算より手前なので
    //    フェイルクローズにしても失うものが小さい。
    console.error("[ai-guard] attempt limiter failed; blocking:", e);
    return NextResponse.json(
      { error: "rate_limit_unavailable", message: "混み合っています。しばらくしてからお試しください。" },
      { status: 503 },
    );
  }
}

export type BeginOk = {
  kind: "granted";
  usedAfter: number;
};
export type BeginDuplicate = {
  kind: "duplicate";
  /** 期限内なら前回の結果。期限切れ・実行中なら null。 */
  cached: unknown | null;
  inFlight: boolean;
};

/**
 * OCR 1 リクエストの開始。**冪等性・件数・予算・分間イベントを 1 回で確保する。**
 *
 * 途中で失敗した半端な状態（件数だけ取れて予算は取れていない等）は
 * DB 関数側が 1 トランザクションで面倒を見る。
 */
export async function beginOcrRequest(args: {
  requestId: string;
  userId: string;
  audience: Audience;
  units: number;
  limitUnits: number;
  estCostCents: number;
  /** 予約に使う値（計測 × 安全余裕 ＋ 固定分 ＋ 出力上限）。 */
  estTokens: number;
  limitTokens: number;
  /** count_tokens が返した生の値。**判定に使わず、記録だけ。** */
  countedInput: number;
  /** 安全余裕を掛けた入力トークン（出力ぶんを含まない）。記録だけ。 */
  reservedInput: number;
}): Promise<NextResponse | BeginOk | BeginDuplicate> {
  const admin = createServiceClient();
  const { data, error } = await admin.rpc("toritavi_ocr_begin_request", {
    p_request_id: args.requestId,
    p_user_id: args.userId,
    p_audience: args.audience,
    p_units: args.units,
    p_limit_units: args.limitUnits,
    p_est_cost_cents: args.estCostCents,
    p_est_tokens: args.estTokens,
    p_limit_tokens: args.limitTokens,
    // 見積りと実費のずれを後から測るための記録（判定には使わない）。
    p_counted_input: args.countedInput,
    p_reserved_input: args.reservedInput,
  });

  if (error) {
    // 🔴 **通さない。** ここをフェイルオープンにすると、DB が不調な間だけ
    //    上限も予算も消える（019 の事故と同じ形）。
    console.error("[ai-guard] begin failed:", error.message);
    return NextResponse.json(
      { error: "quota_unavailable", message: "混み合っています。しばらくしてからお試しください。" },
      { status: 503 },
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status?: string; used_after?: number; cached?: unknown }
    | undefined;
  const status = row?.status;

  if (status === "granted") {
    return { kind: "granted", usedAfter: Number(row?.used_after ?? 0) };
  }
  if (status === "duplicate_done") {
    return { kind: "duplicate", cached: row?.cached ?? null, inFlight: false };
  }
  if (status === "duplicate_in_flight") {
    return { kind: "duplicate", cached: null, inFlight: true };
  }
  if (status === "quota_exceeded") {
    const used = Number(row?.used_after ?? args.limitUnits);
    const remaining = Math.max(0, args.limitUnits - used);
    await logAiRejection(args.userId, "ocr", "quota_units");
    return NextResponse.json(
      {
        error: "quota_request_limit",
        message: msgsFor(OCR_GUARD, args.audience).quotaUnits(remaining),
        remaining,
      },
      { status: 429 },
    );
  }
  // 🔴 **DB 側の非常停止スイッチ**（`toritavi_ai_mode_blocks`）。
  //
  // route.ts も送信前に `getAiMode()` を見ているので、通常はここまで来ない。
  // 来るのは **サーバの判定をすり抜けた場合** —— 15 秒キャッシュの隙、
  // あるいはコードの側が壊れているとき。**そのための二重化**なので、
  // ここで握り潰さない（`CLAUDE.md` §5「安全装置は静かに嘘をつかせない」）。
  //
  // 🔴 **理由は必ず「停止」で返す。** 上限（429）の文言に寄せると、
  //    残っているのに使い切ったと読めて利用者は諦める（JR000108 で
  //    アプリ側の同じ間違いを直したばかり）。
  if (status === "ai_disabled") {
    const mode = await getAiMode("ocr");
    // キャッシュが古くて 'on' に見えることがある。DB は止めているので、
    // **迷ったら「停止」と言う。**「不明」を返さない。
    const message = mode === "on" ? MODE_MESSAGE.off : MODE_MESSAGE[mode];
    await logAiRejection(args.userId, "ocr", "ai_disabled");
    return NextResponse.json({ error: "ai_disabled", message }, { status: 503 });
  }
  if (status === "budget_exceeded") {
    await logAiRejection(args.userId, "ocr", "budget_exceeded");
    return NextResponse.json(
      { error: "monthly_budget_exceeded", message: OCR_GUARD.messages.budgetExceeded },
      { status: 503 },
    );
  }
  console.error("[ai-guard] begin returned unknown status:", status);
  return NextResponse.json({ error: "quota_unavailable" }, { status: 503 });
}

/** 成功の精算（実費で確定し、結果を短期だけ保持する）。 */
/**
 * 成功の精算。**永続化できたかを返す。**
 *
 * 🔴 **握り潰さない。** 以前はエラーも `false` も無視して呼び出し側が 200 を
 * 返していた。精算されていないということは、予算が reserved のまま・
 * 実費が計上されないまま・結果も保存されないまま、ということ。
 * その状態で成功を返すと、再送は `duplicate_in_flight` で止まり、
 * **利用者は枠を握られたまま結果も受け取れない**。
 *
 * 一時的な失敗は起きるので 3 回まで試す。それでも駄目なら false。
 */
export async function settleOcrSuccess(args: {
  requestId: string;
  userId: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  result: unknown;
}): Promise<boolean> {
  const admin = createServiceClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data, error } = await admin.rpc("toritavi_ocr_settle_success", {
        p_request_id: args.requestId,
        p_user_id: args.userId,
        p_tokens_in: args.tokensIn,
        p_tokens_out: args.tokensOut,
        p_cost_cents: args.costCents,
        p_result: args.result,
      });
      if (error) throw error;
      if (data === true) return true;
      // 🔴 **false を成功扱いしない**（2026-08-22 の外部レビュー指摘 3）。
      //    false は「reserved の行が無かった」であって、succeeded とは限らない。
      //    failed に落ちている（sweep が拾った等）なら、実費が計上されず
      //    結果も保存されていない。**状態を見て判断する。**
      if (data === false) {
        const state = await readOcrRequestState(args.requestId, args.userId);
        if (state === "succeeded") return true; // 既に精算済み＝冪等な成功
        console.error("[ai-guard] settle returned false; state =", state);
        return false;
      }
      throw new Error("unexpected settle result");
    } catch (e) {
      console.error(`[ai-guard] settle success failed (attempt ${attempt + 1}):`, e);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return false;
}

/** リクエストの現在の状態。**service_role は RLS を通らないので直接読める。** */
export async function readOcrRequestState(
  requestId: string,
  userId: string,
): Promise<string | null> {
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from("toritavi_ocr_requests")
      .select("state")
      .eq("request_id", requestId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.state as string | undefined) ?? null;
  } catch (e) {
    console.error("[ai-guard] read request state failed:", e);
    return null;
  }
}

/**
 * 失敗の精算（件数と予算を戻す）。
 *
 * 🔴 **予約後に失敗するすべての経路から呼ぶ。** 呼び忘れた分は
 *    `toritavi_ocr_sweep` が 15 分後に拾うが、それは保険であって手当てではない。
 */
export async function settleOcrFailure(args: {
  requestId: string;
  userId: string;
  reason: string;
  /**
   * 🔴 **Anthropic へ送ったあとに失敗したか。**
   *
   * 送信後の失敗（タイムアウト・切断）は、**向こうでは完走して課金されて
   * いる可能性がある**。予算まで戻すと「予算にも件数にも計上されない支出」を
   * 無制限に作れる（意図的にタイムアウトさせれば繰り返せる）。
   *
   * true のとき: 件数は戻す（利用者への約束）／**予算は見積りを spent へ移す**。
   */
  chargeBudget?: boolean;
}): Promise<void> {
  try {
    const admin = createServiceClient();
    const { error } = await admin.rpc("toritavi_ocr_settle_failure", {
      p_request_id: args.requestId,
      p_user_id: args.userId,
      p_reason: args.reason,
      p_charge_budget: args.chargeBudget === true,
    });
    if (error) console.error("[ai-guard] settle failure failed:", error.message);
  } catch (e) {
    console.error("[ai-guard] settle failure threw:", e);
  }
}
