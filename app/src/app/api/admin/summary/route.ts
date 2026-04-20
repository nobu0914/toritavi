import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { fetchAdminSummary } from "@/lib/admin-queries";

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
    const summary = await fetchAdminSummary();
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[api admin/summary] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
