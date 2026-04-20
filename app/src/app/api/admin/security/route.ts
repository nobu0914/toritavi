import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchRecentAuditLogs } from "@/lib/admin-audit";

export async function GET() {
  try {
    await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const logs = await fetchRecentAuditLogs(200);
    const counts = new Map<string, number>();
    for (const l of logs) counts.set(l.action, (counts.get(l.action) ?? 0) + 1);
    const byAction = Array.from(counts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      totalWindow: logs.length,
      byAction,
      recent: logs.slice(0, 50),
    });
  } catch (e) {
    console.error("[api admin/security] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
