-- ============================================================
-- Toritavi: AI Concierge — threads / messages / usage / budget
-- Run this in the Supabase SQL Editor of the "genbox2" project.
-- Safe to re-run (CREATE TABLE IF NOT EXISTS / CREATE POLICY IF NOT EXISTS).
-- DS v2 §15 参照
-- ============================================================

-- 1. Threads: 1 スレッド = 1 会話セッション（Journey を context として紐付け可）
CREATE TABLE IF NOT EXISTS toritavi_concierge_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  -- 参照中 Journey ID 配列（JSON）。空配列 = 全体に対する質問。
  context_journey_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_threads_user
  ON toritavi_concierge_threads(user_id, updated_at DESC);

-- 2. Messages: 1 メッセージ = 1 発話 (user / assistant / tool)
CREATE TABLE IF NOT EXISTS toritavi_concierge_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES toritavi_concierge_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  -- プレーンテキスト部分（マスク済み、PII 含まない）
  content TEXT,
  -- assistant が提案した tool_use（Claude の content block そのまま）
  tool_use JSONB,
  -- ユーザー確定後の tool_result（name / ok / details）
  tool_result JSONB,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_messages_thread
  ON toritavi_concierge_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_concierge_messages_user_recent
  ON toritavi_concierge_messages(user_id, created_at DESC);

-- 3. Usage: ユーザー別の日次カウンタ（日跨ぎで自然にリセット）
CREATE TABLE IF NOT EXISTS toritavi_concierge_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests_count INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- 4. Budget: 月次の全体予算
CREATE TABLE IF NOT EXISTS toritavi_concierge_budget (
  month DATE PRIMARY KEY,
  spend_cents INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. RLS
ALTER TABLE toritavi_concierge_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_concierge_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_concierge_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_concierge_budget   ENABLE ROW LEVEL SECURITY;

-- 古いポリシー削除（再実行時の冪等性）
DROP POLICY IF EXISTS "own threads select"  ON toritavi_concierge_threads;
DROP POLICY IF EXISTS "own threads modify"  ON toritavi_concierge_threads;
DROP POLICY IF EXISTS "own messages select" ON toritavi_concierge_messages;
DROP POLICY IF EXISTS "own messages modify" ON toritavi_concierge_messages;
DROP POLICY IF EXISTS "own usage select"    ON toritavi_concierge_usage;
DROP POLICY IF EXISTS "read budget"         ON toritavi_concierge_budget;

CREATE POLICY "own threads select" ON toritavi_concierge_threads
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own threads modify" ON toritavi_concierge_threads
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own messages select" ON toritavi_concierge_messages
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own messages modify" ON toritavi_concierge_messages
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own usage select" ON toritavi_concierge_usage
  FOR SELECT USING (user_id = auth.uid());

-- budget は読み取り許可のみ（クライアントで「停止中」表示するために select 可能）
CREATE POLICY "read budget" ON toritavi_concierge_budget
  FOR SELECT USING (true);

-- 6. 使用量インクリメント RPC
--    SECURITY DEFINER で budget テーブルの RLS を跨ぐが、呼び出し者は必ず
--    auth.uid() ベースに縛る（他人の usage を操作不能）。
CREATE OR REPLACE FUNCTION increment_concierge_usage(
  p_tokens_in INTEGER,
  p_tokens_out INTEGER,
  p_cost_cents INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_month   DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO toritavi_concierge_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (v_user_id, CURRENT_DATE, 1, p_tokens_in + p_tokens_out, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count = toritavi_concierge_usage.requests_count + 1,
    tokens_total   = toritavi_concierge_usage.tokens_total + p_tokens_in + p_tokens_out,
    last_request_at = now();

  INSERT INTO toritavi_concierge_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, 1)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents  = toritavi_concierge_budget.spend_cents + p_cost_cents,
    request_count = toritavi_concierge_budget.request_count + 1,
    updated_at   = now();
END;
$$;

-- authenticated ユーザーから直接 RPC 可能（Route Handler は cookie 経由で
-- authenticated として Supabase を叩く）。anon は拒否。
REVOKE ALL ON FUNCTION increment_concierge_usage(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_concierge_usage(INTEGER, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION increment_concierge_usage(INTEGER, INTEGER, INTEGER) TO authenticated;
