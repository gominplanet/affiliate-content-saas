-- A published Amazon post can carry a note that is NOT a failure.
--
-- process-amazon-schedules writes the publish note into error_message on rows it
-- marks 'completed'. That note is a soft one: the post went out, but the link
-- was substituted (Passport could not mint, Geniuslink did not answer). Storing
-- it in the error column leaves the queue unable to tell "published, with a
-- caveat worth reading" from "did not publish", so it has to render one of them
-- wrong.
--
-- Its own column. error_message goes back to meaning only what its name says.
--
-- Safe to run twice: add column if not exists, and the backfill only touches
-- completed rows that still carry a note in the wrong place, which is a no-op
-- the second time because it clears error_message as it goes.
alter table public.amazon_scheduled_posts
  add column if not exists note text;

-- Move the notes already sitting in error_message on completed rows.
update public.amazon_scheduled_posts
   set note = error_message,
       error_message = null
 where status = 'completed'
   and error_message is not null
   and note is null;
