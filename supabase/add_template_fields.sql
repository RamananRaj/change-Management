-- ChangeFlow: Add body + file_url to phase_content
-- These fields are used by template content type only.
-- body     = rich text content the admin writes (shown in the drawer)
-- file_url = optional download link (Google Drive, Dropbox, SharePoint, etc.)

ALTER TABLE public.phase_content
  ADD COLUMN IF NOT EXISTS body     text,
  ADD COLUMN IF NOT EXISTS file_url text;

SELECT 'Template fields added to phase_content successfully' AS result;
