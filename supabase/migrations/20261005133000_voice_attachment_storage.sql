-- Voice clips use the existing private attachment bucket and document access
-- controls. No anonymous/public storage access is added.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(SELECT DISTINCT mime FROM unnest(COALESCE(allowed_mime_types, ARRAY[]::text[]) || ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav']) AS mime)
WHERE id = 'attachments';
