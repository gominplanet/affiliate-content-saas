-- 478: The Video Builder, clip first, and the shared music library.
--
-- CLIP FIRST (lib/studio-clips): each hook, body and CTA of a set is one
-- review_edits row (studio_role 'clip', studio_part its label: H1, B2, C3),
-- read and edited once; each video is a row (studio_role 'combo') whose
-- studio_parts are its clips in order, joined on the video server.
--
-- THE MUSIC LIBRARY (app/api/music-bed): an accepted track, checked with no
-- voices, is offered to every member who makes videos (shared), and using
-- one from the library is not one of the month's new tracks.
--
-- Safe to run twice.
alter table public.review_edits add column if not exists studio_role text;
alter table public.review_edits add column if not exists studio_part text;
alter table public.review_edits add column if not exists studio_parts uuid[];
create index if not exists review_edits_studio_parts_idx on public.review_edits using gin (studio_parts) where studio_parts is not null;

alter table public.music_beds add column if not exists shared boolean not null default true;
create index if not exists music_beds_library_idx on public.music_beds (accepted_at desc) where status = 'accepted' and shared;

notify pgrst, 'reload schema';
