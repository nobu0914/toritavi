-- ============================================================
-- Toritavi: allow unfiled steps (journey_id IS NULL)
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
-- Context (Flow A, 2026-04-20):
--   After OCR we now prompt "どこに入れる？" with 3 choices:
--     - new journey        (creates a journey, attaches steps)
--     - existing journey   (appends steps to a chosen journey)
--     - unfiled            (parks the step for later triage)
--
--   The unfiled bucket is modelled by allowing toritavi_steps.journey_id
--   to be NULL. The existing per-user RLS on toritavi_steps stays
--   correct because it pins reads/writes by user_id, not journey_id —
--   so a NULL journey_id does NOT loosen the ACL.
--
--   getJourneys() (app/src/lib/store-supabase.ts) LEFT-JOINs via
--   foreign-key relation, so NULL-journey rows are naturally excluded
--   from regular journey listings.
-- ============================================================

-- 1. Drop NOT NULL on journey_id
ALTER TABLE toritavi_steps
  ALTER COLUMN journey_id DROP NOT NULL;

-- 2. Partial index for unfiled lookups (per-user "give me my unfiled bucket")
--    Note: RLS filters by auth.uid() = user_id, so the index is correct
--    to include user_id for cheap per-user scans.
CREATE INDEX IF NOT EXISTS idx_toritavi_steps_unfiled_by_user
  ON toritavi_steps (user_id, created_at DESC)
  WHERE journey_id IS NULL;

-- 3. Sanity: make sure the existing per-user policy still covers
--    inserts / updates / deletes with journey_id = NULL. The policy
--    from migration 001 uses `auth.uid() = user_id` which is
--    journey-agnostic, so this is a no-op — included here as a
--    reminder that removing NOT NULL did not open a new surface.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'toritavi_steps'
      AND policyname = 'toritavi_steps_own'
  ) THEN
    RAISE NOTICE 'toritavi_steps_own policy missing — unfiled rows would be unreadable. Run migration 001 first.';
  END IF;
END $$;
