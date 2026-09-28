-- 386: Ended Deals' automatic job is opt-in.
--
-- Migration 380 made deal_aftercare_auto default to true, which was right
-- while only the owner could use Ended Deals. Open to Pro, a true default
-- would have the six-hourly job rewrite every Pro creator's deal posts without
-- them ever opening the page. So the job now runs only for the owner (admin)
-- and for creators who switched it on themselves, which this column records.
--
-- Safe to run more than once.
alter table public.integrations
  add column if not exists deal_aftercare_auto_chosen_at timestamptz;
alter table public.integrations
  alter column deal_aftercare_auto set default false;
notify pgrst, 'reload schema';
