-- ============================================================
-- Toritavi: drop obsolete device_id column
-- Run this in the Supabase SQL Editor of the "genbox2" project.
--
-- Context: device_id was used before auth was introduced to separate
-- data per browser. Since 001_add_user_id.sql moved us to user_id + RLS,
-- device_id is orphaned, and its NOT NULL constraint now blocks all
-- journey inserts from the new code path.
-- ============================================================

-- 1. Drop the per-device index (depends on the column)
DROP INDEX IF EXISTS idx_journeys_device;

-- 2. Drop the column itself
ALTER TABLE toritavi_journeys DROP COLUMN IF EXISTS device_id;
