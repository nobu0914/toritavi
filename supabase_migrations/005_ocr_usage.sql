-- ============================================================
-- Toritavi: OCR API usage / budget / per-minute events
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
-- Supplements /api/ocr route-level guards added in the same PR.
-- ============================================================

-- 1. Usage: ユーザー別の日次カウンタ
CREATE TABLE IF NOT EXISTS toritavi_ocr_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests_count INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- 2. Budget: 月次の全体予算（OCR は Sonnet なので Concierge より高価）
CREATE TABLE IF NOT EXISTS toritavi_ocr_budget (
  month DATE PRIMARY KEY,
  spend_cents INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Events: 分レート制限に使う軽量履歴（Concierge は messages 流用、OCR は
--    dialog を持たないので専用 events テーブルに timestamp だけ積む）
CREATE TABLE IF NOT EXISTS toritavi_ocr_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocr_events_user_recent
  ON toritavi_ocr_events(user_id, created_at DESC);

-- 4. RLS
ALTER TABLE toritavi_ocr_usage  ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_ocr_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE toritavi_ocr_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own ocr usage select"  ON toritavi_ocr_usage;
DROP POLICY IF EXISTS "read ocr budget"       ON toritavi_ocr_budget;
DROP POLICY IF EXISTS "own ocr events select" ON toritavi_ocr_events;

CREATE POLICY "own ocr usage select" ON toritavi_ocr_usage
  FOR SELECT USING (user_id = auth.uid());

-- budget は読み取り許可のみ（クライアントで「月上限に達した」表示するため）
CREATE POLICY "read ocr budget" ON toritavi_ocr_budget
  FOR SELECT USING (true);

CREATE POLICY "own ocr events select" ON toritavi_ocr_events
  FOR SELECT USING (user_id = auth.uid());

-- 5. 使用量 + イベントインクリメント RPC
--    Concierge と同じ SECURITY DEFINER パターン。auth.uid() 必須。
CREATE OR REPLACE FUNCTION increment_ocr_usage(
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

  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (v_user_id, CURRENT_DATE, 1, p_tokens_in + p_tokens_out, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count = toritavi_ocr_usage.requests_count + 1,
    tokens_total   = toritavi_ocr_usage.tokens_total + p_tokens_in + p_tokens_out,
    last_request_at = now();

  INSERT INTO toritavi_ocr_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, 1)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents   = toritavi_ocr_budget.spend_cents + p_cost_cents,
    request_count = toritavi_ocr_budget.request_count + 1,
    updated_at    = now();

  INSERT INTO toritavi_ocr_events (user_id) VALUES (v_user_id);

  -- 30日以上古い events は掃除（コスト削減）
  DELETE FROM toritavi_ocr_events
   WHERE user_id = v_user_id
     AND created_at < now() - INTERVAL '30 days';
END;
$$;

REVOKE ALL ON FUNCTION increment_ocr_usage(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_ocr_usage(INTEGER, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION increment_ocr_usage(INTEGER, INTEGER, INTEGER) TO authenticated;
