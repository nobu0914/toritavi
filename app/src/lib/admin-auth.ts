/**
 * Admin authorisation helpers — server-only.
 *
 * The single place that decides whether a request may enter /admin or
 * /api/admin/*. Never import from a "use client" file.
 *
 * Flow:
 *   1. requireAdmin(min) reads the session cookie via the session-aware
 *      server client and resolves the current auth user.
 *   2. It then looks up toritavi_admin_members.role via the SAME session
 *      client. RLS pins reads to the caller's own row, so this query
 *      returns a row only if the caller is actually in the admin
 *      roster. No service-role escalation is needed to answer "am I an
 *      admin?".
 *   3. If the caller's role satisfies `min`, the session + role are
 *      returned. Otherwise we throw an AdminAuthError; callers decide
 *      how to respond (redirect for pages, 401/403 JSON for APIs).
 */
import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";

// 役割と序列は画面側とも共有する（`admin-roles.ts`）。ここに 2 つ目を
// 書くと、片方だけ動かしたときに「押せるのにエラー」が生まれる。
export type { AdminRole } from "@/lib/admin-roles";
import { hasRank, ROLE_RANK, type AdminRole } from "@/lib/admin-roles";

export type AdminContext = {
  userId: string;
  email: string | null;
  role: AdminRole;
};

/** /auth/callback?type=recovery が立てる印（`proxy.ts` と同じ名前）。 */
const RECOVERY_COOKIE = "toritavi_recovery";

export class AdminAuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the admin context for the current request, or null if the
 * caller is not logged in / not an admin. Never throws on the "not
 * admin" path — use requireAdmin() when you want to enforce.
 */
export async function getAdminContext(): Promise<AdminContext | null> {
  // 🔴 **パスワード再設定のリンクで得たセッションでは入れない**
  //    （Codex 夜間検査 5-4・2026-10-24）。ページ側はプロキシが
  //    /reset-password へ戻すが、matcher が /api を除外しているので、
  //    管理 API は回復セッションのまま通っていた（パスワードを変えずに＝
  //    本人に「変更しました」の通知を出さずに、署名 URL を発行できた）。
  //    ⚠️ **これは関門ではなく、普通のブラウザの迷い込みを止める柵。** この Cookie は
  //    持ち主が消せるうえ、立つかどうかは /auth/callback の `type` クエリ（利用者が
  //    書き換えられる）で決まる（Codex の二次検査）。ページ側の関門と同じ強さしか無い。
  //    回復セッションを確実に見分けるにはセッションの属性（amr）を読む必要があるが、
  //    本番で回復時の amr の値を確かめられていない。本当の関門は管理者の MFA
  //    （課題 12・requireAdmin で aal2。**まだ実装されていない**）。
  const jar = await cookies();
  if (jar.get(RECOVERY_COOKIE)?.value === "1") return null;

  const sb = await createClient();
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) return null;

  const { data, error } = await sb
    .from("toritavi_admin_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[admin-auth] member lookup failed", error);
    return null;
  }
  if (!data) return null;

  const role = data.role as AdminRole;
  if (!ROLE_RANK[role]) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    role,
  };
}

/**
 * Enforce that the current caller is an admin with at least `min`
 * privilege. Returns the context on success, throws AdminAuthError
 * otherwise. Callers (page, layout, route handler) convert the error
 * to the appropriate response.
 */
export async function requireAdmin(
  min: AdminRole = "support_viewer"
): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    throw new AdminAuthError("not signed in or not an admin", 401);
  }
  if (!hasRank(ctx.role, min)) {
    throw new AdminAuthError(
      `role ${ctx.role} is below required ${min}`,
      403
    );
  }
  return ctx;
}
