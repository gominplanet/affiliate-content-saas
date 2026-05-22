-- 059 — backfill ALL Facebook Pages into social_accounts
--
-- Migration 057 seeded only each user's ACTIVE facebook_page_id. But users
-- often manage several Pages, all stored in integrations.facebook_pages_json
-- (a JSON array of {id,name,access_token}). For the per-post Page picker to
-- show every page WITHOUT forcing a reconnect, expand that array here.
--
-- Guarded + idempotent: the column was added via the dashboard (not a tracked
-- migration), so we check it exists; ON CONFLICT refreshes name/token. The
-- active page keeps is_default = true.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'integrations'
       and column_name = 'facebook_pages_json'
  ) then
    execute $fb$
      insert into public.social_accounts
        (user_id, platform, external_id, display_name, kind, access_token, is_default)
      select i.user_id,
             'facebook',
             elem->>'id',
             coalesce(elem->>'name', 'Facebook Page'),
             'page',
             elem->>'access_token',
             (elem->>'id') = i.facebook_page_id
        from public.integrations i,
             lateral jsonb_array_elements(
               case
                 when i.facebook_pages_json ~ '^\s*\['
                 then i.facebook_pages_json::jsonb
                 else '[]'::jsonb
               end
             ) as elem
       where i.facebook_pages_json is not null
         and coalesce(elem->>'id', '') <> ''
         and coalesce(elem->>'access_token', '') <> ''
      on conflict (user_id, platform, external_id) do update
        set display_name = excluded.display_name,
            access_token = excluded.access_token,
            updated_at   = now()
    $fb$;
  end if;
end $$;
