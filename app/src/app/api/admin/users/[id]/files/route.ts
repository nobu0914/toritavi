import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { fetchUserFiles, signUserFile, deleteUserFile } from "@/lib/admin-moderation";

function reqMeta(h: Headers) {
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

/** GET /api/admin/users/[id]/files — list a user's uploaded files (+ signed preview URLs). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const files = await fetchUserFiles(id);
    const withUrls = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await signUserFile(id, f.bucket, f.path),
      }))
    );
    return NextResponse.json({ files: withUrls });
  } catch (e) {
    console.error("[api admin/users/:id/files GET] failed", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/users/[id]/files — remove one file. super_admin only. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  let body: { bucket?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const bucket = typeof body.bucket === "string" ? body.bucket : "";
  const path = typeof body.path === "string" ? body.path : "";
  if (!bucket || !path) {
    return NextResponse.json({ error: "bucket and path required" }, { status: 400 });
  }

  try {
    const h = await headers();
    await deleteUserFile(ctx, id, bucket, path, reqMeta(h));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    console.error("[api admin/users/:id/files DELETE] failed", e);
    // path-ownership / bucket validation errors are client errors
    const status = /belong|invalid/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
