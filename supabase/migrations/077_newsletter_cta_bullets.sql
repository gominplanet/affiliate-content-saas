-- 077 — Editable benefit bullets for the homepage hero
--
-- The two-column hero (front-page.php) renders three "what you get"
-- bullets on the left side. Until now they were hard-coded in the
-- theme; creators asked to edit them like the title/subtitle.
--
-- Three nullable text columns rather than a JSON array — easier to
-- bind one input per row in the dashboard, no need for client-side
-- array parsing, and the theme just renders whichever rows are
-- non-empty. Limit of 3 keeps the layout predictable.

alter table public.newsletter_settings
  add column if not exists cta_bullet_1 text,
  add column if not exists cta_bullet_2 text,
  add column if not exists cta_bullet_3 text;
