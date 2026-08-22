/**
 * AI 機能の非常停止スイッチ。
 *
 * 🔴 **env に置かない。** env の変更は再デプロイを伴い、事故の最中に
 * ビルドを待つことになる。DB なら 1 行の UPDATE で止まる。
 *
 *   on        … 通常
 *   guest_off … ゲストだけ止める（会員は使える）
 *   off       … AI 読み取りを全部止める（**手入力・閲覧は動く**）
 *
 * env `OCR_MODE` は**より厳しい側にだけ**効く上書き。DB が読めないときの
 * 保険と、DB を触れない状況での最終手段を兼ねる。
 */
import { createServiceClient } from "@/lib/supabase-service";
import { isAiMode, stricter, type AiMode } from "./ai-switch-rules.ts";

export { modeAllows, MODE_MESSAGE, type AiMode } from "./ai-switch-rules.ts";

/** 事故の最中に「まだ止まらない」時間を短く保つ。 */
const CACHE_MS = 15_000;

const cache = new Map<string, { mode: AiMode; at: number }>();

function envMode(): AiMode | null {
  const v = (process.env.OCR_MODE ?? "").trim();
  return isAiMode(v) ? v : null;
}

export async function getAiMode(feature = "ocr"): Promise<AiMode> {
  const now = Date.now();
  const hit = cache.get(feature);
  let dbMode: AiMode = "on";
  let resolved = false;
  if (hit && now - hit.at < CACHE_MS) {
    dbMode = hit.mode;
    resolved = true;
  }

  if (!resolved) {
    try {
      const admin = createServiceClient();
      const { data, error } = await admin
        .from("toritavi_ai_switches")
        .select("mode")
        .eq("feature", feature)
        .maybeSingle();
      if (error) throw error;
      const m = data?.mode;
      dbMode = isAiMode(m) ? m : "on";
      cache.set(feature, { mode: dbMode, at: now });
    } catch (e) {
      // 🔴 **DB が読めないだけでサービスを止めない。** 止めるべき事故なら
      //    env 側で止められる。ここでフェイルクローズにすると、
      //    Supabase の一時障害が「読み取り機能の全停止」に化ける。
      console.error("[ai-switch] read failed; falling back to env/on:", e);
      dbMode = hit?.mode ?? "on";
    }
  }

  const env = envMode();
  return env ? stricter(dbMode, env) : dbMode;
}
