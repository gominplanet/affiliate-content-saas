-- 238 — Support ticket attachments.
--
-- Let both sides attach ONE screenshot/image per message. "The little details
-- are hard to explain in text" (customer request). Stored as a public URL in
-- Supabase Storage (bucket `support-attachments`), namespaced per user.
--
-- Nullable, so every existing message is unaffected and the feature degrades to
-- text-only if the column/bucket isn't present yet.

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS image_url text;

NOTIFY pgrst, 'reload schema';
