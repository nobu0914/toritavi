-- ============================================================
-- Toritavi: user_settings table
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
-- Stores per-user profile + notification preferences.
-- ============================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS toritavi_user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  timezone TEXT,
  default_origin TEXT,
  emergency_contact TEXT,
  avatar_url TEXT,
  notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION toritavi_user_settings_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_toritavi_user_settings_updated_at ON toritavi_user_settings;
CREATE TRIGGER trg_toritavi_user_settings_updated_at
  BEFORE UPDATE ON toritavi_user_settings
  FOR EACH ROW EXECUTE FUNCTION toritavi_user_settings_touch_updated_at();

-- 3. RLS
ALTER TABLE toritavi_user_settings ENABLE ROW LEVEL SECURITY;

-- Drop any prior permissive policies (defence-in-depth — see session log 006)
DROP POLICY IF EXISTS "allow all" ON toritavi_user_settings;
DROP POLICY IF EXISTS "toritavi_user_settings_own" ON toritavi_user_settings;

-- Authenticated users can only read/write their own row.
CREATE POLICY "toritavi_user_settings_own"
  ON toritavi_user_settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
