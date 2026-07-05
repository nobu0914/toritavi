import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { broadcast } from "@/lib/fcm";

/**
 * POST /api/push/broadcast
 *
 * 全ユーザーの全端末へお知らせ通知を一斉送信する（スプレッドシート #8
 * 「アップデート情報」相当）。super_admin のみ。
 *
 * body: { title: string; body: string; data?: Record<string,string> }
 */

/** FCM data ペイロードの上限（キー数 / キー長 / 値長）。FCM 全体で 4KB 制限。 */
const DATA_MAX_KEYS = 10;
const DATA_MAX_KEY_LEN = 64;
const DATA_MAX_VALUE_LEN = 512;

export async function POST(request: Request) {
  // Reject cross-site browser callers. Origin is absent on native (mobile)
  // requests, so skip the check when it is not present.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ctx;
  try {
    ctx = await requireAdmin("super_admin");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { title?: unknown; body?: unknown; data?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!title || !body) {
    return NextResponse.json(
      { error: "title and body are required" },
      { status: 400 }
    );
  }

  // data は string→string のみ許可。型不正が混ざると sendEachForMulticast が
  // バッチ途中で throw して「一部だけ送信済み・記録なし」になるため事前に弾く。
  let data: Record<string, string> | undefined;
  if (payload.data !== undefined && payload.data !== null) {
    if (typeof payload.data !== "object" || Array.isArray(payload.data)) {
      return NextResponse.json(
        { error: "data must be an object of string values" },
        { status: 400 }
      );
    }
    const entries = Object.entries(payload.data as Record<string, unknown>);
    if (
      entries.length > DATA_MAX_KEYS ||
      entries.some(
        ([k, v]) =>
          typeof v !== "string" ||
          k.length > DATA_MAX_KEY_LEN ||
          v.length > DATA_MAX_VALUE_LEN
      )
    ) {
      return NextResponse.json(
        { error: "data must be small string key/value pairs" },
        { status: 400 }
      );
    }
    data = Object.fromEntries(entries) as Record<string, string>;
  }

  const h = await headers();
  const auditMeta = {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };

  try {
    const result = await broadcast({ title, body, data });
    // 全ユーザーへの一斉送信は最も影響の大きい admin 操作なので必ず監査する。
    await recordAuditLog(ctx, {
      action: "admin.push.broadcast",
      summary: `title="${title}" sent=${result.sent} failed=${result.failed}`,
      ...auditMeta,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "broadcast failed";
    console.error("[push/broadcast] failed", e);
    await recordAuditLog(ctx, {
      action: "admin.push.broadcast",
      summary: `FAILED title="${title}" error=${msg.slice(0, 120)}`,
      ...auditMeta,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
