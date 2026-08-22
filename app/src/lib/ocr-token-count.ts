import Anthropic from "@anthropic-ai/sdk";
import {
  ESTIMATE_SAFETY_FACTOR,
  OVERHEAD_TOKENS,
} from "./ocr-limits.ts";

/**
 * 送る内容の**実際の入力トークン数**を Anthropic に数えてもらう。
 *
 * 🔴 **なぜ要るか。** ページ数と寸法からの見積りは「典型値」に基づくもので、
 * 上界ではない。高密度なページや隠しテキストを仕込まれると実費が見積りを
 * 超え、予算の判定（reserved を積んでから呼ぶ）をすり抜ける。
 *
 * 🔴 **なぜ安全か。** この呼び出しは**安価な試行制限を通ったあと**に置く。
 * 1 分あたりの試行回数が既に縛られているので、これ自体を連打できない。
 * また外部に endpoint として露出しない（この関数はサーバ内でのみ呼ぶ）。
 *
 * 失敗したら見積りに安全係数を掛けた値へ倒す。**下回る方向へは倒さない。**
 */
export async function countInputTokens(args: {
  client: Anthropic;
  model: string;
  system: string;
  content: Anthropic.MessageCreateParams["messages"][0]["content"];
  /** ページ数・寸法から出した見積り（フォールバック用）。 */
  fallback: number;
}): Promise<{ tokens: number; measured: boolean }> {
  try {
    const r = await args.client.messages.countTokens({
      model: args.model,
      system: args.system,
      messages: [{ role: "user", content: args.content }],
    });
    const n = r?.input_tokens;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      return { tokens: n, measured: true };
    }
    throw new Error("no input_tokens in response");
  } catch (e) {
    console.error("[ocr] count_tokens failed; falling back to estimate");
    return {
      tokens: Math.ceil(args.fallback * ESTIMATE_SAFETY_FACTOR) + OVERHEAD_TOKENS,
      measured: false,
    };
  }
}
