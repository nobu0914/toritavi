import { NextResponse, type NextRequest } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAdminUserList } from "@/lib/admin-queries";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const page = Math.max(parseInt(sp.get("page") ?? "1", 10) || 1, 1);
  const perPage = Math.min(
    Math.max(parseInt(sp.get("perPage") ?? "100", 10) || 100, 1),
    200
  );
  const query = (sp.get("q") ?? "").trim();

  try {
    const result = await fetchAdminUserList({ page, perPage, query });
    // Never return raw email in API response — admin UI uses emailMasked.
    const safeRows = result.rows.map((r) => ({
      id: r.id,
      emailMasked: r.emailMasked,
      createdAt: r.createdAt,
      lastSignInAt: r.lastSignInAt,
      journeyCount: r.journeyCount,
      ocrRequestsToday: r.ocrRequestsToday,
      conciergeRequestsToday: r.conciergeRequestsToday,
    }));
    return NextResponse.json({
      page: result.page,
      perPage: result.perPage,
      total: result.total,
      rows: safeRows,
    });
  } catch (e) {
    console.error("[api admin/users] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
