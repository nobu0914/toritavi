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

/** 記録は best-effort。失敗してもリクエスト本体は成功させる（従来どおり）。 */
async function record(
  rpc: string,
  u: Usage,
  extra: Record<string, number> = {},
): Promise<void> {
  try {
    const admin = createServiceClient();
    const { error } = await admin.rpc(rpc, {
      p_user_id: u.userId,
      p_tokens_in: Math.max(0, Math.trunc(u.tokensIn)),
      p_tokens_out: Math.max(0, Math.trunc(u.tokensOut)),
      p_cost_cents: Math.max(0, Math.trunc(u.costCents)),
      ...extra,
    });
    if (error) console.error(`[ai-usage] ${rpc} failed:`, error.message);
  } catch (e) {
    console.error(`[ai-usage] ${rpc} threw:`, e);
  }
}

/**
 * ⚠️ p_units 付きの 5 引数シグネチャは 021 フェーズ1 で追加される。
 * **SQL 適用前にこのコードをデプロイすると記録が落ちる**（該当関数が無い）。
 * 上限判定は記録された値を読むので、記録が落ちれば上限も効かなくなる。
 * 適用順は必ず SQL(021 フェーズ1) → デプロイ。
 */
export const recordOcrUsage = (u: OcrUsage) =>
  record("increment_ocr_usage_srv", u, {
    p_units: Math.max(1, Math.trunc(u.units)),
  });

export const recordConciergeUsage = (u: Usage) =>
  record("increment_concierge_usage_srv", u);
