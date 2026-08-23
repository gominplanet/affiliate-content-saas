-- 280 — per-site Amazon Associates tag.
--
-- The Amazon Associates tag (the "gomin0e-20"-style store id that every generated
-- link carries) lived only on integrations.amazon_associates_tag: ONE tag for the
-- whole account, shared by every connected site. A creator running two brands on
-- two separate Associates accounts needs each site's links to carry that site's
-- own tag.
--
-- Same pattern the rest of a site's identity already uses (migration 222): the
-- live value stays on integrations.amazon_associates_tag (so every existing
-- link-builder keeps reading it unchanged), and each site keeps its own copy here.
-- On a site switch we snapshot the outgoing site's tag and restore the incoming
-- one, so the live value always reflects the active site.

alter table public.wordpress_sites
  add column if not exists amazon_associates_tag text;

-- Seed every existing site with the owner's current account-wide tag, so turning
-- this on never blanks a tag and nobody's existing links change. Sites diverge
-- only when the creator sets a different tag while that site is active.
update public.wordpress_sites ws
  set amazon_associates_tag = i.amazon_associates_tag
  from public.integrations i
  where i.user_id = ws.user_id
    and ws.amazon_associates_tag is null
    and i.amazon_associates_tag is not null;

notify pgrst, 'reload schema';
