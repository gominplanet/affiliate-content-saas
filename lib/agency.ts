// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Agency seats helpers. Phase 1 ships invites + management; Phase 2 wires
// `getOwnerUserId()` into every resource-query callsite so members see the
// parent account's data instead of an empty workspace.
//
// The data model is intentionally simple:
//   - agency_invites: pending invites from owner → email
//   - agency_members: accepted memberships linking owner ↔ member
// Both tables live in migration 089.

import { randomBytes, createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

/** All agency invite links carry this prefix so we can grep them out of
 *  logs and tie them to an MVP origin. */
const INVITE_TOKEN_PREFIX = 'agi_'
const RANDOM_LEN = 32
/** Pending invites expire after this many days. Enforced in the app layer
 *  (the accept route checks `now - created_at`); the DB just stores the
 *  row indefinitely so the audit trail survives. */
export const INVITE_TTL_DAYS = 14

/** Constant-time-safe SHA-256 of a plaintext token. */
export function hashAgencyToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export interface GeneratedInvite {
  plaintext: string
  hash: string
}

/** Mint a fresh single-use invite token. Plaintext goes into the email
 *  link; hash is persisted on agency_invites.token_hash. */
export function generateAgencyToken(): GeneratedInvite {
  // 24 raw bytes → 32 base64url chars (no padding).
  const tail = randomBytes(24).toString('base64url').slice(0, RANDOM_LEN)
  const plaintext = `${INVITE_TOKEN_PREFIX}${tail}`
  return { plaintext, hash: hashAgencyToken(plaintext) }
}

/**
 * Resolve a caller's "effective owner" user_id — the account whose data
 * they should see. For a Pro owner this is just themselves. For an
 * accepted agency member, this is their owner's user_id.
 *
 * Phase 1: the helper exists + is correct. Phase 2: every route that
 * currently filters by `user_id = auth.uid()` will call this instead so
 * members can see their owner's resources.
 *
 * Tolerant of admin-only and trial users (they're never members).
 */
export async function getOwnerUserId(userId: string): Promise<string> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('agency_members')
    .select('owner_user_id')
    .eq('member_user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()
  return (data?.owner_user_id as string | undefined) ?? userId
}

export interface AgencyContext {
  /** The user actually logged in. */
  callerUserId: string
  /** The account whose data the caller sees. Equal to callerUserId unless
   *  the caller is an accepted member of a parent account. */
  effectiveOwnerUserId: string
  /** Role on the parent account, or null if the caller IS the owner. */
  role: 'admin' | 'member' | null
}

/** Resolve full agency context for a user. Useful when a route needs both
 *  the owner id AND the caller's role (e.g. gating "manage members" so
 *  members can't add other members unless they're admin). */
export async function resolveAgencyContext(callerUserId: string): Promise<AgencyContext> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('agency_members')
    .select('owner_user_id, role')
    .eq('member_user_id', callerUserId)
    .is('revoked_at', null)
    .maybeSingle()
  if (data?.owner_user_id) {
    return {
      callerUserId,
      effectiveOwnerUserId: data.owner_user_id as string,
      role: (data.role as 'admin' | 'member') ?? 'member',
    }
  }
  return { callerUserId, effectiveOwnerUserId: callerUserId, role: null }
}

/** Seat ceiling per tier. Pro gets 3 seats; admin gets unbounded. Future
 *  Agency-specific tier could raise this; trial/creator/studio can't
 *  invite anyone (they hit the paywall in the UI). */
export function maxSeatsForTier(tier: string | null | undefined): number {
  switch (tier) {
    case 'pro': return 3
    case 'admin': return Number.MAX_SAFE_INTEGER
    default: return 0
  }
}
