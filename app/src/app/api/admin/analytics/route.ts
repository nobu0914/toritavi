import { NextResponse, type NextRequest } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAnalytics } from "@/lib/admin-analytics";

const ALLOWED_DAYS = new Set([7, 30, 90]);

/** GET /api/admin/analytics?days=30 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10);
  const days = ALLOWED_DAYS.has(raw) ? raw : 30;

  try {
    const data = await fetchAnalytics(days);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[api admin/analytics] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
