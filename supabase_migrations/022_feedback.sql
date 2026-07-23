-- ============================================================
-- Toritavi: 改善フィードバック（アプリ内 → 管理コンソール）
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
--   1. toritavi_feedback         — 投稿本体
--   2. toritavi-feedback バケット — 添付画像（1件・画像のみ）
--
-- SECURITY NOTES:
--   - 投稿者は **自分の投稿だけ** SELECT / INSERT できる。
--     UPDATE / DELETE のポリシーは作らない（＝誰も編集・削除できない）。
--     苦情を送った後で本人が消せてしまうと、対応の途中で記録が消える。
--     消す必要があるときは service-role（管理コンソール）から行う。
--   - 管理側の閲覧・対応状況の更新は service-role のみ。status / admin_note に
--     authenticated の write ポリシーは無い（そもそも UPDATE ポリシーが無い）。
--   - 添付は **画像のみ・1件・5MiB**。バケット側の allowed_mime_types で
--     止める。クライアント検証だけに頼らない（差し替え可能なため）。
--
-- 添付の扱いについて（重要）:
--   利用者は不具合の説明としてスクリーンショットを送る。そこには
--   **搭乗券・予約票・氏名・便名が写り込む**。このバケットは
--   `toritavi-scans` と同じ扱い（非公開・署名URL経由・保持期限あり）に
--   すること。管理コンソールで開くときも署名URLを都度発行する。
-- ============================================================

-- ---------- 1. 投稿テーブル ----------
CREATE TABLE IF NOT EXISTS toritavi_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 種別。UI の選択肢と対応。増やすときは CHECK も更新すること。
  category    TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN ('bug', 'request', 'usability', 'other')),

  -- 本文。UI 側で 2000 文字に丸めているが、ここでも上限を持つ
  -- （UI の maxLength だけに頼らない＝input_safety.dart と同じ方針）。
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),

  -- 添付画像の Storage パス（`<user_id>/<feedback_id>.<ext>`）。無ければ NULL。
  attachment_path TEXT,

  -- 環境情報。再現の手がかり。**利用者に見せる前提で最小限に絞る**
  -- （端末個体を識別しうる値は入れない）。
  app_version TEXT,
  platform    TEXT,
  os_version  TEXT,

  -- 対応状況。管理コンソールから service-role で更新する。
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'triaged', 'in_progress', 'done', 'wontfix')),
  admin_note  TEXT,   -- 社内メモ。**利用者には返さない**

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toritavi_feedback_created
  ON toritavi_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_toritavi_feedback_status
  ON toritavi_feedback (status) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_toritavi_feedback_user
  ON toritavi_feedback (user_id, created_at DESC);

ALTER TABLE toritavi_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "toritavi_feedback_insert_own" ON toritavi_feedback;
DROP POLICY IF EXISTS "toritavi_feedback_select_own" ON toritavi_feedback;

-- 自分の投稿だけ作れる。user_id の詐称を WITH CHECK で止める。
CREATE POLICY "toritavi_feedback_insert_own"
  ON toritavi_feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 自分の投稿だけ読める（送信履歴の表示用）。
CREATE POLICY "toritavi_feedback_select_own"
  ON toritavi_feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- UPDATE / DELETE のポリシーは **意図的に作らない**。
-- RLS 有効かつポリシー不在 ＝ authenticated からは一切書き換えられない。

-- ---------- 2. 添付画像のバケット ----------
-- 非公開。1 件あたり 5 MiB、画像 MIME のみ。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'toritavi-feedback',
  'toritavi-feedback',
  false,
  5 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- パス規約: `<user_id>/<feedback_id>.<ext>`
-- 先頭セグメントが uid と一致することを要求 → 他人の添付は読めない。
DROP POLICY IF EXISTS "toritavi_feedback_obj_select_own" ON storage.objects;
DROP POLICY IF EXISTS "toritavi_feedback_obj_insert_own" ON storage.objects;

CREATE POLICY "toritavi_feedback_obj_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'toritavi-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "toritavi_feedback_obj_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'toritavi-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE / DELETE も **作らない**（差し替え・削除をさせない）。
-- 本文と同じ理由。削除は service-role から。

-- ---------- 3. 確認 ----------
-- SELECT policyname, cmd FROM pg_policies
--  WHERE tablename = 'toritavi_feedback' ORDER BY policyname;
--   → insert_own(INSERT) / select_own(SELECT) の 2 件だけであること
--
-- SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'toritavi-feedback';
--   → public = false であること
