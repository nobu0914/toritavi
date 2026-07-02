import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";

/**
 * POST /api/webhooks/revenuecat
 *
 * Server-to-server callback from RevenueCat. Keeps `toritavi_user_plan` in
 * sync with the subscriber's actual entitlement state so `resolvePlan()`
 * (src/lib/ai-guard.ts) and /api/ai-usage reflect purchases made in the
 * mobile app (Apple IAP / Google Play Billing via RevenueCat).
 *
 * Auth: RevenueCat sends a fixed shared-secret string in the Authorization
 * header (configured in the RevenueCat dashboard) — there is no per-request
 * signature, so this header IS the entire trust boundary. No Origin check:
 * this is never called by a browser.
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

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { event?: RevenueCatEvent };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body.event;
  if (!event?.app_user_id || !event.type) {
    return NextResponse.json({ error: "Missing event fields" }, { status: 400 });
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

  const { error } = await admin
    .from("toritavi_user_plan")
    .upsert(
      { user_id: event.app_user_id, plan: newPlan, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[webhooks/revenuecat] upsert failed", event.type, event.app_user_id, error);
    // 5xx so RevenueCat retries — the upsert is idempotent, safe to redeliver.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, plan: newPlan });
}
