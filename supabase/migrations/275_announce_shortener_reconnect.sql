-- 275 — One-off popup announcement: check / reconnect your link shortener.
--
-- We changed how the link on social posts is built (direct / Geniuslink / Bitly
-- is now a choice), so creators should confirm their shortener is still
-- connected and correct. Shows as a center-screen popup (variant 'modal',
-- rendered by components/dashboard/AnnouncementModal). Fixed id so re-running
-- this migration never inserts a duplicate. Deactivates any current
-- announcement first, matching the admin "Publish" flow. Depends on
-- migrations 060 + 061. Seb can hide or replace it from /admin/announcement.

update public.announcements set active = false, updated_at = now() where active = true;

insert into public.announcements (id, active, title, body, cta_label, cta_href, variant)
values (
  '00000000-0000-4000-a000-000000000275',
  true,
  'Action needed: check your link shortener',
  'We changed how the links in your posts are built. Please open Brand Profile and check your Geniuslink connection (or your Bitly / other shortener). If it needs reconnecting, do it there so every new post links correctly. Takes a minute.

Seb',
  'Open Brand Profile',
  '/brand',
  'modal'
)
on conflict (id) do update
  set active = true,
      title = excluded.title,
      body = excluded.body,
      cta_label = excluded.cta_label,
      cta_href = excluded.cta_href,
      variant = excluded.variant,
      updated_at = now();

notify pgrst, 'reload schema';
