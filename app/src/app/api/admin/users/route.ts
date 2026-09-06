import { NextResponse, type NextRequest } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAdminUserList } from "@/lib/admin-queries";
import { recordAuditLog } from "@/lib/admin-audit";
import type { AdminContext } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  let ctx: AdminContext;
  try {
    ctx = await requireAdmin("support_viewer");
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

    // 🔴 **この経路も無記録だった**（JR000212）。画面と同じく生メールを
    //    最大 200 件返すのに、痕跡が残らなかった。**検索語は書かない**
    //    （語は利用者のメールで、summary は support_viewer にも見える）。
    const h = request.headers;
    await recordAuditLog(ctx, {
      action: query ? "admin.users.searched_api" : "admin.users.listed_api",
      targetType: "user",
      targetId: null,
      summary: `page=${page} perPage=${perPage} returned=${result.rows.length} total=${result.total}`,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });

    // 管理コンソール専用API（requireAdmin 済み）なので生 email を返す。
    const rows = result.rows.map((r) => ({
      id: r.id,
      email: r.email,
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
      rows,
    });
  } catch (e) {
    console.error("[api admin/users] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
