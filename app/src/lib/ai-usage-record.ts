/**
 * AI 利用量の記録（サーバー専有）。
 *
 * 以前はユーザーの JWT コンテキスト（authenticated ロール）で
 * increment_ocr_usage / increment_concierge_usage を呼んでいたが、これらは
 * PostgREST 経由でログイン済みの誰でも直接叩けた。月予算テーブルは
 * 全ユーザー共有のカウンタで、ai-guard は予算超過時に 503 を返すため、
 * 単一ユーザーが巨大な p_cost_cents を送るだけで全員の AI 機能を停止できた。
 *
 * 対策として、service_role でのみ実行できる *_srv 関数に切り替え、
 * ユーザーIDはサーバが検証済みの値を明示的に渡す。
 * 対応する SQL: supabase_migrations/019_ai_usage_server_only.sql
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

type Usage = {
  userId: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
};

/** OCR は 1 リクエストに複数ファイルを含められるので、件数を明示して渡す。 */
type OcrUsage = Usage & { units: number };

/**
 * 計上を試す回数（初回を含む）。
 *
 * 🔴 **1 回落ちただけで、その要求の原価を消さない**（2026-10-24・夜間検査 3-8）。
 *    以前は失敗を 1 行ログに出して握り潰すだけだった。呼び出し側
 *    （`/api/concierge`）は待ってから 200 を返すので、落ちた要求のトークンと原価は
 *    **その人のトークン上限にも月の予算にも二度と足されなかった。**
 *    落ちても例外は出ず、画面にも出ない（CLAUDE.md §6-1）。
 *
 * 回数を限るのは、コンシェルジュの「答えのあとに残す時間」
 * （`CONCIERGE_AFTER_MS` = 5 秒）の中で終えるため。待ちは 200ms → 400ms で、
 * `ai-guard.ts` の `settleOcrSuccess` と同じ間隔。
 *
 * ⚠️ この RPC は冪等ではない。**DB には届いたのに応答だけが失われた**場合、
 *    やり直しで二重に足される。多く数える側（＝上限が早く効く側）の誤りなので、
 *    黙って足し漏らす（＝上限が緩む）よりは安全側として受け入れている。
 */
const RECORD_ATTEMPTS = 3;
const RECORD_BACKOFF_MS = 200;

/**
 * 計上する。**通れば true、やり直しても通らなければ false。**
 *
 * 失敗してもリクエスト本体は成功させる（答えは既に出ていて、実費も発生している）。
 * その代わり最後まで落ちたら `[ai-usage] UNRECORDED` で残す ——
 * 後から人がログで拾い、手で突き合わせられるように、
 * 誰の（user id）・どの関数の・いくらの計上が落ちたかを載せる。
 * user id はアカウントの内部 ID で、メールや本文は載せない。
 */
async function record(
  rpc: string,
  u: Usage,
  extra: Record<string, number> = {},
): Promise<boolean> {
  const args = {
    p_user_id: u.userId,
    p_tokens_in: Math.max(0, Math.trunc(u.tokensIn)),
    p_tokens_out: Math.max(0, Math.trunc(u.tokensOut)),
    p_cost_cents: Math.max(0, Math.trunc(u.costCents)),
    ...extra,
  };
  let lastError = "";
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      const admin = createServiceClient();
      const { error } = await admin.rpc(rpc, args);
      if (!error) return true;
      lastError = error.message;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    console.warn(`[ai-usage] ${rpc} failed (attempt ${attempt}/${RECORD_ATTEMPTS}):`, lastError);
    if (attempt < RECORD_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RECORD_BACKOFF_MS * attempt));
    }
  }
  console.error(
    `[ai-usage] UNRECORDED ${rpc}`,
    JSON.stringify({
      userId: u.userId,
      tokensIn: args.p_tokens_in,
      tokensOut: args.p_tokens_out,
      costCents: args.p_cost_cents,
      ...extra,
      attempts: RECORD_ATTEMPTS,
      error: lastError,
    }),
  );
  return false;
}

