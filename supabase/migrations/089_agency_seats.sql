-- Migration 089 — Agency seats: multi-user accounts under one Pro subscription.
--
-- Phase 1 (this migration): data model + invite flow.
--   - agency_invites: pending email invitations from owner → invitee
--   - agency_members: accepted memberships linking owner ↔ member
--
-- Phase 2 (future): resource-sharing override. Every route that filters by
-- user_id needs to resolve "effective owner" so a member sees the parent
-- account's content. The data model is built now so Phase 2 is a pure
-- query change — no schema migration needed.

-- ── Invites: a row exists from the moment the owner sends the invite
--            until the invitee accepts (→ migrate to agency_members) or
--            it expires (TTL 14 days, enforced in app layer for now).
CREATE TABLE IF NOT EXISTS agency_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Pro user who minted the invite.
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Email the invite was sent to. We rely on email match at accept time,
  -- not auth.users.email lookup, so the invitee can sign up with the
  -- exact email used in the invite even if they have no MVP account yet.
  email         text NOT NULL,
  -- The single-use token embedded in the accept link. SHA-256 hashed at
  -- rest so an invite-link leak doesn't expose every other pending invite.
  -- The plaintext is shown ONCE in the email body; we never store it.
  token_hash    text NOT NULL UNIQUE,
  -- Owner-chosen role for the seat: admin = full access (manage other
  -- members + billing), member = create content but not manage seats.
  -- More roles can be added later (analyst-only, write-only, etc.).
  role          text NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
  -- Friendly note shown in the invite email + UI ("welcome aboard Sarah!").
  note          text CHECK (note IS NULL OR length(note) <= 280),
  -- Stamped on accept/decline. Pending invite has both NULL.
  accepted_at   timestamptz,
  declined_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Compound uniqueness: prevents an owner from spamming the same email
  -- with duplicate pending invites. We allow re-invite after decline by
  -- including declined_at in the unique index.
  UNIQUE (owner_user_id, email, declined_at)
);

CREATE INDEX IF NOT EXISTS idx_agency_invites_owner ON agency_invites (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites (lower(email));
-- The accept route does a single point lookup by token_hash.
CREATE INDEX IF NOT EXISTS idx_agency_invites_active_token ON agency_invites (token_hash)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

ALTER TABLE agency_invites ENABLE ROW LEVEL SECURITY;

-- Owners read/write their own invites. The accept route uses the admin
-- client (bypass RLS) because the invitee may not have a Supabase session
-- yet at accept time.
CREATE POLICY "agency_invites owner-read" ON agency_invites
  FOR SELECT USING (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-insert" ON agency_invites
  FOR INSERT WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-update" ON agency_invites
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-delete" ON agency_invites
  FOR DELETE USING (auth.uid() = owner_user_id);


-- ── Memberships: accepted seats. One row per (owner, member) pair.
CREATE TABLE IF NOT EXISTS agency_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Pro account owning the seat.
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The member who accepted. CASCADE-deleted if the member's auth row
  -- ever goes away.
  member_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Inherited from the invite at accept time.
  role            text NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
  -- Set when the owner revokes the seat. Revoked members keep their auth
  -- row (so they can still log in to other workspaces in the future) but
  -- lose access to the owner's resources. We keep the row for the audit
  -- trail.
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A user can only be a member of one agency at a time. Trying to accept
  -- a second invite while already part of an agency fails at the app layer.
  UNIQUE (member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_members_owner ON agency_members (owner_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_members_member ON agency_members (member_user_id) WHERE revoked_at IS NULL;

ALTER TABLE agency_members ENABLE ROW LEVEL SECURITY;

-- Owners read all their members; members read only their own row.
-- (Both will eventually call getOwnerUserId() to know whose data to show.)
CREATE POLICY "agency_members owner-read" ON agency_members
  FOR SELECT USING (auth.uid() = owner_user_id OR auth.uid() = member_user_id);
-- Only the owner can revoke (UPDATE revoked_at). Member can't unilaterally
-- "leave" via this table — they'd contact support or delete their auth row.
CREATE POLICY "agency_members owner-update" ON agency_members
  FOR UPDATE USING (auth.uid() = owner_user_id);
-- Inserts come from the accept route (admin client, bypass RLS).

COMMENT ON TABLE agency_invites IS
  'Pending agency seat invitations. Owner mints → email sent → invitee clicks → row migrates to agency_members.';
COMMENT ON TABLE agency_members IS
  'Accepted agency seats. Phase 2 will resolve effective owner for resource queries via lib/agency.ts:getOwnerUserId.';
