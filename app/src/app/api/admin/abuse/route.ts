import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAbuseSignals } from "@/lib/admin-moderation";

/** GET /api/admin/abuse — flagged / high-rejection users. */
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
    const rows = await fetchAbuseSignals(100);
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[api admin/abuse] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
