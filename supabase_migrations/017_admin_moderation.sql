-- ============================================================
-- Toritavi: moderation schema (user status + AI rejection log)
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
-- Two tables backing the admin console's moderation features:
--   1. toritavi_user_status  — per-user moderation state. `status` gates
--      access (suspended/banned users are rejected by the API), `flagged`
--      is a non-blocking "under review" marker.
--   2. toritavi_ai_rejections — append-only log of AI/OCR rate-limit /
--      budget rejections, so repeat offenders (規約 第9条6/7/8号) become
--      queryable. Historically rejections were only counted, never stored.
--
-- SECURITY NOTES:
--   - user_status: a logged-in user may SELECT ONLY their own row (so the
--     app can learn it is suspended and show a reason). All writes go
--     through the service-role client from the admin console.
--   - ai_rejections: RLS enabled with NO policies → default-deny for anon
--     and authenticated. Only the service-role reads/writes it.
--   - Enforcement fails OPEN: if these tables are missing or a lookup
--     errors, the API does NOT block the user (see src/lib/moderation.ts).
--     Deploying the app code before running this migration is therefore
--     safe — nothing is blocked until a row actually says so.
-- ============================================================

-- ---------- 1. user status ----------
CREATE TABLE IF NOT EXISTS toritavi_user_status (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'banned')),
  -- Reason shown to the user when they are blocked (keep it user-facing).
  reason      TEXT,
  -- Internal-only admin memo, never surfaced to the user.
  note        TEXT,
  -- Non-blocking "under review" marker for the abuse dashboard.
  flagged     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toritavi_user_status_status
  ON toritavi_user_status (status) WHERE status <> 'active';
CREATE INDEX IF NOT EXISTS idx_toritavi_user_status_flagged
  ON toritavi_user_status (flagged) WHERE flagged = TRUE;

ALTER TABLE toritavi_user_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "toritavi_user_status_self_read" ON toritavi_user_status;

-- A logged-in user can read ONLY their own status row. Writes go through
-- the service-role client (admin console). No authenticated write policy.
CREATE POLICY "toritavi_user_status_self_read"
  ON toritavi_user_status FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------- 2. AI rejection log ----------
CREATE TABLE IF NOT EXISTS toritavi_ai_rejections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which feature rejected: 'ocr' | 'concierge'.
  feature     TEXT NOT NULL,
  -- Rejection code, mirrors the API error: 'monthly_budget_exceeded' |
  -- 'daily_request_limit' | 'daily_token_limit' | 'rate_limit'.
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toritavi_ai_rejections_user_recent
  ON toritavi_ai_rejections (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toritavi_ai_rejections_recent
  ON toritavi_ai_rejections (created_at DESC);

ALTER TABLE toritavi_ai_rejections ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: default-deny for anon + authenticated. Only the
-- service-role (which bypasses RLS) reads and writes this table.

-- Optional retention: prune rejection rows older than 90 days. Wire this to
-- a scheduled job (pg_cron) if desired:
--   DELETE FROM toritavi_ai_rejections WHERE created_at < NOW() - INTERVAL '90 days';
