-- ============================================================
-- セキュリティ監査クエリ集（Supabase SQL Editor 用）
-- Run in Supabase Dashboard → SQL Editor (genbox2)
-- ============================================================
--
-- 使い方: ブロックごとにコピペして Run。
-- 目的: RLS / 認可が期待通り効いているかを非破壊に確認する。
--

-- ============================================================
-- A. RLS 有効化チェック（Toritavi 全テーブル）
-- ============================================================
-- 期待: rowsecurity = true 行が列挙される
SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
 WHERE tablename LIKE 'toritavi_%'
 ORDER BY tablename;

-- ============================================================
-- B. ポリシー一覧（どの role がどの条件で読めるか）
-- ============================================================
-- 期待: 各テーブルに USING / WITH CHECK が auth.uid() ベースで設定
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename LIKE 'toritavi_%'
 ORDER BY tablename, policyname;

-- ============================================================
-- C. 各ユーザーが所持する行数（管理者確認用）
--    service_role 相当で RLS バイパスして全件数を見る。
--    Dashboard の SQL Editor はデフォルトで postgres ロール（RLS バイパス）。
-- ============================================================
SELECT
  u.email,
  u.id AS user_id,
  (SELECT COUNT(*) FROM toritavi_journeys WHERE user_id = u.id) AS journeys,
  (SELECT COUNT(*) FROM toritavi_steps    WHERE user_id = u.id) AS steps,
  (SELECT COUNT(*) FROM toritavi_concierge_threads WHERE user_id = u.id) AS threads,
  (SELECT COUNT(*) FROM toritavi_concierge_messages WHERE user_id = u.id) AS messages
FROM auth.users u
ORDER BY u.created_at;

-- ============================================================
-- D. "他人の行が取れないか" シミュレーション
--    ターゲットユーザーになりすまして SELECT を試す。
--    → 他ユーザーの行は 0 件になるはず。
-- ============================================================
-- 事前に対象ユーザーの id を確認（auth.users から email でコピー）
-- 例: '00000000-0000-0000-0000-000000000000'

-- 1) 現在 postgres ロール（RLS バイパス）で全 journey 件数
SELECT COUNT(*) AS total_journeys FROM toritavi_journeys;

-- 2) authenticated ロールに切り替えて JWT の sub を偽装
--    ※ Dashboard 上の SQL Editor では auth.uid() は NULL になるので
--    下記は認証ユーザー視点の動作確認として role を切り替える。
--    以下の SET は実際のクライアントでないと意味が薄いため、
--    本当のテストは 2 つの別アカウントで /login → 自分の Journey が
--    見える / 相手の Journey URL を直打ちしても 404 になることを確認すること。

-- 別ユーザーの journey id を指定して、クライアント（curl or アプリ）から
-- fetch('/api/...') 的にアクセスできないことを確認するのが正攻法。

-- ============================================================
-- E. OCR / Concierge 使用量の確認
-- ============================================================
SELECT * FROM toritavi_ocr_usage ORDER BY day DESC, last_request_at DESC LIMIT 20;
SELECT * FROM toritavi_ocr_budget ORDER BY month DESC;
SELECT * FROM toritavi_concierge_usage ORDER BY day DESC, last_request_at DESC LIMIT 20;
SELECT * FROM toritavi_concierge_budget ORDER BY month DESC;

-- ============================================================
-- F. RPC の GRANT 状況（anon が呼べるべきでないものが authenticated 以上に
--    なっていないか確認）
-- ============================================================
SELECT
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
  r.rolname AS granted_role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname = 'public'
  AND p.proname IN ('increment_concierge_usage', 'increment_ocr_usage')
ORDER BY p.proname, r.rolname;

-- ============================================================
-- G. パスワードリセット / メール確認トークンの使用状況
-- ============================================================
-- Supabase 内部 auth.refresh_tokens / auth.one_time_tokens を覗く
-- （service_role でのみ閲覧可。Dashboard の SQL Editor で実行可能）
SELECT
  token_type,
  COUNT(*)      AS total,
  SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS consumed,
  SUM(CASE WHEN expires_at < now()      THEN 1 ELSE 0 END) AS expired
FROM auth.one_time_tokens
GROUP BY token_type
ORDER BY token_type;

-- 個別に直近のトークン使用履歴を見る
SELECT token_type, user_id, created_at, consumed_at, expires_at
  FROM auth.one_time_tokens
 ORDER BY created_at DESC
 LIMIT 10;

-- ============================================================
-- H. セッション状況
-- ============================================================
SELECT user_id, created_at, updated_at, not_after
  FROM auth.sessions
 ORDER BY updated_at DESC
 LIMIT 10;