/**
 * DB 関数 `increment_ocr_usage_srv` が 1 回で受ける件数の上限。
 *
 * 🔴 **021 の関数が `p_units` を 1..10 に縛り、外れると EXCEPTION を投げる。**
 * 記録は best-effort（`record` は失敗を返すだけで投げない）なので、
 * 外れたときに起きるのは失敗ではなく**計上が落ちること**。
 * 件数が増えないまま OCR は成功するので、**上限が事実上無制限になる。**
 * 画面にもログ（Vercel console 以外）にも出ない。
 *
 * 以前は `route.ts` の `MAX_IMAGES = 10` と**慣習でしか揃っていなかった**。
 * `MAX_IMAGES` だけを 20 に上げた瞬間、11 枚以上のバッチが全部この形になる。
 * いまは下の `recordOcrUsage` が**この値で分割して呼ぶ**ので、
 * `MAX_IMAGES` を動かしても計上は落ちない。
 *
 * 🔴 **この値を上げるときは SQL（関数の bound）が先。** 逆順にすると、
 * コードが 11 を渡して関数が弾く期間ができる（`CLAUDE.md` §6
 * 「OCR クォータキーの変更順序」と同じ罠）。
 */
const UNITS_PER_CALL_MAX = 10;

/**
 * ⚠️ p_units 付きの 5 引数シグネチャは 021 フェーズ1 で追加される。
 * **SQL 適用前にこのコードをデプロイすると記録が落ちる**（該当関数が無い）。
 * 上限判定は記録された値を読むので、記録が落ちれば上限も効かなくなる。
 * 適用順は必ず SQL(021 フェーズ1) → デプロイ。
 */
export async function recordOcrUsage(u: OcrUsage): Promise<boolean> {
  const total = Math.max(1, Math.trunc(u.units));
  let remaining = total;
  // トークン・費用は**総額を 1 回だけ**計上する（分割しても二重に積まない）。
  let carriesCost = true;
  // 1 つでも落ちたら false（分割した残りは続けて計上する）。
  let allOk = true;
  while (remaining > 0) {
    const units = Math.min(remaining, UNITS_PER_CALL_MAX);
    const ok = await record(
      "increment_ocr_usage_srv",
      carriesCost ? u : { ...u, tokensIn: 0, tokensOut: 0, costCents: 0 },
      { p_units: units },
    );
    allOk &&= ok;
    remaining -= units;
    carriesCost = false;
  }
  return allOk;
}

/**
 * 予約済みの OCR について、**トークン・コストだけ**を記録する。
 *
 * 🔴 `recordOcrUsage` と併用しないこと。あちらは件数も足すので、
 * `reserveOcrUnits` で数え済みの分が**二重に計上**される。
 *
 * 予約方式では件数が先に確定しているので、分割呼び出しも要らない
 * （DB 側は p_units を 1..10 で bound するため、日次の計上だけ分割する）。
 */
export async function recordOcrTokensOnly(u: OcrUsage): Promise<boolean> {
  const total = Math.max(1, Math.trunc(u.units));
  let remaining = total;
  let carriesCost = true;
  let allOk = true;
  while (remaining > 0) {
    const units = Math.min(remaining, UNITS_PER_CALL_MAX);
    const ok = await record(
      "toritavi_record_ocr_tokens_srv",
      carriesCost ? u : { ...u, tokensIn: 0, tokensOut: 0, costCents: 0 },
      { p_units: units },
    );
    allOk &&= ok;
    remaining -= units;
    carriesCost = false;
  }
  return allOk;
}

/** コンシェルジュの計上。**通れば true**（落ちても投げない・`record` 参照）。 */
export const recordConciergeUsage = (u: Usage): Promise<boolean> =>
  record("increment_concierge_usage_srv", u);
