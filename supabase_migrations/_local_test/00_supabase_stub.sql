-- 本番の前提だけを最小限に再現する（Supabase 固有のロール・auth スキーマ）。
-- ロールはクラスタ全体なので、DB を作り直しても残る。冪等にする。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
-- 🔴 `is_anonymous` は本番（GoTrue）が持つ列。027 のゲスト分岐が読む。
--    スタブに無いと 027 が「列が無い」で落ち、**実物と違う形を検査する**。
-- 🔴 列は**本番に実在するものだけ**を置く（2026-08-31 に実測）。
--    スタブに無いと、それを読む移行が「列が無い」で落ち、
--    **実物と違う形を検査する**ことになる。
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sign_in_at TIMESTAMPTZ
);

-- 旅程（029 が `deleted_at` を立てる先）。**最小限**。
-- 本体の定義はアプリ側の移行にあり、ここでは 029 が触る列だけを持つ。
CREATE TABLE IF NOT EXISTS toritavi_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ
);
-- auth.uid() は Supabase の関数。005/013 が参照する。
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$ SELECT NULL::uuid $$;

-- 004 相当（コンシェルジュ側。019/021 が触る）
CREATE TABLE toritavi_concierge_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  requests_count INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE TABLE toritavi_concierge_budget (
  month DATE PRIMARY KEY,
  spend_cents INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION increment_concierge_usage(INTEGER, INTEGER, INTEGER)
  RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END $$;

-- テスト用の利用者
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
