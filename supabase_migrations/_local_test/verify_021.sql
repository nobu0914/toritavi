\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';  -- Supabase と同じ（本番の CURRENT_DATE は UTC 基準）

\echo '=== 1. 021 適用前: 日次実績を投入（バックフィル対象）==='
INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total) VALUES
  ('11111111-1111-1111-1111-111111111111', '2026-06-28', 3, 9000),
  ('11111111-1111-1111-1111-111111111111', '2026-06-30', 2, 6000),
  ('11111111-1111-1111-1111-111111111111', '2026-07-02', 4, 12000),
  ('22222222-2222-2222-2222-222222222222', '2026-07-05', 7, 21000);

\echo '=== 2. 021 フェーズ1 を適用 ==='
\i /Users/new_goma/Dev/toritavi/supabase_migrations/021_monthly_ocr_quota.sql

\echo ''
\echo '=== 3. バックフィルの検証（日次の月合計と一致すべき）==='
SELECT
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM (
      SELECT user_id, date_trunc('month', day)::DATE m,
             SUM(requests_count) r, SUM(tokens_total) t
        FROM toritavi_ocr_usage GROUP BY 1,2
    ) d
    FULL JOIN toritavi_ocr_usage_monthly mo
      ON mo.user_id = d.user_id AND mo.month = d.m
    WHERE d.r IS DISTINCT FROM mo.requests_count
       OR d.t IS DISTINCT FROM mo.tokens_total
  ) THEN 'PASS: 月次 = 日次の月合計'
    ELSE 'FAIL: バックフィルが一致しない' END AS backfill_check;

\echo ''
\echo '=== 4. バックフィルの冪等性（2回流しても二重加算しない）==='
\i /Users/new_goma/Dev/toritavi/supabase_migrations/021_monthly_ocr_quota.sql
SELECT CASE WHEN SUM(requests_count) = 16
            THEN 'PASS: 再実行しても合計 16 のまま'
            ELSE 'FAIL: 合計が ' || SUM(requests_count) || ' になった（二重加算）' END
  FROM toritavi_ocr_usage_monthly;

\echo ''
\echo '=== 5. p_units でファイル数ぶん加算されるか（本命の修正）==='
-- バックフィル済みの既存値があるので、呼び出し前後の**差分**で見る。
CREATE TEMP TABLE before_after AS
SELECT COALESCE(SUM(requests_count), 0) AS n
  FROM toritavi_ocr_usage_monthly
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
   AND month = date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::DATE;

SELECT increment_ocr_usage_srv(
  '11111111-1111-1111-1111-111111111111', 1000, 500, 3, 5);  -- 5 ファイル

SELECT CASE WHEN cur - b.n = 5
            THEN 'PASS: 1 リクエスト 5 ファイル → 5 件加算（' || b.n || ' → ' || cur || '）'
            ELSE 'FAIL: 加算が ' || (cur - b.n) || ' 件だった' END
  FROM before_after b,
       LATERAL (SELECT COALESCE(SUM(requests_count), 0) AS cur
                  FROM toritavi_ocr_usage_monthly
                 WHERE user_id = '11111111-1111-1111-1111-111111111111'
                   AND month = date_trunc('month',
                       (now() AT TIME ZONE 'Asia/Tokyo'))::DATE) c;

\echo ''
\echo '=== 6. p_units の範囲外は拒否されるか（MAX_IMAGES=10 と対）==='
DO $$
BEGIN
  BEGIN
    PERFORM increment_ocr_usage_srv(
      '11111111-1111-1111-1111-111111111111', 1, 1, 1, 11);
    RAISE NOTICE 'FAIL: units=11 が通ってしまった';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: units=11 は拒否された (%)', SQLERRM;
  END;
  BEGIN
    PERFORM increment_ocr_usage_srv(
      '11111111-1111-1111-1111-111111111111', 1, 1, 1, 0);
    RAISE NOTICE 'FAIL: units=0 が通ってしまった';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: units=0 は拒否された (%)', SQLERRM;
  END;
END $$;

\echo ''
\echo '=== 7. 日キー・月キーが JST であること ==='
SELECT CASE WHEN day = (now() AT TIME ZONE 'Asia/Tokyo')::DATE
            THEN 'PASS: 日次行が JST の日付で書かれている'
            ELSE 'FAIL: day=' || day || ' / JST=' ||
                 (now() AT TIME ZONE 'Asia/Tokyo')::DATE END
  FROM toritavi_ocr_usage
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
 ORDER BY last_request_at DESC LIMIT 1;

\echo ''
\echo '=== 8. 修正前に開いていた穴の再現（JST 03:00 = UTC 前日 18:00）==='
SELECT
  ('2026-07-21 18:00:00+00'::timestamptz AT TIME ZONE 'Asia/Tokyo')::DATE AS jst_key_新,
  ('2026-07-21 18:00:00+00'::timestamptz AT TIME ZONE 'UTC')::DATE        AS utc_key_旧,
  CASE WHEN ('2026-07-21 18:00:00+00'::timestamptz AT TIME ZONE 'Asia/Tokyo')::DATE
         <> ('2026-07-21 18:00:00+00'::timestamptz AT TIME ZONE 'UTC')::DATE
       THEN '↑ この 9 時間、書く行と読む行が違っていた（上限が無効）'
       ELSE '差が出ない' END AS 説明;

\echo ''
\echo '=== 9. フェーズ1 では旧 4 引数版も残っていること（穴を開けないため）==='
SELECT CASE WHEN COUNT(*) = 2 THEN 'PASS: 新旧2つのシグネチャが共存'
            ELSE 'FAIL: ' || COUNT(*) || ' 個しかない' END AS signatures
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'increment_ocr_usage_srv';

\echo ''
\echo '=== 10. RLS が有効で、変更系ポリシーが無いこと ==='
SELECT CASE WHEN relrowsecurity THEN 'PASS: RLS 有効' ELSE 'FAIL: RLS 無効' END
  FROM pg_class WHERE relname = 'toritavi_ocr_usage_monthly';
SELECT CASE WHEN COUNT(*) FILTER (WHERE cmd <> 'SELECT') = 0
            THEN 'PASS: SELECT ポリシーのみ（加算は SECURITY DEFINER 経由だけ）'
            ELSE 'FAIL: 変更系ポリシーがある' END AS policies
  FROM pg_policies WHERE tablename = 'toritavi_ocr_usage_monthly';
