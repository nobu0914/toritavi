-- ============================================================
-- Toritavi: admin_members table
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
-- Stores which auth users are allowed into /admin and with what role.
-- This table is the single source of truth for admin authorisation.
-- Role resolution is done server-side only (see app/src/lib/admin-auth.ts).
--
-- Roles:
--   - support_viewer   : read-only access to admin console
--   - support_operator : viewer + limited ops (e.g. notes, soft actions)
--   - super_admin      : all of the above + destructive / config actions
--
-- SECURITY NOTES:
--   1. RLS: authenticated users may only SELECT their own row. They can
--      never see the full roster, and they cannot write at all. All
--      membership changes go through the service-role client (or direct
--      SQL by the project owner).
--   2. First super_admin seed: after running this migration, bootstrap
--      the very first admin with the manual SQL at the bottom of this
--      file. Do it once, then never commit that SQL with real values.
-- ============================================================

CREATE TABLE IF NOT EXISTS toritavi_admin_members (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('support_viewer', 'support_operator', 'super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_toritavi_admin_members_role
  ON toritavi_admin_members (role);

ALTER TABLE toritavi_admin_members ENABLE ROW LEVEL SECURITY;

-- Defensive drops in case an earlier attempt left permissive policies.
DROP POLICY IF EXISTS "allow all" ON toritavi_admin_members;
DROP POLICY IF EXISTS "toritavi_admin_members_self_read" ON toritavi_admin_members;

-- A logged-in user can read their own admin row only. This is the ONLY
-- policy for authenticated users. Writes go through service-role.
CREATE POLICY "toritavi_admin_members_self_read"
  ON toritavi_admin_members FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- ONE-TIME SEED (run manually once, do NOT commit with real UUID)
-- ============================================================
-- Replace the email below with the user that should become the first
-- super_admin, then run in the Supabase SQL Editor:
--
--   INSERT INTO toritavi_admin_members (user_id, role, created_by)
--   SELECT id, 'super_admin', id
--     FROM auth.users
--    WHERE email = 'REPLACE_ME@example.com'
--   ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
--
-- After the first super_admin exists, use it to grant further members
-- via the admin console (once that UI is implemented) or via SQL.
