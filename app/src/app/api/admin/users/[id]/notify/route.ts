import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { notifyUser } from "@/lib/admin-moderation";

const TITLE_MAX = 80;
const BODY_MAX = 300;

/**
 * POST /api/admin/users/[id]/notify — send a targeted push to one user.
 * support_operator+. body: { title, body }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
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
  if (title.length > TITLE_MAX || message.length > BODY_MAX) {
    return NextResponse.json({ error: "title or body too long" }, { status: 400 });
  }

  try {
    const h = await headers();
    const result = await notifyUser(ctx, id, title, message, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[api admin/users/:id/notify] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
