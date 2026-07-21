-- ============================================================
-- Toritavi: OCR クォータの月次化 + JST 統一 + ファイル単位カウント
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- 背景:
--   有料プラン（無料 10 件/月・Pro 100 件/月）の導入に伴い、OCR 上限を
--   「日次」から「月次」に変更する。あわせて、調査で見つかった 2 件の欠陥を塞ぐ。
--
--   (A) 日キーの UTC/JST 不一致 — 上限が毎日 9 時間だけ無効
--       019 の increment_ocr_usage_srv は CURRENT_DATE(=UTC) で day を書くが、
--       ai-guard.ts は jstToday() で読む。JST 00:00〜09:00 は UTC 日付がまだ
--       前日なので、書いた行と読む行が一致せず「使用量 0」と誤認される。
--       013 では旧関数(authenticated 版)だけを JST に直しており、019 で新設した
--       *_srv には同じ修正が入っていなかった。
--
--   (B) ファイル数ではなくリクエスト数で数えていた — 上限が最大 10 倍に化ける
--       /api/ocr は MAX_IMAGES=10 まで受けるが、加算は requests_count + 1 のみ。
--       アプリは 1 ファイル 1 リクエストで送るため実害は出ていないが、
--       Web UI (ScanFlow.tsx) は複数枚をまとめて送る実装で、トークンを持つ
--       任意のクライアントも同じことができる。「10 件」が 100 ファイルになる。
--
-- 方針: expand（追加のみ）。旧関数・旧テーブルは温存する。
--   - toritavi_ocr_usage（日次）は**残す**。上限判定からは外れるが、
--     「いつ何件」の分析と不正検知に使うため書き込みは継続する
--   - toritavi_ocr_usage_monthly（新設）が上限判定の正本になる
--   - 月キー・日キーとも JST に統一（TS 側の monthTz 分岐も廃止する）
--
-- ⚠️ 適用順（順序厳守）:
--   1. 本ファイルの【フェーズ1】を実行（新テーブル・新関数の追加。既存は無傷）
--   2. Web(API) を新シグネチャ(p_units 付き)を呼ぶコードでデプロイ
--   3. 動作確認後に【フェーズ2】を実行（旧 4 引数シグネチャの削除）
--
--   ⚠️ 逆順にすると記録が落ちる。フェーズ1 の時点では旧 4 引数版も残るので、
--      デプロイ前でも現行コードは動き続ける（穴は開かない）。
--
-- 正本: toritavi_app/docs/monetization-spec.md
-- ============================================================


-- ============================================================
-- 【フェーズ1】ここから
-- ============================================================

