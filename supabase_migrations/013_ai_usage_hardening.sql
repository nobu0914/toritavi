-- ============================================================
-- Toritavi: AI usage RPC ハードニング（セキュリティ監査 / HIGH 対応）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- 課題: increment_ocr_usage / increment_concierge_usage は GRANT EXECUTE ... TO
-- authenticated。PostgREST 経由で任意のログインユーザーが直接呼べる上、引数の符号
-- 検証が無い。負の p_cost_cents を渡すと共有の月予算カウンタ(spend_cents)を際限なく
-- 減らせ、月予算ハードキャップ(= Anthropic 課金の唯一の上限)を無効化できる。
-- 対策: (1) 関数冒頭で負値を拒否、(2) budget/usage に CHECK(>=0) で多重防御。
-- ※ さらに堅牢にするなら authenticated への GRANT を REVOKE し、ルートから
--    service_role で呼ぶ(サーバ専有化)＝pre-launch 推奨。本パッチは挙動を変えずに
--    悪用経路を塞ぐ最小対応。
-- ============================================================

-- (1) 負値ガードを追加（本体ロジックは既存どおり）
CREATE OR REPLACE FUNCTION increment_ocr_usage(
  p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_cents INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_month   DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
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
  DELETE FROM toritavi_ocr_events
   WHERE user_id = v_user_id AND created_at < now() - INTERVAL '30 days';
END; $$;

CREATE OR REPLACE FUNCTION increment_concierge_usage(
  p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_cents INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_month   DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
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
END; $$;

-- (2) 多重防御: 負値による破壊を DB レベルでも拒否（再実行安全）
ALTER TABLE toritavi_ocr_budget       DROP CONSTRAINT IF EXISTS chk_ocr_budget_nonneg;
ALTER TABLE toritavi_ocr_budget       ADD  CONSTRAINT chk_ocr_budget_nonneg       CHECK (spend_cents >= 0 AND request_count >= 0);
ALTER TABLE toritavi_ocr_usage        DROP CONSTRAINT IF EXISTS chk_ocr_usage_nonneg;
ALTER TABLE toritavi_ocr_usage        ADD  CONSTRAINT chk_ocr_usage_nonneg        CHECK (requests_count >= 0 AND tokens_total >= 0);
ALTER TABLE toritavi_concierge_budget DROP CONSTRAINT IF EXISTS chk_concierge_budget_nonneg;
ALTER TABLE toritavi_concierge_budget ADD  CONSTRAINT chk_concierge_budget_nonneg CHECK (spend_cents >= 0 AND request_count >= 0);
ALTER TABLE toritavi_concierge_usage  DROP CONSTRAINT IF EXISTS chk_concierge_usage_nonneg;
ALTER TABLE toritavi_concierge_usage  ADD  CONSTRAINT chk_concierge_usage_nonneg  CHECK (requests_count >= 0 AND tokens_total >= 0);
