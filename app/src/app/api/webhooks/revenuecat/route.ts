import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { eventAtIso } from "@/lib/webhook-event-order";
import { verifyRevenueCatSignature } from "@/lib/revenuecat-signature";

/**
 * POST /api/webhooks/revenuecat
 *
 * Server-to-server callback from RevenueCat. Keeps `toritavi_user_plan` in
 * sync with the subscriber's actual entitlement state so `resolvePlan()`
 * (src/lib/ai-guard.ts) and /api/ai-usage reflect purchases made in the
 * mobile app (Apple IAP / Google Play Billing via RevenueCat).
 *
 * ## 認証は 2 段
 *
 * 1. **Authorization ヘッダの共有シークレット**（`REVENUECAT_WEBHOOK_SECRET`）。
 *    ダッシュボードで設定した固定文字列。
 * 2. **HMAC 署名**（`REVENUECAT_WEBHOOK_HMAC_SECRET`）。
 *    `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>` を
 *    `HMAC-SHA256("<t>." + 生の本文)` と突き合わせる。
 *
 * 🔴 **1 だけでは、鍵が漏れた時点で本文を自由に作れる。**
 * `INITIAL_PURCHASE` と任意の `app_user_id` を送るだけで、
 * **一円も払わずに Pro になれる。** 2 は本文の改ざんと再送を止める。
 * （2026-08-29 のレーン 8 検査で指摘）
 *
 * ⚠️ **HMAC は env が設定されているときだけ強制する。**
 * ダッシュボードで有効にする前にコード側を必須にすると、
 * **正しい webhook を全部 401 で落とす**。順番は
 * 「①ダッシュボードで有効化 → ②env を設定 → 自動的に強制が効く」。
 * env が無い間は**毎回 console.error を出す** —— 黙って弱いまま動かさない。
 *
 * Origin は見ない: ブラウザから呼ばれる経路ではない。
 *
 * CANCELLATION (auto-renew turned off) is deliberately a no-op — the
 * subscriber keeps access until the period actually ends. Only EXPIRATION
 * downgrades to free.
 */

const PRO_ENTITLEMENT = "pro";

// Events that indicate the subscriber currently holds the pro entitlement.
const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "TRANSFER",
]);

// Events that end pro access immediately.
const REVOKING_EVENTS = new Set(["EXPIRATION"]);

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  entitlement_ids?: string[];
  /** RevenueCat がイベントを起こした時刻。**配送順ではなく、これで並べる。** */
  event_timestamp_ms?: number;
};


function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("authorization") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first
  // (a length mismatch is itself safe to reveal — it does not leak the
  // secret's content, only that the guess was the wrong length).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** UUID（Supabase の user_id）以外を `toritavi_user_plan` へ入れない。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 🔴 **生の本文を先に読む。** HMAC は受け取ったバイト列そのものに対する
  //    計算なので、`request.json()` で解析してからでは検証できない。
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sig = verifyRevenueCatSignature(
    raw,
    request.headers.get("x-revenuecat-webhook-signature"),
    process.env.REVENUECAT_WEBHOOK_HMAC_SECRET,
    Date.now(),
  );
  if (!sig.ok) {
    console.error("[webhooks/revenuecat] 署名を検証できなかった:", sig.reason);
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }
  if (!sig.enforced) {
    // 🔴 弱いまま動いていることを、毎回はっきり残す。
    console.error(
      "[webhooks/revenuecat] HMAC 未設定のまま受理した。" +
        "REVENUECAT_WEBHOOK_HMAC_SECRET を設定すること",
    );
  }

  let body: { event?: RevenueCatEvent };
  try {
    body = JSON.parse(raw) as { event?: RevenueCatEvent };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body.event;
  if (!event?.app_user_id || !event.type) {
    return NextResponse.json({ error: "Missing event fields" }, { status: 400 });
  }

  // 🔴 **`app_user_id` をそのまま `user_id` に入れない。**
  //    アプリは `Purchases.logIn(supabaseUserId)` で UUID を渡すが、
  //    匿名 ID（`$RCAnonymousID:...`）や試験イベントの値が来ることもある。
  //    UUID でないものを upsert すると外部キー違反で 500 になり、
  //    RevenueCat が延々と再送する。**受け取れないものは 200 で捨てる。**
  if (!UUID_RE.test(event.app_user_id)) {
    return NextResponse.json({ ok: true, skipped: "not_a_supabase_user" });
  }

  const hasProEntitlement = (event.entitlement_ids ?? []).includes(PRO_ENTITLEMENT);
  let newPlan: "free" | "pro" | null = null;
  if (GRANTING_EVENTS.has(event.type) && hasProEntitlement) {
    newPlan = "pro";
  } else if (REVOKING_EVENTS.has(event.type)) {
    newPlan = "free";
  }
  // Any other event type (CANCELLATION, BILLING_ISSUE, TEST, etc.) is a
  // deliberate no-op — acknowledge without touching the plan.
  if (newPlan === null) {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[webhooks/revenuecat] service client unavailable", e);
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  // 🔴 **古いイベントで新しい状態を踏み潰さない。**
  //    配送順は保証されない。再送で遅れた EXPIRATION が RENEWAL の後ろに
  //    並ぶと、契約中の人が黙って free に落ちる。**戻す経路は無い。**
  //    `updated_at` はイベント発生時刻を持ち、それが順序の正本になる。
  const eventAt = eventAtIso(event, Date.now());

  // ① 行が無ければ作る（既にあれば触らない）。
  const { error: insErr } = await admin
    .from("toritavi_user_plan")
    .upsert(
      { user_id: event.app_user_id, plan: newPlan, updated_at: eventAt },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (insErr) {
    console.error("[webhooks/revenuecat] insert failed", event.type, event.app_user_id, insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // ② 既存行は、**このイベントより古いときだけ**進める。
  //    比較は Postgres の WHERE で行うので、同時到着でも逆転しない。
  const { data: updated, error } = await admin
    .from("toritavi_user_plan")
    .update({ plan: newPlan, updated_at: eventAt })
    .eq("user_id", event.app_user_id)
    .lt("updated_at", eventAt)
    .select("user_id");

  if (error) {
    console.error("[webhooks/revenuecat] update failed", event.type, event.app_user_id, error);
    // 5xx so RevenueCat retries — the write is idempotent, safe to redeliver.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updated?.length) {
    // ①で作ったか、より新しい状態が既に入っている。**どちらも正常。**
    // 「何も起きなかった」を成功と区別できるよう、応答に残す。
    return NextResponse.json({ ok: true, plan: newPlan, applied: false });
  }
  return NextResponse.json({ ok: true, plan: newPlan, applied: true });
}
