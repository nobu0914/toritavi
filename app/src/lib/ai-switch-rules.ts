/**
 * 停止スイッチの**純粋な判定**だけを置く。
 *
 * `ai-switch.ts` は Supabase クライアントを掴むので、そのままでは
 * 単体テストから読めない。**判定はここに切り出して、両方から使う。**
 * 2 つ書くと「画面は止まっているのに API は通る」が生まれる。
 */
export type AiMode = "on" | "guest_off" | "off";

const ORDER: Record<AiMode, number> = { on: 0, guest_off: 1, off: 2 };

/** 2 つのうち**厳しいほう**。env は DB より厳しい側にだけ効かせる。 */
export function stricter(a: AiMode, b: AiMode): AiMode {
  return ORDER[a] >= ORDER[b] ? a : b;
}

export function isAiMode(v: unknown): v is AiMode {
  return v === "on" || v === "guest_off" || v === "off";
}

/** この audience が実行してよいか。 */
export function modeAllows(mode: AiMode, audience: "guest" | "free" | "pro"): boolean {
  if (mode === "off") return false;
  if (mode === "guest_off") return audience !== "guest";
  return true;
}

export const MODE_MESSAGE: Record<Exclude<AiMode, "on">, string> = {
  guest_off:
    "いまは会員の方のみ自動読み取りをご利用いただけます。手入力での登録は引き続きご利用いただけます。",
  off: "自動読み取りを一時停止しています。手入力での登録と、登録済みの旅程の閲覧はご利用いただけます。",
};
