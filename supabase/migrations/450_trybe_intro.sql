-- Migration 450: the creator's intro video for TRYBE requests.
--
-- Seb, 2026-10-20: "what if we tell users to upload an introductionary
-- video? ... have that one single intro video be uploaded to MVP, and then
-- MVP uses that video on all of the requests ... Let's make it a personal
-- intro submission based on what MVP wants to recommend." The script MVP
-- wrote for it (lib/trybe-intro) and the video the creator uploaded once
-- (in MVP storage, trybe-intro-*), kept with their TRYBE settings.
--
-- Safe to run twice.
alter table public.trybe_outreach_settings add column if not exists intro_video jsonb;
alter table public.trybe_outreach_settings add column if not exists intro_script jsonb;
-- Optional (Seb: "if they do not want to do this, they do not have to and
-- can simply send the intro message like before"): true sends the message only.
alter table public.trybe_outreach_settings add column if not exists intro_off boolean not null default false;
notify pgrst, 'reload schema';
