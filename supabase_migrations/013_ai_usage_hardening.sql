-- ============================================================
-- Toritavi: AI usage RPC ハードニング（セキュリティ監査 / HIGH 対応）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- ⚠️ 2026-07-20 追記（再実行の安全性について）:
--   本ファイルは当初 day を CURRENT_DATE(UTC) で記録していた。その後、日次リセットを
--   JST 基準へ移行したため、旧版のまま再実行すると **JST 修正が黙って巻き戻り、
--   毎日 0:00〜9:00 の 9 時間 OCR 上限が無効になる** 状態だった。
--   「Safe to re-run」と書いてあるファイルが実は危険、という最悪の組み合わせだったので、
--   本体を JST に修正して再実行しても正しくなるようにした（禁止ではなく無害化）。
--   ・読み取り側と必ず一致させること: ~/Dev/toritavi/app/src/lib/ai-guard.ts の jstToday()
--   ・変更順序は SQL(書き) → コード(読み)。逆順だと上限が効かない時間帯ができる
--   ・月次キー(v_month)は UTC のまま。TS 側も UTC で月を読むため揃っている
--   なお本ファイルに GRANT は無いので、再実行しても 019 の権限剥奪は巻き戻らない
--   （CREATE OR REPLACE FUNCTION は既存の所有者・権限を保持する）。
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
  v_month   DATE := date_trunc('month', CURRENT_DATE)::DATE;  -- 月次は UTC（TS 側と一致）
  -- 日次キーは日本時間。セッション TZ に依存しないよう明示変換する。
  v_day     DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;

  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (v_user_id, v_day, 1, p_tokens_in + p_tokens_out, now())
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
  v_month   DATE := date_trunc('month', CURRENT_DATE)::DATE;  -- 月次は UTC（TS 側と一致）
  -- 日次キーは日本時間。OCR と揃える（読み取りの jstToday() は両機能で共通）。
  v_day     DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;

  INSERT INTO toritavi_concierge_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (v_user_id, v_day, 1, p_tokens_in + p_tokens_out, now())
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
