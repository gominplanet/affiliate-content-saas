-- 074 — Newsletter feature (Milestone 1: capture + manage)
--
-- Adds the three tables that back the per-creator newsletter:
--
--   newsletter_settings     — one row per creator: sender domain, DKIM status,
--                             display name, enabled flag. Drives both the WP
--                             plugin's [mvp-newsletter] shortcode and what we
--                             tell Resend at send-time.
--
--   newsletter_subscribers  — one row per email per creator. Carries the
--                             double-opt-in state machine + the per-subscriber
--                             confirm/unsub tokens we put in email links.
--
--   newsletter_broadcasts   — one row per send: the rendered HTML snapshot,
--                             the picked posts + curated links + personal
--                             message at compose-time, and the live delivery
--                             counters Resend's webhooks tick up.
--
-- Architecture rationale (carries over to milestones 2 + 3):
--   * MVP owns the list in Supabase; Resend is just the send pipe. If we ever
--     need to swap providers (postmark, ses, …) we change services/email and
--     nothing else — subscribers stay put.
--   * Per-creator sender DOMAIN (mail.<creator-site>) — best deliverability
--     and the creator's brand rep stays with them. Resend's "Domains" API
--     gives us DKIM records to surface in the dashboard (milestone 2).
--   * One list per creator for v1 — segmentation can be a column on
--     subscribers later (no schema rewrite needed).

-- ── newsletter_settings ─────────────────────────────────────────────────────
create table if not exists public.newsletter_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- e.g. 'mail.gominreviews.com' — the verified sender subdomain. We always
  -- recommend a SUBDOMAIN of the creator's WP domain (protects their root
  -- domain's reputation). Set in milestone 2 via Resend's domains API.
  sender_domain text,
  -- Local-part of the From address. Default 'newsletter' so emails come from
  -- newsletter@mail.<creator>.com — friendly + recognisable.
  sender_local_part text not null default 'newsletter',
  -- Display name on the From line, e.g. "Gomin Reviews".
  sender_name text,
  -- Resend's internal id once we register the domain via their API. NULL
  -- until milestone 2 wires up the domain-setup UI.
  resend_domain_id text,
  -- Mirror of Resend's verification state — 'pending' | 'verified' | 'failed'.
  -- We poll Resend's GET /domains/:id and write the status here so the
  -- dashboard can render a badge without re-hitting the API on every load.
  domain_status text not null default 'pending',
  domain_checked_at timestamptz,
  -- The DKIM/SPF records Resend hands us — JSON array of { type, name, value }
  -- objects. Displayed with one-click copy in the settings UI.
  dkim_records jsonb,
  -- Master switch — when true, the WP plugin's [mvp-newsletter] shortcode
  -- renders the signup form; when false, the shortcode no-ops. Lets the
  -- creator turn the feature off without uninstalling the shortcode.
  enabled boolean not null default false,
  -- CAN-SPAM (US) requires a physical mailing address in every commercial
  -- email. Mirrored from brand_profiles when present; can be overridden.
  mailing_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.newsletter_settings enable row level security;
drop policy if exists "Users manage own newsletter settings" on public.newsletter_settings;
create policy "Users manage own newsletter settings" on public.newsletter_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── newsletter_subscribers ──────────────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  -- 'pending' (signed up via form, hasn't clicked the confirm link)
  -- 'active'  (confirmed, will receive broadcasts)
  -- 'unsubscribed' (one-click unsub or manual removal)
  -- 'bounced' (Resend webhook reported a hard bounce — we stop sending)
  status text not null default 'pending',
  -- Random token in the confirmation-email link. Cleared once status flips
  -- to 'active' so the link can't be replayed.
  confirm_token text,
  -- Random token in the one-click unsubscribe link (RFC 8058 + visible
  -- footer link). NOT cleared on unsub — we keep the row + token so a user
  -- who unsubs by mistake can re-subscribe from the same link.
  unsub_token text not null default replace(gen_random_uuid()::text, '-', ''),
  -- Where the row was created: 'blog_form' | 'csv_import' | 'manual'.
  source text,
  -- The WP page URL the subscriber signed up on — useful analytics later.
  source_url text,
  -- Sha-256 of (ip + a small project salt) so we can rate-limit / spot
  -- floods without storing raw IPs. The salt lives in env.
  signup_ip_hash text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "Users manage own subscribers" on public.newsletter_subscribers;
create policy "Users manage own subscribers" on public.newsletter_subscribers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One creator cannot have two rows for the same email (case-insensitive).
-- Drives the "already subscribed" path on /api/newsletter/subscribe.
create unique index if not exists newsletter_subscribers_user_email_uniq
  on public.newsletter_subscribers (user_id, lower(email));
-- Fast confirm-link lookups (token → row).
create index if not exists newsletter_subscribers_confirm_token_idx
  on public.newsletter_subscribers (confirm_token)
  where confirm_token is not null;
-- Fast one-click unsub lookups.
create index if not exists newsletter_subscribers_unsub_token_idx
  on public.newsletter_subscribers (unsub_token);
-- Dashboard subscriber-count query: count(*) where status='active' grouped
-- by user_id — this index covers it.
create index if not exists newsletter_subscribers_user_status_idx
  on public.newsletter_subscribers (user_id, status);

-- ── newsletter_broadcasts ───────────────────────────────────────────────────
create table if not exists public.newsletter_broadcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Email subject line. AI-drafted on compose; the creator can edit.
  subject text not null,
  -- The HTML body actually sent. Kept verbatim so future subscribers can be
  -- back-filled with old issues, and so we can re-render the same view in
  -- the "View in browser" link.
  html text not null,
  plain_text text,
  -- The blog_posts.id rows the creator picked at compose-time. Stored so the
  -- dashboard can render thumbnails + titles for each sent broadcast.
  blog_post_ids uuid[] not null default '{}',
  -- Free-text personal message the creator typed in the compose box.
  personal_message text,
  -- Curated links repeater — [{ url, blurb }] objects. Snapshotted at send.
  curated_links jsonb not null default '[]',
  -- Lifecycle: 'draft' | 'queued' | 'sending' | 'sent' | 'failed'.
  status text not null default 'draft',
  -- Live counters — driven by Resend's webhook deliveries / bounces. Total is
  -- the number of subscribers we batched at send-time; the others tick up.
  recipients_total integer not null default 0,
  recipients_delivered integer not null default 0,
  recipients_bounced integer not null default 0,
  recipients_opened integer not null default 0,
  recipients_clicked integer not null default 0,
  scheduled_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
alter table public.newsletter_broadcasts enable row level security;
drop policy if exists "Users manage own broadcasts" on public.newsletter_broadcasts;
create policy "Users manage own broadcasts" on public.newsletter_broadcasts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Dashboard "recent broadcasts" sort.
create index if not exists newsletter_broadcasts_user_created_idx
  on public.newsletter_broadcasts (user_id, created_at desc);
