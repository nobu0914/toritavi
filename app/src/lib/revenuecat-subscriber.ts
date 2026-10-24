/**
 * RevenueCat の REST API で、ある app_user_id の **pro がいま有効か**を確かめる
 * （2026-10-24・夜間検査 3-1）。
 *
 * 使うのは webhook の `TRANSFER` だけ。`TRANSFER` の本文には `entitlement_ids` が
 * 無く、「移った権利が pro か」「いま有効か」を本文からは判断できない
 * （期限切れの取引が移っただけでも `TRANSFER` は飛ぶ）。
 *
 * ## 🔴 答えは 3 通り。**「分からない」を「無効」と混ぜない**
 *
 * - `active`   … pro があり、期限が無い（買い切り）か、期限が今より後
 * - `inactive` … 引けたうえで、pro が無い／期限切れ
 * - `unknown`  … 鍵が通らない・通信できない・応答が読めない
 *
 * 呼び出し側は **`active` のときだけ**付与する。`inactive` と `unknown` は
 * どちらも付与しないが、ログで区別できるようにしておく
 * （`unknown` が続くなら鍵か RevenueCat 側の障害）。
 *
 * ⚠️ `GET /v1/subscribers/{id}` は、その id の subscriber が無ければ**作る**
 *    （公式の仕様）。`TRANSFER` の `transferred_to` は RevenueCat 自身が
 *    送ってきた id なので、実際には既にある。
 *
 * 🔴 鍵（`REVENUECAT_SECRET_API_KEY`）は**秘密鍵**。ログにも応答にも出さない。
 */

const API_BASE = "https://api.revenuecat.com/v1/subscribers/";

/** 1 回の問い合わせの時間切れ。webhook の応答を長く待たせない。 */
export const RC_LOOKUP_TIMEOUT_MS = 3_000;

export type ProLookup =
  | { status: "active"; purchasedAtMs: number | null }
  | { status: "inactive"; reason: string }
  | { status: "unknown"; reason: string };

type Entitlement = { expires_date?: unknown; purchase_date?: unknown };

/**
 * subscriber の応答（`GET /v1/subscribers/{id}` の本文）から pro の有効性を読む。
 * 形が想定と違えば `unknown`（読めないものを「無効」と言い切らない）。
 */
export function readProEntitlement(
  body: unknown,
  entitlementId: string,
  nowMs: number,
): ProLookup {
  const sub = (body as { subscriber?: { entitlements?: unknown } } | null)?.subscriber;
  const ents = sub?.entitlements;
  if (!ents || typeof ents !== "object") {
    return { status: "unknown", reason: "no_entitlements_object" };
  }
  const ent = (ents as Record<string, Entitlement | undefined>)[entitlementId];
  if (!ent || typeof ent !== "object") {
    return { status: "inactive", reason: "entitlement_absent" };
  }
  const purchased = typeof ent.purchase_date === "string" ? Date.parse(ent.purchase_date) : NaN;
  const purchasedAtMs = Number.isFinite(purchased) ? purchased : null;
  // 期限が無い（null）＝買い切り。期限があれば今より後のときだけ有効。
  if (ent.expires_date === null) return { status: "active", purchasedAtMs };
  if (typeof ent.expires_date !== "string") {
    return { status: "unknown", reason: "expires_date_unreadable" };
  }
  const exp = Date.parse(ent.expires_date);
  if (!Number.isFinite(exp)) return { status: "unknown", reason: "expires_date_unreadable" };
  if (exp > nowMs) return { status: "active", purchasedAtMs };
  return { status: "inactive", reason: "expired" };
}

/**
 * 問い合わせる。**やり直しは 1 回まで**（通信断・時間切れ・5xx・429 のときだけ）。
 * 4xx（鍵が通らない等）はやり直しても変わらないので、すぐ `unknown` を返す。
 */
export async function lookupProEntitlement(args: {
  appUserId: string;
  secretKey: string;
  entitlementId: string;
  nowMs: number;
}): Promise<ProLookup> {
  const url = API_BASE + encodeURIComponent(args.appUserId);
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.secretKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(RC_LOOKUP_TIMEOUT_MS),
      });
    } catch (e) {
      last = `fetch_failed: ${e instanceof Error ? e.name : "error"}`;
      continue; // 通信断・時間切れはやり直す
    }
    if (res.status >= 500 || res.status === 429) {
      last = `http_${res.status}`;
      continue;
    }
    if (!res.ok) return { status: "unknown", reason: `http_${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "unknown", reason: "invalid_json" };
    }
    return readProEntitlement(body, args.entitlementId, args.nowMs);
  }
  return { status: "unknown", reason: last || "lookup_failed" };
}