-- 1. 月次カウンタ（上限判定の正本）
CREATE TABLE IF NOT EXISTS toritavi_ocr_usage_monthly (
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month          DATE NOT NULL,          -- JST の月初（例 2026-07-01）
  requests_count INTEGER NOT NULL DEFAULT 0,  -- ★ファイル数（リクエスト数ではない）
  tokens_total   INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

ALTER TABLE toritavi_ocr_usage_monthly ENABLE ROW LEVEL SECURITY;

-- 本人が自分の残量を読めるだけ（005 の日次テーブルと同じ方針）。
-- INSERT/UPDATE/DELETE ポリシーは作らない＝加算は SECURITY DEFINER 関数のみ。
DROP POLICY IF EXISTS "own ocr monthly usage select" ON toritavi_ocr_usage_monthly;
CREATE POLICY "own ocr monthly usage select" ON toritavi_ocr_usage_monthly
  FOR SELECT USING (user_id = auth.uid());


-- 2. 記録 RPC（新シグネチャ: p_units を追加）
--
--    p_units = このリクエストで解析したファイル数。/api/ocr が images.length を渡す。
--    これが (B) の修正。requests_count という列名は互換のため据え置くが、
--    意味は「ファイル数」である（列コメントで明示する）。
CREATE OR REPLACE FUNCTION increment_ocr_usage_srv(
  p_user_id UUID,
  p_tokens_in INTEGER,
  p_tokens_out INTEGER,
  p_cost_cents INTEGER,
  p_units INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- (A) の修正。日キー・月キーとも JST。ai-guard.ts の jstToday() /
  -- jstFirstOfMonth() と対になっている。**片方だけ変えると上限が効かなくなる。**
  v_now_jst TIMESTAMP := (now() AT TIME ZONE 'Asia/Tokyo');
  v_day     DATE := v_now_jst::DATE;
  v_month   DATE := date_trunc('month', v_now_jst)::DATE;
  v_tokens  INTEGER := p_tokens_in + p_tokens_out;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;
  -- サーバ側の見積り誤り・改ざんが共有予算を一撃で焼き切らないよう上限を設ける
  -- （1リクエストで $10 を超えるコストは実運用ではあり得ない）。
  IF p_cost_cents > 1000 THEN RAISE EXCEPTION 'cost_cents out of range'; END IF;
  -- p_units は /api/ocr の MAX_IMAGES と同じ上限で bound する。
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 THEN
    RAISE EXCEPTION 'units out of range';
  END IF;

  -- 月次（上限判定の正本）
  INSERT INTO toritavi_ocr_usage_monthly (user_id, month, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_month, p_units, v_tokens, now())
  ON CONFLICT (user_id, month) DO UPDATE SET
    requests_count  = toritavi_ocr_usage_monthly.requests_count + p_units,
    tokens_total    = toritavi_ocr_usage_monthly.tokens_total + v_tokens,
    last_request_at = now();

  -- 日次（分析・不正検知用。上限判定には使わない）
  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_day, p_units, v_tokens, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count  = toritavi_ocr_usage.requests_count + p_units,
    tokens_total    = toritavi_ocr_usage.tokens_total + v_tokens,
    last_request_at = now();

  -- 月予算（全体共有）。無料ユーザーのみが対象だが、支出の実績は全員分を積む
  -- （プラン別に分けると「今月いくら使ったか」が分からなくなるため）。
  -- 判定側で有料を除外する: ai-guard.ts の enforceAiLimits を参照。
  INSERT INTO toritavi_ocr_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, p_units)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents   = toritavi_ocr_budget.spend_cents + p_cost_cents,
    request_count = toritavi_ocr_budget.request_count + p_units,
    updated_at    = now();

  -- 分レート制限用の履歴（1 リクエスト 1 行のまま。ファイル数ではない）
  INSERT INTO toritavi_ocr_events (user_id) VALUES (p_user_id);
  DELETE FROM toritavi_ocr_events
   WHERE user_id = p_user_id AND created_at < now() - INTERVAL '30 days';
END; $$;

REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;


-- 3. コンシェルジュ側の日キーも JST に揃える（(A) と同じ欠陥）
--    コンシェルジュは Phase 3・フラグ OFF だが、有効化時に同じ穴が開くのを防ぐ。
--    上限は日次のままにする（チャットは日次が自然な単位で、クォータ商品ではない）。
CREATE OR REPLACE FUNCTION increment_concierge_usage_srv(
  p_user_id UUID, p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_cents INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now_jst TIMESTAMP := (now() AT TIME ZONE 'Asia/Tokyo');
  v_day     DATE := v_now_jst::DATE;
  v_month   DATE := date_trunc('month', v_now_jst)::DATE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tokens_in < 0 OR p_tokens_out < 0 OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'invalid usage args';
  END IF;
  IF p_cost_cents > 1000 THEN RAISE EXCEPTION 'cost_cents out of range'; END IF;

  INSERT INTO toritavi_concierge_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_day, 1, p_tokens_in + p_tokens_out, now())
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


-- 4. バックフィル: 既存の日次実績を月次へ集約
--
--    冪等（何度実行しても同じ結果になる。加算ではなく上書き）。
--    既存の day は UTC/JST が混在している((A) の期間があるため)が、月境界の
--    前後 9 時間を除けば同じ月に落ちる。ズレても最大 1 日ぶんで、リリース前の
--    実績しか存在しないため実害はない。
INSERT INTO toritavi_ocr_usage_monthly (user_id, month, requests_count, tokens_total, last_request_at)
SELECT user_id,
       date_trunc('month', day)::DATE,
       SUM(requests_count)::INTEGER,
       SUM(tokens_total)::INTEGER,
       MAX(last_request_at)
  FROM toritavi_ocr_usage
 GROUP BY user_id, date_trunc('month', day)::DATE
ON CONFLICT (user_id, month) DO UPDATE SET
  requests_count  = EXCLUDED.requests_count,
  tokens_total    = EXCLUDED.tokens_total,
  last_request_at = GREATEST(toritavi_ocr_usage_monthly.last_request_at, EXCLUDED.last_request_at);


-- 5. 列の意味を DB 側に残す（コードを読まずに誤解しないため）
COMMENT ON COLUMN toritavi_ocr_usage_monthly.requests_count IS
  'OCR したファイル数（リクエスト数ではない）。無料 10 / Pro 100 が上限。';
COMMENT ON COLUMN toritavi_ocr_usage_monthly.month IS
  'JST の月初。ai-guard.ts の jstFirstOfMonth() と対。';
COMMENT ON TABLE toritavi_ocr_usage IS
  '日次実績（分析・不正検知用）。上限判定は toritavi_ocr_usage_monthly が正本。';


-- 6. 確認クエリ（実行して目視すること）

-- 6-1. 新テーブルができているか
SELECT to_regclass('public.toritavi_ocr_usage_monthly') AS monthly_table;

-- 6-2. バックフィル結果（日次の合計と一致するか）
SELECT 'daily'   AS src, date_trunc('month', day)::DATE AS month,
       SUM(requests_count) AS files, SUM(tokens_total) AS tokens
  FROM toritavi_ocr_usage GROUP BY 2
UNION ALL
SELECT 'monthly' AS src, month, SUM(requests_count), SUM(tokens_total)
  FROM toritavi_ocr_usage_monthly GROUP BY 2
 ORDER BY month, src;

-- 6-3. 新旧シグネチャが両方あるか（フェーズ1 の時点では 2 行出るのが正しい）
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'increment_ocr_usage_srv'
 ORDER BY args;

-- 6-4. (A) が直ったことの確認。日キーが JST になっているか
--      → 出力が「JSTの今日」と一致すること（JST 00:00〜09:00 に実行すると
--        修正前は前日が返っていた）
SELECT (now() AT TIME ZONE 'Asia/Tokyo')::DATE AS jst_today,
       CURRENT_DATE                            AS utc_today;

-- ============================================================
-- 【フェーズ1】ここまで
-- ============================================================


-- ============================================================
-- 【フェーズ2】Web(API) のデプロイと動作確認が済んでから実行すること。
--
-- 旧 4 引数シグネチャを削除する。残したままでも害はないが、次に読む人が
-- 「どちらが使われているか」で迷うので消す。
-- 019 と同じく、不可逆な操作はコメントアウトして置き、実行者が意図的に外す。
-- ============================================================
-- DROP FUNCTION IF EXISTS increment_ocr_usage_srv(UUID, INTEGER, INTEGER, INTEGER);
--
-- 削除後の確認（1 行だけになること）:
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'increment_ocr_usage_srv';
