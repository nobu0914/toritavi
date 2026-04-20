/**
 * Server-side aggregators for the admin console. Uses the service-role
 * client so it can count rows across all users without tripping RLS.
 *
 * Callers must already have passed requireAdmin(). This module does NOT
 * re-check authorisation — it trusts that the caller did.
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase-service";

export type AdminSummary = {
  totals: {
    users: number;
    journeys: number;
    steps: number;
  };
  today: {
    activeUsers: number;
    ocrRequests: number;
    conciergeRequests: number;
  };
  ocr: {
    monthSpendCents: number;
    monthRequests: number;
  };
  concierge: {
    monthSpendCents: number;
    monthRequests: number;
  };
};

function todayStr(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStr(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function safeCount(
  admin: ReturnType<typeof createServiceClient>,
  table: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.warn(`[admin-queries] count(${table}) failed`, error);
    return 0;
  }
  return count ?? 0;
}

export async function fetchAdminSummary(): Promise<AdminSummary> {
  const admin = createServiceClient();
  const today = todayStr();
  const month = monthStr();

  // Users: listUsers is paginated. For MVP we use perPage=1 and the
  // `total` field the SDK returns on page 1. If that field is missing
  // we fall back to 0 rather than iterating thousands of users.
  let totalUsers = 0;
  let activeToday = 0;
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    // @ts-expect-error - supabase-js exposes total on the payload
    totalUsers = (data && (data.total ?? 0)) as number;
    if (error) console.warn("[admin-queries] listUsers failed", error);
  } catch (e) {
    console.warn("[admin-queries] listUsers threw", e);
  }

  // "Active today" = has logged in today. We have to paginate listUsers
  // to compute this. For MVP we cap at the first 1000 users; larger
  // deployments should replace this with a dedicated events table.
  try {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = data?.users ?? [];
    activeToday = users.filter((u) => {
      const t = u.last_sign_in_at ? new Date(u.last_sign_in_at) : null;
      return t && t.getTime() >= since.getTime();
    }).length;
  } catch (e) {
    console.warn("[admin-queries] active count failed", e);
  }

  const [journeys, steps] = await Promise.all([
    safeCount(admin, "toritavi_journeys"),
    safeCount(admin, "toritavi_steps"),
  ]);

  // OCR today: sum request_count across all users for today.
  let ocrRequests = 0;
  try {
    const { data } = await admin
      .from("toritavi_ocr_usage")
      .select("requests_count")
      .eq("day", today);
    if (data) ocrRequests = data.reduce((a, r) => a + (r.requests_count ?? 0), 0);
  } catch (e) {
    console.warn("[admin-queries] ocr usage failed", e);
  }

  let ocrMonthSpend = 0;
  let ocrMonthReq = 0;
  try {
    const { data } = await admin
      .from("toritavi_ocr_budget")
      .select("spend_cents, request_count")
      .eq("month", month)
      .maybeSingle();
    if (data) {
      ocrMonthSpend = data.spend_cents ?? 0;
      ocrMonthReq = data.request_count ?? 0;
    }
  } catch (e) {
    console.warn("[admin-queries] ocr budget failed", e);
  }

  let conciergeRequests = 0;
  try {
    const { data } = await admin
      .from("toritavi_concierge_usage")
      .select("requests_count")
      .eq("day", today);
    if (data) conciergeRequests = data.reduce((a, r) => a + (r.requests_count ?? 0), 0);
  } catch (e) {
    console.warn("[admin-queries] concierge usage failed", e);
  }

  let conciergeMonthSpend = 0;
  let conciergeMonthReq = 0;
  try {
    const { data } = await admin
      .from("toritavi_concierge_budget")
      .select("spend_cents, request_count")
      .eq("month", month)
      .maybeSingle();
    if (data) {
      conciergeMonthSpend = data.spend_cents ?? 0;
      conciergeMonthReq = data.request_count ?? 0;
    }
  } catch (e) {
    console.warn("[admin-queries] concierge budget failed", e);
  }

  return {
    totals: { users: totalUsers, journeys, steps },
    today: { activeUsers: activeToday, ocrRequests, conciergeRequests },
    ocr: { monthSpendCents: ocrMonthSpend, monthRequests: ocrMonthReq },
    concierge: {
      monthSpendCents: conciergeMonthSpend,
      monthRequests: conciergeMonthReq,
    },
  };
}

// ================================================================
// Users list / detail
// ================================================================

export type AdminUserListRow = {
  id: string;
  email: string | null;
  emailMasked: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  journeyCount: number;
  ocrRequestsToday: number;
  conciergeRequestsToday: number;
};

export type AdminUserListResult = {
  page: number;
  perPage: number;
  total: number;
  rows: AdminUserListRow[];
};

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at <= 0) return "****";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visibleLocal = local.length <= 2 ? local[0] + "*" : local.slice(0, 2) + "***";
  const dotIdx = domain.lastIndexOf(".");
  let maskedDomain = domain;
  if (dotIdx > 0) {
    const base = domain.slice(0, dotIdx);
    const tld = domain.slice(dotIdx);
    const visibleBase = base.length <= 2 ? base[0] + "*" : base.slice(0, 1) + "***";
    maskedDomain = `${visibleBase}${tld}`;
  }
  return `${visibleLocal}@${maskedDomain}`;
}

export async function fetchAdminUserList(
  opts: { page?: number; perPage?: number; query?: string } = {}
): Promise<AdminUserListResult> {
  const admin = createServiceClient();
  const perPage = Math.min(Math.max(opts.perPage ?? 100, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const query = (opts.query ?? "").trim();

  // Pull a window of users. supabase admin API doesn't support email
  // LIKE filtering, so for the query branch we pull the first N pages
  // and filter client-side (good enough while user count is small).
  let users: Array<{
    id: string;
    email?: string | null;
    created_at?: string;
    last_sign_in_at?: string | null;
  }> = [];
  let total = 0;

  try {
    if (query) {
      // If the query looks like a UUID, try direct lookup first.
      const uuidish = /^[0-9a-f-]{8,}$/i.test(query);
      if (uuidish) {
        const { data } = await admin.auth.admin.getUserById(query);
        if (data?.user) {
          users = [{
            id: data.user.id,
            email: data.user.email,
            created_at: data.user.created_at,
            last_sign_in_at: data.user.last_sign_in_at,
          }];
          total = 1;
        }
      }
      if (users.length === 0) {
        const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const all = data?.users ?? [];
        const q = query.toLowerCase();
        const filtered = all.filter((u) =>
          (u.email ?? "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
        );
        total = filtered.length;
        users = filtered.slice((page - 1) * perPage, page * perPage).map((u) => ({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
        }));
      }
    } else {
      const { data } = await admin.auth.admin.listUsers({ page, perPage });
      users = (data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }));
      // @ts-expect-error supabase exposes `total` on the payload
      total = (data && (data.total ?? 0)) as number;
    }
  } catch (e) {
    console.warn("[admin-queries] fetchAdminUserList failed", e);
    return { page, perPage, total: 0, rows: [] };
  }

  if (users.length === 0) {
    return { page, perPage, total, rows: [] };
  }

  const ids = users.map((u) => u.id);
  const today = todayStr();

  // Batch-fetch per-user aggregates. Individual calls are fine for
  // per-page counts (≤200 rows per table).
  const [journeysRes, ocrRes, conciergeRes] = await Promise.all([
    admin.from("toritavi_journeys").select("user_id").in("user_id", ids),
    admin
      .from("toritavi_ocr_usage")
      .select("user_id, requests_count")
      .eq("day", today)
      .in("user_id", ids),
    admin
      .from("toritavi_concierge_usage")
      .select("user_id, requests_count")
      .eq("day", today)
      .in("user_id", ids),
  ]);

  const journeyCountBy = new Map<string, number>();
  for (const j of journeysRes.data ?? []) {
    const uid = (j as { user_id: string }).user_id;
    journeyCountBy.set(uid, (journeyCountBy.get(uid) ?? 0) + 1);
  }
  const ocrBy = new Map<string, number>();
  for (const r of ocrRes.data ?? []) {
    const row = r as { user_id: string; requests_count: number };
    ocrBy.set(row.user_id, (ocrBy.get(row.user_id) ?? 0) + (row.requests_count ?? 0));
  }
  const conciergeBy = new Map<string, number>();
  for (const r of conciergeRes.data ?? []) {
    const row = r as { user_id: string; requests_count: number };
    conciergeBy.set(row.user_id, (conciergeBy.get(row.user_id) ?? 0) + (row.requests_count ?? 0));
  }

  const rows: AdminUserListRow[] = users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    emailMasked: maskEmail(u.email),
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    journeyCount: journeyCountBy.get(u.id) ?? 0,
    ocrRequestsToday: ocrBy.get(u.id) ?? 0,
    conciergeRequestsToday: conciergeBy.get(u.id) ?? 0,
  }));

  return { page, perPage, total, rows };
}

export type AdminUserDetail = {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  settings: {
    displayName: string | null;
    timezone: string | null;
    defaultOrigin: string | null;
    emergencyContact: string | null;
    avatarUrl: string | null;
    updatedAt: string | null;
  } | null;
  counts: {
    journeys: number;
    steps: number;
  };
  usage: {
    ocrRequestsToday: number;
    conciergeRequestsToday: number;
  };
  adminRole: string | null;
  recentJourneys: Array<{
    id: string;
    title: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  recentAuditLogs: Array<{
    id: string;
    action: string;
    actor_role: string | null;
    summary: string | null;
    created_at: string;
  }>;
};

export async function fetchAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const admin = createServiceClient();

  let user: { id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null } | null = null;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    user = {
      id: data.user.id,
      email: data.user.email ?? null,
      created_at: data.user.created_at,
      last_sign_in_at: data.user.last_sign_in_at ?? null,
      email_confirmed_at: data.user.email_confirmed_at ?? null,
    };
  } catch (e) {
    console.warn("[admin-queries] getUserById failed", e);
    return null;
  }

  const today = todayStr();

  const [settingsRes, journeyCountRes, stepCountRes, ocrRes, conciergeRes, recentJourneysRes, adminMemberRes, auditRes] = await Promise.all([
    admin
      .from("toritavi_user_settings")
      .select("display_name, timezone, default_origin, emergency_contact, avatar_url, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("toritavi_journeys").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("toritavi_steps").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin
      .from("toritavi_ocr_usage")
      .select("requests_count")
      .eq("user_id", userId)
      .eq("day", today)
      .maybeSingle(),
    admin
      .from("toritavi_concierge_usage")
      .select("requests_count")
      .eq("user_id", userId)
      .eq("day", today)
      .maybeSingle(),
    admin
      .from("toritavi_journeys")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10),
    admin
      .from("toritavi_admin_members")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("toritavi_admin_audit_logs")
      .select("id, action, actor_role, summary, created_at")
      .eq("target_type", "user")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const settings = settingsRes.data
    ? {
        displayName: (settingsRes.data as { display_name: string | null }).display_name,
        timezone: (settingsRes.data as { timezone: string | null }).timezone,
        defaultOrigin: (settingsRes.data as { default_origin: string | null }).default_origin,
        emergencyContact: (settingsRes.data as { emergency_contact: string | null }).emergency_contact,
        avatarUrl: (settingsRes.data as { avatar_url: string | null }).avatar_url,
        updatedAt: (settingsRes.data as { updated_at: string | null }).updated_at,
      }
    : null;

  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    settings,
    counts: {
      journeys: journeyCountRes.count ?? 0,
      steps: stepCountRes.count ?? 0,
    },
    usage: {
      ocrRequestsToday: (ocrRes.data as { requests_count?: number } | null)?.requests_count ?? 0,
      conciergeRequestsToday: (conciergeRes.data as { requests_count?: number } | null)?.requests_count ?? 0,
    },
    adminRole: (adminMemberRes.data as { role?: string } | null)?.role ?? null,
    recentJourneys: (recentJourneysRes.data ?? []) as AdminUserDetail["recentJourneys"],
    recentAuditLogs: (auditRes.data ?? []) as AdminUserDetail["recentAuditLogs"],
  };
}
