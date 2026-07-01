-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 148 — brand inquiries (inbound "Work with brands" inbox).
--
-- The creator's blog shows a discreet "Are you a brand that wants to get
-- featured here?" banner. When they enable the in-app contact form, a brand's
-- message lands here — delivered to the creator's MVP dashboard, so a creator
-- with no website/public email can still be reached. Inserts happen only via
-- the service role (the public /api/brand-inquiry endpoint), gated by the same
-- HMAC + honeypot + IP-rate-limit the newsletter signup form uses.

create table if not exists public.brand_inquiries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,          -- the creator whose blog the brand contacted
  brand_name   text,                   -- optional company / brand
  contact_name text,
  contact_email text,
  message      text not null,
  source_url   text,                   -- the blog page the brand submitted from
  ip_hash      text,                   -- rate-limit key (hashed source IP)
  read_at      timestamptz,            -- null = unread (drives the bell + badge)
  archived     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists brand_inquiries_owner_idx
  on public.brand_inquiries (owner_id, created_at desc);
-- Unread + not archived → the notification bell + nav badge count.
create index if not exists brand_inquiries_unread_idx
  on public.brand_inquiries (owner_id)
  where read_at is null and archived = false;
-- IP rate-limit lookup.
create index if not exists brand_inquiries_ip_idx
  on public.brand_inquiries (ip_hash, created_at)
  where ip_hash is not null;

alter table public.brand_inquiries enable row level security;
-- Owner (+ their accepted VAs) can READ + UPDATE (mark read / archive) their own
-- inquiries. INSERT happens only via the service role in the public endpoint —
-- no client insert policy, same guardrail as newsletter_subscribers / mig 116.
drop policy if exists brand_inquiries_select on public.brand_inquiries;
create policy brand_inquiries_select on public.brand_inquiries
  for select using ( owner_id = auth.uid() or public.is_accepted_member_of(owner_id) );
drop policy if exists brand_inquiries_update on public.brand_inquiries;
create policy brand_inquiries_update on public.brand_inquiries
  for update using ( owner_id = auth.uid() or public.is_accepted_member_of(owner_id) );

comment on table public.brand_inquiries is
  'Inbound brand-partnership messages from a creator''s blog "Work with brands" form. Insert via service role only (HMAC+honeypot+rate-limit gated); read/update owner+VA scoped.';
