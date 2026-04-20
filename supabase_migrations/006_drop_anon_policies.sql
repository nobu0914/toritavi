-- ============================================================
-- Toritavi: drop leftover "allow anonymous" policies
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
-- ============================================================
--
-- Context: 001_add_user_id.sql attempted to drop pre-auth permissive
-- policies but targeted the wrong name ("allow all"). The actual name
-- in production was "Allow anonymous access to journeys/steps", so the
-- policies survived and fully opened journeys + steps to public.
-- This migration removes them by their real names and verifies the
-- only remaining policy is the authenticated-scoped one.
--

DROP POLICY IF EXISTS "Allow anonymous access to journeys" ON toritavi_journeys;
DROP POLICY IF EXISTS "Allow anonymous access to steps"    ON toritavi_steps;

-- Verify (should return 2 rows, both scoped to {authenticated})
SELECT tablename, policyname, roles, qual
  FROM pg_policies
 WHERE tablename IN ('toritavi_journeys','toritavi_steps')
 ORDER BY tablename, policyname;
