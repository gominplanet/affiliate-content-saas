-- 469: the daily 20 from a search the creator chooses (Seb, 2026-11-18: "we
-- need to ask MVP to find or to message those 20 brands based on a very
-- particular set of filters"). The search saved from Find brands: keywords,
-- niches, how it pays, every filter and the sort (lib/trybe-daily). The daily
-- cap is no longer a setting (200 for everyone); daily_cap stays, unread.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists daily_search jsonb;

notify pgrst, 'reload schema';
