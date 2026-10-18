import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { rejectWriteOrigin } from "@/lib/allowed-origins";
import { recordAuditLog } from "@/lib/admin-audit";
import { updateAffiliateRate } from "@/lib/admin-analytics";

const EPC_MAX = 100000; // ¥100,000/click 上限（誤入力ガード）

/**
 * POST /api/admin/analytics/rates — プログラムの EPC 単価を保存。
 * super_admin のみ。body: { program, epcYen }
 */
export async function POST(request: Request) {
  // 管理コンソールはブラウザ専用。**Origin が無い書き込みも拒否する**
  // （検査 L-3。以前は付けなければ素通りだった）。
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

  let body: { program?: unknown; epcYen?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const program = typeof body.program === "string" ? body.program.trim() : "";
  const epcYen = Number(body.epcYen);
  if (!program) {
    return NextResponse.json({ error: "program required" }, { status: 400 });
  }
  if (!Number.isFinite(epcYen) || epcYen < 0 || epcYen > EPC_MAX) {
    return NextResponse.json({ error: "invalid epcYen" }, { status: 400 });
  }

  const h = await headers();
  const auditMeta = {
    targetType: "affiliate_program",
    targetId: program,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };

  // 🔴 **書く前に記録する。記録できなければ書かずに 503**
  //    （2026-10-19・夜間検査 5-11）。
  //    以前は書いたあとに記録し、**戻り値を捨てていた** —— 記録に失敗しても
  //    200 `{ ok: true }` が返り、画面は「保存しました」と出す。
  //    誰が単価を変えたか分からないまま推定売上の数字が動く。
  //    書いてから記録する形だと、記録に落ちた瞬間に「変わったが痕跡が無い」が
  //    成立するので、利用者ファイルの閲覧（`files/route.ts` の GET）と同じく
  //    **先に記録する。**
  const recorded = await recordAuditLog(ctx, {
    action: "admin.affiliate.rate_changed",
    summary: `epc_yen=${epcYen}`,
    ...auditMeta,
  });
  if (!recorded) {
    console.error("[api admin/analytics/rates] audit failed — refusing");
    return NextResponse.json({ error: "audit unavailable" }, { status: 503 });
  }

  try {
    await updateAffiliateRate(program, epcYen, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api admin/analytics/rates] failed", e);
    // 🔴 **記録だけが嘘をつかないようにする。** 上で「変えた」と残してあるので、
    //    書けなかったことも残す（broadcast の FAILED と同じ考え方）。
    const followed = await recordAuditLog(ctx, {
      action: "admin.affiliate.rate_change_failed",
      summary: `epc_yen=${epcYen}`,
      ...auditMeta,
    });
    if (!followed) console.error("[api admin/analytics/rates] failure audit also failed");
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
