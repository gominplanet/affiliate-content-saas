-- 284 — Passport Links: richer click analytics (device / browser / OS).
--
-- Geniuslink's dashboard breaks clicks down by device and browser on top of
-- country. We log the same from the visitor's User-Agent at redirect time so the
-- Passport dashboard can show it too. Columns are nullable — older click rows
-- (logged before this migration) simply read as "Unknown" in the breakdowns.

alter table public.passport_link_clicks
  add column if not exists device  text,   -- 'Mobile' | 'Tablet' | 'Desktop'
  add column if not exists browser text,   -- 'Chrome' | 'Safari' | 'Edge' | ...
  add column if not exists os      text;   -- 'iOS' | 'Android' | 'Windows' | ...

notify pgrst, 'reload schema';
