-- 368 — what YouTube confirmed about each batch video's disclosures.
--
-- WHAT CHANGED. Paid promotion and the AI-use answer used to be set only by
-- SCOUT clicking through YouTube Studio in the creator's browser, so a batch
-- video went public undisclosed unless a page happened to be open. YouTube's
-- API takes both now, so the uploader sets them the moment each video exists,
-- then reads the video back. This column is that read, per video:
--
--   { at, asked, paidPromotion, aiUseNo, embeddable, madeForKids, error }
--
-- null in a field means YouTube did not say. The launch report shows it, so a
-- tick there means YouTube kept it, not that we asked.
--
-- Before this runs the uploader still sets the disclosures; only the record of
-- what YouTube said is lost.
--
-- Safe to run more than once.

alter table public.launch_items
  add column if not exists api_disclosures jsonb;

comment on column public.launch_items.api_disclosures is
  'What YouTube reported after the uploader set paid promotion and the AI-use answer through its API: { at, asked, paidPromotion, aiUseNo, embeddable, madeForKids, error }. null fields mean YouTube did not say.';
