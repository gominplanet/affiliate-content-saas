-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- A separate address for brand collaborations.
--
-- brand_profiles.website_url has been doing two jobs. It is the blog MVP writes
-- for, AND it is the address printed in the "Let's Work Together!" line that
-- invites brands to get in touch. For most creators those are the same site and
-- nobody noticed. For a creator with a review blog and a separate business site
-- they are not, and there was no way to say so: the description offered brands
-- the review blog, which is the wrong front door for a pitch.
--
-- The workaround was to hardcode the second URL into the collaboration line
-- through the description-line editor. That works and it is not a setting: the
-- address ends up buried in a template rather than in a field, so changing it
-- later means remembering where it was hidden.
--
-- Nothing changes for an account that leaves this empty. The {collab} token
-- falls back to website_url, so every existing description renders byte for byte
-- as it did before.
--
-- Safe to run twice.

alter table if exists public.brand_profiles
  add column if not exists collab_url text;

comment on column public.brand_profiles.collab_url is
  'Where brands should go to work with this creator, when that is NOT the blog: an agency site, a services page, a portfolio. Fills the {collab} token in the YouTube collaboration line and appears in the Collaborations pitch email. Empty means "same as website_url", which is the common case and the previous behaviour.';
