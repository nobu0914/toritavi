-- ============================================================
-- Toritavi: 利用者プラン（AI 制限の階層化 / P1）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
-- Supplements ai-guard.ts (enforceAiLimits / getAiUsage) plan resolution.
--
-- 行が無いユーザーは 'free' 扱い（ai-guard.resolvePlan のフォールバック）。
-- このテーブル適用前でも全員 free = 現行挙動のまま安全に動く。
-- 昇格(pro)は service_role / 管理コンソールからのみ（本人は変更不可）。
-- ============================================================

CREATE TABLE IF NOT EXISTS toritavi_user_plan (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE toritavi_user_plan ENABLE ROW LEVEL SECURITY;

-- 本人は自分のプランを読めるだけ（/api/ai-usage 表示用）。
DROP POLICY IF EXISTS "read own plan" ON toritavi_user_plan;
CREATE POLICY "read own plan" ON toritavi_user_plan
  FOR SELECT USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE ポリシーは作らない＝anon/authenticated は変更不可。
-- 付与は service_role（管理コンソール / SQL）でのみ:
--   INSERT INTO toritavi_user_plan (user_id, plan)
--   VALUES ('<uuid>', 'pro')
--   ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now();
