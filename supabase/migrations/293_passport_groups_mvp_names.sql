-- 293 — rename the auto-created Passport groups to the MVP-<CHANNEL> scheme.
--
-- Migration 292 seeded auto groups as clean names (General, Blog, Pinterest,
-- Social, YouTube, EPC, SCOUT). We've since moved channelForSource() to the same
-- MVP-<CHANNEL> naming MVP uses for Geniuslink groups, and split each social
-- platform into its own group. This renames the already-seeded groups so a
-- creator doesn't end up with both "Pinterest" and "MVP-PINTEREST".
--
-- Only the exact auto-seeded names are touched, and only when the MVP- target
-- doesn't already exist for that creator (the unique index would reject a
-- collision). Idempotent — re-running matches nothing once renamed. NOTE: legacy
-- links minted with the blanket source 'social' stay lumped in MVP-SOCIAL; only
-- NEW links carry a per-platform source and land in MVP-FACEBOOK / MVP-THREADS /
-- etc., so this can't retroactively split them.

update public.passport_groups g
set name = m.new_name
from (values
  ('General',  'MVP-GENERAL'),
  ('Blog',     'MVP-BLOG'),
  ('Pinterest','MVP-PINTEREST'),
  ('Social',   'MVP-SOCIAL'),
  ('YouTube',  'MVP-YOUTUBE'),
  ('EPC',      'MVP-EPC'),
  ('SCOUT',    'MVP-SCOUT')
) as m(old_name, new_name)
where g.name = m.old_name
  and not exists (
    select 1 from public.passport_groups g2
    where g2.user_id = g.user_id
      and lower(g2.name) = lower(m.new_name)
  );

notify pgrst, 'reload schema';
