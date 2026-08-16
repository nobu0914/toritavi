import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { rejectWriteOrigin } from "@/lib/allowed-origins";
import { setUserStatus } from "@/lib/admin-moderation";
import type { UserStatus } from "@/lib/moderation";

const VALID: UserStatus[] = ["active", "suspended", "banned"];

/**
 * POST /api/admin/users/[id]/status — suspend / ban / reactivate a user.
 * super_admin only. body: { status, reason? }
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
    ctx = await requireAdmin("super_admin");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { status?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const status = body.status as UserStatus;
  if (!VALID.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason : null;

  // Guard: don't let an admin suspend their own account (lock-out footgun).
  if (id === ctx.userId && status !== "active") {
    return NextResponse.json(
      { error: "cannot change your own status" },
      { status: 400 }
    );
  }

  try {
    const h = await headers();
    const result = await setUserStatus(ctx, id, status, reason, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    return NextResponse.json({ ok: true, status: result, auditFailed: !result.audited });
  } catch (e) {
    console.error("[api admin/users/:id/status] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
