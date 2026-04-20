import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAdminUserDetail } from "@/lib/admin-queries";
import { recordAuditLog } from "@/lib/admin-audit";
import { headers } from "next/headers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const detail = await fetchAdminUserDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const h = await headers();
    recordAuditLog(ctx, {
      action: "admin.user.viewed",
      targetType: "user",
      targetId: id,
      summary: detail.email ? `api viewed ${detail.email}` : `api viewed ${id}`,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });

    // API response strips the raw email to keep API callers aligned with
    // the list endpoint (which also masks). The UI's server component
    // uses the detail directly and can surface the email there.
    return NextResponse.json({
      id: detail.id,
      // Raw email intentionally NOT included in API response.
      createdAt: detail.createdAt,
      lastSignInAt: detail.lastSignInAt,
      emailConfirmedAt: detail.emailConfirmedAt,
      hasSettings: !!detail.settings,
      settings: detail.settings
        ? {
            displayName: detail.settings.displayName,
            timezone: detail.settings.timezone,
            defaultOrigin: detail.settings.defaultOrigin,
            hasEmergencyContact: !!detail.settings.emergencyContact,
            hasAvatar: !!detail.settings.avatarUrl,
            updatedAt: detail.settings.updatedAt,
          }
        : null,
      counts: detail.counts,
      usage: detail.usage,
      adminRole: detail.adminRole,
      recentAuditLogs: detail.recentAuditLogs,
    });
  } catch (e) {
    console.error("[api admin/users/:id] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
