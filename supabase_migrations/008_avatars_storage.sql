-- ============================================================
-- Toritavi: avatars Storage bucket + RLS
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
-- Stores cropped 512x512 profile images, one per authenticated user.
-- ============================================================

-- 1. Bucket
-- Private bucket (public = false). Clients fetch via signed URLs or via the
-- authenticated /object/authenticated/... endpoint.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'toritavi-avatars',
  'toritavi-avatars',
  false,
  2 * 1024 * 1024,  -- 2 MiB hard cap (we client-compress to ~100 KiB, so this is just insurance)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS on storage.objects for this bucket.
-- Path convention: <user_id>/avatar.jpg  — the first path segment must equal
-- the authenticated user's uid, so no user can read/write another's object.

-- Drop any prior policies (defence-in-depth)
DROP POLICY IF EXISTS "toritavi_avatars_select_own" ON storage.objects;
DROP POLICY IF EXISTS "toritavi_avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "toritavi_avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "toritavi_avatars_delete_own" ON storage.objects;

CREATE POLICY "toritavi_avatars_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'toritavi-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "toritavi_avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'toritavi-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "toritavi_avatars_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'toritavi-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'toritavi-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "toritavi_avatars_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'toritavi-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
