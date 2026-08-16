import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { rejectWriteOrigin } from "@/lib/allowed-origins";
import { notifyUser } from "@/lib/admin-moderation";
import { PUSH_BODY_MAX, PUSH_TITLE_MAX } from "@/lib/push-limits";

/**
 * POST /api/admin/users/[id]/notify — send a targeted push to one user.
 * support_operator+. body: { title, body }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 管理コンソールはブラウザ専用。**Origin が無い書き込みも拒否する**
  // （検査 L-3。以前は付けなければ素通りだった）。
  if (rejectWriteOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ctx;
  try {
    ctx = await requireAdmin("support_operator");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { title?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!title || !message) {
    return NextResponse.json({ error: "title and body required" }, { status: 400 });
  }
  if (title.length > PUSH_TITLE_MAX || message.length > PUSH_BODY_MAX) {
    return NextResponse.json({ error: "title or body too long" }, { status: 400 });
  }

  try {
    const h = await headers();
    const result = await notifyUser(ctx, id, title, message, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    // audited は result に含まれる（admin-moderation）。画面が警告を出す。
    return NextResponse.json({ ok: true, ...result, auditFailed: !result.audited });
  } catch (e) {
    console.error("[api admin/users/:id/notify] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
