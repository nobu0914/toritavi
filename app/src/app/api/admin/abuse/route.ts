import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAbuseSignals } from "@/lib/admin-moderation";
import { recordAuditLog } from "@/lib/admin-audit";
import type { AdminContext } from "@/lib/admin-auth";
import { headers } from "next/headers";

/** GET /api/admin/abuse — flagged / high-rejection users. */
export async function GET() {
  let ctx: AdminContext;
  try {
    ctx = await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const rows = await fetchAbuseSignals(100);
    // 🔴 **この経路も無記録だった**（JR000212）。違反検知の一覧は
    //    「誰を疑っているか」そのもので、閲覧に痕跡が要る。
    const h = await headers();
    await recordAuditLog(ctx, {
      action: "admin.abuse.listed_api",
      targetType: "user",
      targetId: null,
      summary: `returned=${rows.length}`,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[api admin/abuse] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
