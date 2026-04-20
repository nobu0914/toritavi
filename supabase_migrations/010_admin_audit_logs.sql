-- ============================================================
-- Toritavi: admin_audit_logs table
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
-- Append-only log of admin-console activity. Inserted by server routes
-- (via service-role) whenever an admin performs a notable action:
--   - admin console reached
--   - a user detail viewed
--   - settings changed (future)
--   - destructive operations (future)
--
-- Reads are restricted: an admin can only read logs via the admin API,
-- which in turn uses the service-role client. Individual authenticated
-- users (even admins in their own session) cannot SELECT this table
-- directly — RLS denies it.
-- ============================================================

CREATE TABLE IF NOT EXISTS toritavi_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toritavi_admin_audit_logs_created_at
  ON toritavi_admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_toritavi_admin_audit_logs_actor
  ON toritavi_admin_audit_logs (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_toritavi_admin_audit_logs_target
  ON toritavi_admin_audit_logs (target_type, target_id, created_at DESC);

ALTER TABLE toritavi_admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Defensive drops — no policy for authenticated/anon at all. Only the
-- service-role bypasses RLS, so admin API is the single reader/writer.
DROP POLICY IF EXISTS "allow all" ON toritavi_admin_audit_logs;
DROP POLICY IF EXISTS "toritavi_admin_audit_logs_self_read" ON toritavi_admin_audit_logs;
