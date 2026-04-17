-- ============================================================
-- Toritavi: add user_id + RLS to journey tables
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
-- This wipes existing toritavi data (confirmed OK — pre-launch MVP).
-- ============================================================

-- 1. Wipe existing (pre-auth) data
TRUNCATE toritavi_steps, toritavi_journeys RESTART IDENTITY CASCADE;

-- 2. Add user_id column
ALTER TABLE toritavi_journeys
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE toritavi_steps
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Make user_id required going forward
ALTER TABLE toritavi_journeys ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE toritavi_steps ALTER COLUMN user_id SET NOT NULL;

-- 4. Indexes for per-user queries
CREATE INDEX IF NOT EXISTS idx_toritavi_journeys_user ON toritavi_journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_toritavi_steps_user ON toritavi_steps(user_id);

-- 5. Enable Row Level Security
ALTER TABLE toritavi_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_steps ENABLE ROW LEVEL SECURITY;

-- 6. Drop any prior permissive policies (from pre-auth setup)
DROP POLICY IF EXISTS "allow all" ON toritavi_journeys;
DROP POLICY IF EXISTS "allow all" ON toritavi_steps;
DROP POLICY IF EXISTS "toritavi_journeys_own" ON toritavi_journeys;
DROP POLICY IF EXISTS "toritavi_steps_own" ON toritavi_steps;

-- 7. RLS policies: users only see/modify their own data
CREATE POLICY "toritavi_journeys_own"
  ON toritavi_journeys FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "toritavi_steps_own"
  ON toritavi_steps FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
