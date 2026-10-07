/**
 * Email Worker の純粋な部品（宛先の判定・署名・応答の解釈）。
 *
 * 🔴 **サーバ側の `src/lib/inbound-mail.ts` と形を揃える。**
 *    署名の対象 `${timestamp}.${to}.${from}.${bodyByteLength}` と宛先の
 *    正規表現がずれると、**全部のメールが 401 か「宛先不明」で落ちる。**
 *    ずれはサーバ側のテスト（`src/lib/__tests__/inbound-mail-worker-contract.test.ts`）
 *    が、この関数を実際に呼んで見張る。
 *
 * Cloudflare の型にも Node の型にも依存しない（Web Crypto だけ）。
 * Worker でも、Node のテストでも、そのまま動く。
 */

/** これを超えるメールは受け取らない（Vercel の関数の本文上限 4.5 MB の手前）。 */
export const MAX_RAW_BYTES = 4_000_000;

/** トークンの文字（l / o / 0 / 1 を除く 32 種）。 */
const TOKEN_RE = /^trips-[a-km-np-z2-9]{16}$/;

export type AcceptVerdict = "ok" | "bad_recipient" | "too_large";

/**
 * 受け取ってよいか。**MIME は解かない**（無料プランの CPU 10 ms を守る）。
 * ドメインは大文字小文字を区別しない。トークンは区別する（発行は小文字だけ）。
 */
export function shouldAccept(to: string, rawSize: number, domain: string): AcceptVerdict {
  const t = (to ?? "").trim();
  const at = t.lastIndexOf("@");
  if (at < 0) return "bad_recipient";
  if (t.slice(at + 1).toLowerCase() !== domain.toLowerCase()) return "bad_recipient";
  if (!TOKEN_RE.test(t.slice(0, at))) return "bad_recipient";
  if (!Number.isFinite(rawSize) || rawSize > MAX_RAW_BYTES) return "too_large";
  return "ok";
}

/**
 * hex の HMAC-SHA256。対象は `${timestamp}.${to}.${from}.${bodyByteLength}`。
 * **本文はハッシュしない**（4 MB を毎回ハッシュすると CPU を食う）。
 */
export async function signInbound(
  secret: string,
  timestamp: string,
  to: string,
  from: string,
  bodyByteLength: number,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${to}.${from}.${bodyByteLength}`),
  );
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * サーバの応答をどう扱うか。
 *
 * - `retry` … 例外を投げる → 送信側に一時エラーを返し、再送してもらう
 * - `done`  … 何もしない（受け取った、または捨てた）
 *
 * 🔴 **401 も retry にする。** 署名が合わないのは**こちらの設定の誤り**
 *    （秘密の入れ違い・時計のずれ）で、メールのせいではない。
 *    `done` にすると、直すまでの間に届いたメールが**黙って消える**。
 *    再送させれば、送信側が諦める（普通は数日）までに直せば失われない。
 * - 5xx は一時的な失敗・停止中（`MAIL_IMPORT_ENABLED` が閉）なので retry。
 * - それ以外の 4xx（413 など）は再送しても直らないので done。
 */
export function upstreamOutcome(status: number): "done" | "retry" {
  if (status === 401) return "retry";
  if (status >= 500) return "retry";
  return "done";
}
