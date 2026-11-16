-- 468: TRYBE ads edited from a batch (Seb, 2026-11-16: "after scripts, users
-- shoot and then come back and could potentially edit all of their vertical
-- trybe videos inside of mvp before being able to submit them"). A video in
-- the review editor can belong to a TRYBE batch: its script is found from what
-- the take says (lib/trybe-edit matchScript) or picked by the creator, it is
-- cut with that script, and the finished video is checked against the brief
-- (checkCut), kept here so the batch shows it.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

alter table public.review_edits add column if not exists trybe_campaign_id uuid references public.trybe_campaigns(id) on delete set null;
alter table public.review_edits add column if not exists trybe_script_idx integer;
alter table public.review_edits add column if not exists trybe_check jsonb;

create index if not exists review_edits_trybe_idx on public.review_edits (user_id, trybe_campaign_id, created_at desc);

notify pgrst, 'reload schema';
