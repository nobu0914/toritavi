import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { broadcast } from "@/lib/fcm";

/**
 * POST /api/push/broadcast
 *
 * 全ユーザーの全端末へお知らせ通知を一斉送信する（スプレッドシート #8
 * 「アップデート情報」相当）。super_admin のみ。
 *
 * body: { title: string; body: string; data?: Record<string,string> }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin("super_admin");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { title?: unknown; body?: unknown; data?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!title || !body) {
    return NextResponse.json(
      { error: "title and body are required" },
      { status: 400 }
    );
  }
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, string>)
      : undefined;

  try {
    const result = await broadcast({ title, body, data });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "broadcast failed";
    console.error("[push/broadcast] failed", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
