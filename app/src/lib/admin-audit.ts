/**
 * Admin audit log helpers — server-only.
 *
 * Writes into toritavi_admin_audit_logs via the service-role client.
 * RLS denies reads/writes for regular authenticated sessions, so the
 * table is append-only from the perspective of the admin console.
 *
 * Never import from a "use client" file.
 */
import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase-service";
import type { AdminContext } from "@/lib/admin-auth";

export type AuditEntry = {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Record a single audit entry. Failures are logged but do NOT throw —
 * audit failures must never break the admin flow itself. Callers that
 * need stronger guarantees can await and inspect the returned boolean.
 */
export async function recordAuditLog(
  actor: AdminContext,
  entry: AuditEntry
): Promise<boolean> {
  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[admin-audit] service client unavailable", e);
    return false;
  }

  const row = {
    actor_user_id: actor.userId,
    actor_role: actor.role,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    summary: entry.summary ?? null,
    ip_hash: hashIp(entry.ip),
    user_agent: entry.userAgent ?? null,
  };

  const { error } = await admin.from("toritavi_admin_audit_logs").insert(row);
  if (error) {
    console.error("[admin-audit] insert failed", error);
    return false;
  }
  return true;
}

export type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  created_at: string;
};

/**
 * Fetch the most recent audit log entries (service-role, unrestricted
 * by RLS). Only call from an already-authorised admin context.
 */
export async function fetchRecentAuditLogs(limit = 50): Promise<AuditLogRow[]> {
  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[admin-audit] service client unavailable", e);
    return [];
  }

  const { data, error } = await admin
    .from("toritavi_admin_audit_logs")
    .select("id, actor_user_id, actor_role, action, target_type, target_id, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[admin-audit] select failed", error);
    return [];
  }
  return (data ?? []) as AuditLogRow[];
}
