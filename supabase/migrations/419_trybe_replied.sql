-- 419: when a brand MVP messaged on TRYBE answered (TRYBE Outreach). A brand
-- has a conversation with the creator on TRYBE only once it accepted or wrote
-- back, so the first time MVP sees one, it stamps replied_at here, and the
-- Replied count holds steady instead of depending on the latest message.
-- Safe to run twice.
alter table public.trybe_brands add column if not exists replied_at timestamptz;
create index if not exists trybe_brands_user_replied_idx on public.trybe_brands (user_id, replied_at);
notify pgrst, 'reload schema';
