-- ============================================================
-- Toritavi/Curlew: プッシュ通知のデバイストークン保存（リモート通知 基盤）
-- Run in Supabase SQL Editor (genbox2). Safe to re-run.
--
-- FCM(将来は APNs 直も可) のデバイストークンを本人に紐づけて保存する。
-- 端末アプリ(Flutter)が RLS 経由で自分のトークンを upsert/削除する。
-- 送信側(Next.js /api/push/*) は service_role でユーザーの全トークンを読み、
-- firebase-admin でプッシュを送る（RLS をバイパス）。
--
-- このテーブルが無くてもアプリは動く（トークン保存に失敗しても通知以外は無影響）。
-- ============================================================

CREATE TABLE IF NOT EXISTS toritavi_device_tokens (
  token       TEXT PRIMARY KEY,                 -- FCM 登録トークン（端末×アプリで一意）
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android', 'web')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ユーザー単位の引き当て（送信時に user_id で全端末を取得）を高速化。
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON toritavi_device_tokens(user_id);

ALTER TABLE toritavi_device_tokens ENABLE ROW LEVEL SECURITY;

-- 本人は自分のトークンのみ参照可。
DROP POLICY IF EXISTS "read own tokens" ON toritavi_device_tokens;
CREATE POLICY "read own tokens" ON toritavi_device_tokens
  FOR SELECT USING (user_id = auth.uid());

-- 本人は自分名義でのみ登録可（他人の user_id では入れられない）。
DROP POLICY IF EXISTS "insert own tokens" ON toritavi_device_tokens;
CREATE POLICY "insert own tokens" ON toritavi_device_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 端末が再ログイン等でトークンを付け替える時の upsert 用。
DROP POLICY IF EXISTS "update own tokens" ON toritavi_device_tokens;
CREATE POLICY "update own tokens" ON toritavi_device_tokens
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ログアウト時に自分のトークンを撤去可。
DROP POLICY IF EXISTS "delete own tokens" ON toritavi_device_tokens;
CREATE POLICY "delete own tokens" ON toritavi_device_tokens
  FOR DELETE USING (user_id = auth.uid());

-- 送信側(service_role)は RLS をバイパスして全件読める。追加ポリシー不要。
--
-- 確認:
-- select platform, count(*) from toritavi_device_tokens group by 1;
