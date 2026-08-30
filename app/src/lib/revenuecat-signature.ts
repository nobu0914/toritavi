import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * RevenueCat の webhook 署名（`X-RevenueCat-Webhook-Signature`）の検証。
 *
 * 形式は `t=<unix秒>,v1=<hex>` で、`v1` は
 * **`HMAC-SHA256("<t>." + 生の本文)`**。
 *
 * 🔴 **生の本文で計算する。** `JSON.parse` → `JSON.stringify` で作り直すと
 * バイト列が変わり、**正しい要求まで落ちる**。呼び出し側は `request.text()`
 * を先に読み、そこから `JSON.parse` すること。
 *
 * ## なぜ要るか
 *
 * Authorization ヘッダの共有シークレットだけだと、**それが漏れた時点で
 * 本文を自由に作れる**。`INITIAL_PURCHASE` と任意の `app_user_id` を送れば
 * **一円も払わずに Pro になれる**（2026-08-29 のレーン 8 検査で指摘）。
 */

/**
 * 署名の `t` がこれ以上ずれていたら弾く。**5 分。**
 *
 * 2026-08-30 に一度 24 時間へ広げたが、**前提が誤っていたので戻した。**
 * 広げた理由は「再送で `t` を打ち直さないかもしれない」という推測だったが、
 * 公式ドキュメントは逆を明記している:
 *
 * > RevenueCat recomputes `t` and `v1` on every delivery attempt,
 * > including automatic retries and a manual Retry from the dashboard.
 * > A 5-minute tolerance only needs to cover clock skew and the latency of
 * > that POST. Don't size it to cover the retry delays of 5, 10, 20, 40,
 * > and 80 minutes.
 *
 * （`docs/integrations/webhooks` の Signature timestamp on retries。
 *   2026-08-30 に一次資料で確認）
 *
 * 🔴 **窓は狭いほどよい。** ここが守っているのは「漏れた鍵で盗んだ
 * リクエストを使い回されること」で、24 時間だと**丸一日使い回せる。**
 * 再送を心配して広げる必要は無かった。
 */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export type SignatureCheck =
  | { ok: true; enforced: boolean }
  | { ok: false; reason: string };

/**
 * @param raw    受け取ったままの本文
 * @param header `X-RevenueCat-Webhook-Signature` の値（無ければ null）
 * @param secret 署名鍵。**未設定なら検証しない**（下記）
 * @param nowMs  現在時刻。テストから固定できるようにしている
 *
 * ⚠️ **`secret` が空なら `{ok:true, enforced:false}` を返す。**
 * ダッシュボードで HMAC を有効にする前にコード側を必須にすると、
 * **正しい webhook を全部 401 で落とす**。順番は
 * 「①ダッシュボードで有効化 → ②鍵を設定 → 自動的に強制が効く」。
 * **呼び出し側は `enforced === false` を必ず記録すること** ——
 * 黙って弱いまま動かさないため。
 */
export function verifyRevenueCatSignature(
  raw: string,
  header: string | null,
  secret: string | undefined,
  nowMs: number,
): SignatureCheck {
  if (!secret) return { ok: true, enforced: false };
  if (!header) return { ok: false, reason: "signature_missing" };

  const parts = new Map<string, string>();
  for (const p of header.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) return { ok: false, reason: "signature_malformed" };

  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  // 長さが違うと timingSafeEqual が例外を投げるので先に見る。
  // 長さの一致は秘密を漏らさない（hex の桁数は固定）。
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  // 署名が合っていても、古い要求の再送は受けない。
  const ts = Number(t) * 1000;
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: "signature_stale" };
  }
  return { ok: true, enforced: true };
}
