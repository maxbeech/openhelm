-- Interactive browser-profile setup for cloud mode.
--
-- Adds storage for Chromium user-data-dir tarballs captured during an
-- E2B Desktop credential setup session. The tarball is uploaded to a
-- private `browser-profiles` bucket and keyed on the credentials row so
-- subsequent runs can hydrate the profile into each sandbox.

ALTER TABLE credentials
  ADD COLUMN browser_profile_storage_key TEXT,
  ADD COLUMN browser_profile_verified_at TIMESTAMPTZ;

-- Private storage bucket. Files are laid out as `{user_id}/{credential_id}.tar.gz`
-- so the first path segment is always the owning user's auth uid — that's what
-- the RLS policies below key on.
INSERT INTO storage.buckets (id, name, public)
VALUES ('browser-profiles', 'browser-profiles', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "browser_profiles_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'browser-profiles'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "browser_profiles_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'browser-profiles'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "browser_profiles_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'browser-profiles'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "browser_profiles_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'browser-profiles'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
