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
import { createClient } from "@/lib/supabase-server";

export type AdminRole = "support_viewer" | "support_operator" | "super_admin";

const ROLE_RANK: Record<AdminRole, number> = {
  support_viewer: 10,
  support_operator: 20,
  super_admin: 30,
};

export type AdminContext = {
  userId: string;
  email: string | null;
  role: AdminRole;
};

export class AdminAuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

function hasRank(role: AdminRole, min: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Resolve the admin context for the current request, or null if the
 * caller is not logged in / not an admin. Never throws on the "not
 * admin" path — use requireAdmin() when you want to enforce.
 */
export async function getAdminContext(): Promise<AdminContext | null> {
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
