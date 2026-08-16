import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { rejectWriteOrigin } from "@/lib/allowed-origins";
import { fetchUserFiles, signUserFile, deleteUserFile } from "@/lib/admin-moderation";

function reqMeta(h: Headers) {
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

/**
 * GET /api/admin/users/[id]/files — list a user's uploaded files (+ signed preview URLs).
 *
 * 🔴 **ここが返すのは搭乗券・パスポート・予約票の実物。**
 *
 * 2026-08-16 の検査まで、最下位の `support_viewer` で全画像の署名 URL を
 * 取得でき、しかも**画像単位の監査記録が残らなかった**（利用者詳細を開くだけで
 * パネルが自動取得する）。App Store の掲載文が
 * 「ご本人以外はアクセスできません」と書いており、実態と食い違っていた。
 *
 * 直したのは 2 点:
 *   - 最低ロールを `support_operator` へ（閲覧専用ロールからは見えない）
 *   - **取得のたびに監査へ残す。記録に失敗したら画像を返さない**
 *
 * 記録失敗で本体を止めるのはこの route だけ。ほかの管理操作は「監査失敗で
 * 業務を止めない」設計（`admin-audit.ts` 冒頭）だが、**ここは中身が写真そのもの**
 * なので「誰が見たか分からないまま見せる」より「見せない」に倒す
 * （`~/Dev/toritavi_app/CLAUDE.md` §5 フェイルクローズ）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireAdmin("support_operator");
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const files = await fetchUserFiles(id);

    // **署名 URL を発行する前に記録する。** 発行してから記録すると、
    // 記録が落ちた瞬間に「見られるが痕跡が無い」が成立してしまう。
    const meta = reqMeta(await headers());
    const buckets = [...new Set(files.map((f) => f.bucket))].sort().join(",");
    const recorded = await recordAuditLog(ctx, {
      action: "admin.user.files_viewed",
      targetType: "user",
      targetId: id,
      // **パスは書かない。** step id から旅程が辿れるうえ、監査ログは
      // support_viewer にも見える（データ最小化）。件数と面だけ残す。
      summary: `files=${files.length} buckets=${buckets || "none"}`,
      ...meta,
    });
    if (!recorded) {
      console.error("[api admin/users/:id/files GET] audit failed — refusing");
      return NextResponse.json({ error: "audit unavailable" }, { status: 503 });
    }

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
  // DELETE は書き込み。**Origin が無いものも拒否する**（検査 L-3）。
  // GET 側は同一オリジンでもブラウザが Origin を送らないので、
  // あちらは従来どおり「あれば検査する」に留める。
  if (rejectWriteOrigin(request)) {
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
    const { audited } = await deleteUserFile(ctx, id, bucket, path, reqMeta(h));
    return NextResponse.json({ ok: true, auditFailed: !audited });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    console.error("[api admin/users/:id/files DELETE] failed", e);
    // path-ownership / bucket validation errors are client errors
    const status = /belong|invalid/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
