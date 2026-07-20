-- ============================================================
-- Toritavi: AI 利用記録 RPC のサーバー専有化（セキュリティ監査 / 中 対応）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- 課題（013 で「pre-launch 推奨」として残していた宿題）:
--   increment_ocr_usage / increment_concierge_usage は
--   `GRANT EXECUTE ... TO authenticated`（005:99 / 004:133）のため、
--   ログイン済みの任意ユーザーが PostgREST 経由で直接呼べる。
--     POST /rest/v1/rpc/increment_ocr_usage {"p_cost_cents": 2000000000, ...}
--   月予算テーブル(toritavi_ocr_budget / toritavi_concierge_budget)は
--   month のみをキーとする**全ユーザー共有**カウンタで、ai-guard.ts は
--   spend_cents >= 予算 で 503 を返す。よって単一ユーザーが巨大な
--   p_cost_cents を1回送るだけで、全利用者の OCR / コンシェルジュを停止できる。
--   013 は負値のみを塞いでおり、巨大な正値は素通りする。
--
-- 対策:
--   (1) p_user_id を明示的に受け取る service_role 専用の関数を新設。
--       auth.uid() ではなくサーバが検証済みのユーザーIDを渡す。
--   (2) 旧シグネチャ（authenticated 向け）の EXECUTE 権限を剥奪。
--
-- ⚠️ 適用手順（順序厳守。逆にすると AI 機能が一時停止する）:
--   1. 本ファイルの【フェーズ1】だけを先に実行（新関数の追加。既存は無傷）
--   2. Web(API) を新関数を呼ぶコードでデプロイ
--   3. 動作確認後に【フェーズ2】を実行（旧権限の剥奪）
-- ============================================================

-- ============================================================
-- 【フェーズ1】service_role 専用の新シグネチャを追加（既存関数は温存）
-- ============================================================

CREATE OR REPLACE FUNCTION increment_ocr_usage_srv(
  p_user_id UUID, p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_cents INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;
  -- サーバ側の見積り誤り・改ざんが共有予算を一撃で焼き切らないよう上限を設ける
  -- （1リクエストで $10 を超えるコストは実運用ではあり得ない）。
  IF p_cost_cents > 1000 THEN RAISE EXCEPTION 'cost_cents out of range'; END IF;

  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, CURRENT_DATE, 1, p_tokens_in + p_tokens_out, now())
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

  INSERT INTO toritavi_ocr_events (user_id) VALUES (p_user_id);
  DELETE FROM toritavi_ocr_events
   WHERE user_id = p_user_id AND created_at < now() - INTERVAL '30 days';
END; $$;

CREATE OR REPLACE FUNCTION increment_concierge_usage_srv(
  p_user_id UUID, p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_cents INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;
  IF p_cost_cents > 1000 THEN RAISE EXCEPTION 'cost_cents out of range'; END IF;

  INSERT INTO toritavi_concierge_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, CURRENT_DATE, 1, p_tokens_in + p_tokens_out, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count = toritavi_concierge_usage.requests_count + 1,
    tokens_total   = toritavi_concierge_usage.tokens_total + p_tokens_in + p_tokens_out,
    last_request_at = now();

  INSERT INTO toritavi_concierge_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, 1)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents   = toritavi_concierge_budget.spend_cents + p_cost_cents,
    request_count = toritavi_concierge_budget.request_count + 1,
    updated_at    = now();
END; $$;

-- 新関数は service_role のみ実行可（anon / authenticated には出さない）。
REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION increment_concierge_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_concierge_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION increment_concierge_usage_srv(UUID, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_concierge_usage_srv(UUID, INTEGER, INTEGER, INTEGER) TO service_role;


-- ============================================================
-- 【フェーズ2】新コードのデプロイ・動作確認が済んでから実行すること。
-- 旧シグネチャから authenticated の実行権限を剥奪する。
-- （実行するまでは、巨大 p_cost_cents による全体停止が可能なままになる）
-- ============================================================
-- REVOKE EXECUTE ON FUNCTION increment_ocr_usage(INTEGER, INTEGER, INTEGER) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION increment_concierge_usage(INTEGER, INTEGER, INTEGER) FROM authenticated;
--
-- 剥奪後の確認（0 行になること）:
-- SELECT p.proname, r.rolname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('increment_ocr_usage','increment_concierge_usage')
--    AND r.rolname = 'authenticated'
--    AND a.privilege_type = 'EXECUTE';
