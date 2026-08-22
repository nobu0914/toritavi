import Anthropic from "@anthropic-ai/sdk";
import { COUNT_SAFETY_MARGIN, OVERHEAD_TOKENS } from "./ocr-limits.ts";

/**
 * 送る内容の**実際の入力トークン数**を Anthropic に数えてもらう。
 *
 * 🔴 **数えられなかったら OCR を通さない（fail-close）。**
 * 以前は見積りへフォールバックしていたが、見積りは典型値に基づくもので
 * 上界ではない。**「計測できない」と「安いと分かっている」は別物**で、
 * 前者で通すと予算の判定が根拠を失う（2026-08-22 の外部レビュー指摘 1）。
 *
 * 🔴 **成功した値もそのまま使わない。** `count_tokens` の値と実請求は
 * 一致する保証がないので、[COUNT_SAFETY_MARGIN] を掛けて
 * [OVERHEAD_TOKENS] を足したものを予約する。**予約は多めに、精算は実費で。**
 *
 * 呼ぶのは**安価な試行制限を通ったあと**だけ。前に置くとこれ自体が
 * 連打の的になる。外部に endpoint としては出さない。
 */
export type CountResult =
  | { ok: true; measured: number; reserve: number }
  | { ok: false };

export async function countInputTokens(args: {
  client: Anthropic;
  model: string;
  system: string;
  content: Anthropic.MessageCreateParams["messages"][0]["content"];
  timeoutMs: number;
}): Promise<CountResult> {
  try {
    const r = await args.client.messages.countTokens(
      {
        model: args.model,
        system: args.system,
        messages: [{ role: "user", content: args.content }],
      },
      { timeout: args.timeoutMs, maxRetries: 0 },
    );
    const n = r?.input_tokens;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return { ok: false };
    return {
      ok: true,
      measured: n,
      reserve: Math.ceil(n * COUNT_SAFETY_MARGIN) + OVERHEAD_TOKENS,
    };
  } catch {
    // 理由は出さない（本文・URL が混ざりうる）。区分だけ。
    console.error("[ocr] count_tokens failed");
    return { ok: false };
  }
}
