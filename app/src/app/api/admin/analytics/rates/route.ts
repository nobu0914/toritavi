import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { recordAuditLog } from "@/lib/admin-audit";
import { updateAffiliateRate } from "@/lib/admin-analytics";

const EPC_MAX = 100000; // ¥100,000/click 上限（誤入力ガード）

/**
 * POST /api/admin/analytics/rates — プログラムの EPC 単価を保存。
 * super_admin のみ。body: { program, epcYen }
 */
export async function POST(request: Request) {
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

  let body: { program?: unknown; epcYen?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const program = typeof body.program === "string" ? body.program.trim() : "";
  const epcYen = Number(body.epcYen);
  if (!program) {
    return NextResponse.json({ error: "program required" }, { status: 400 });
  }
  if (!Number.isFinite(epcYen) || epcYen < 0 || epcYen > EPC_MAX) {
    return NextResponse.json({ error: "invalid epcYen" }, { status: 400 });
  }

  try {
    await updateAffiliateRate(program, epcYen, ctx.userId);
    const h = await headers();
    await recordAuditLog(ctx, {
      action: "admin.affiliate.rate_changed",
      targetType: "affiliate_program",
      targetId: program,
      summary: `epc_yen=${epcYen}`,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api admin/analytics/rates] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
