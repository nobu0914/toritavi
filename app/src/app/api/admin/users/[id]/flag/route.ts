import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { setUserFlag } from "@/lib/admin-moderation";

/**
 * POST /api/admin/users/[id]/flag — toggle the non-blocking "under review"
 * flag + optional internal note. support_operator+.
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
  let body: { flagged?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const flagged = !!body.flagged;
  const note = typeof body.note === "string" ? body.note : null;

  try {
    const h = await headers();
    await setUserFlag(ctx, id, flagged, note, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api admin/users/:id/flag] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
