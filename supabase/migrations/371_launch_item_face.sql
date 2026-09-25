-- Migration 371: a face of its own for one video in a batch.
--
-- A batch's thumbnail look was picked once for every video, face included. A
-- channel with two presenters films some videos with one and some with the
-- other, and some with nobody at all. Null follows the batch; otherwise the
-- same shape as the batch's face: {"kind":"auto"}, {"kind":"none"} or
-- {"kind":"face","faceId":"<uuid>"}.
--
-- Safe to run twice.

alter table public.launch_items add column if not exists thumbnail_face jsonb;
