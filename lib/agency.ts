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
// Import for INTERNAL use (resolveAgencyContext) — these are also
// re-exported below so callers of @/lib/agency see them as if they
// originated here.
import { normalizePermissions, type VaPermissions } from '@/lib/agency-permissions'

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

// Re-export everything edge/client-safe so non-middleware / non-server
// callers can keep importing from '@/lib/agency' without knowing about
// the split. Middleware imports directly from '@/lib/agency-routes' and
// client components from '@/lib/agency-permissions' because THIS file
// pulls in node:crypto which can't bundle for edge/browser.
export { BLOCKED_FOR_VAS, isPathBlockedForVa } from '@/lib/agency-routes'
export {
  VA_PERMISSION_KEYS,
  VA_PERMISSION_META,
  DEFAULT_VA_PERMISSIONS,
  normalizePermissions,
  type VaPermissionKey,
  type VaPermissions,
} from '@/lib/agency-permissions'

export interface AgencyContext {
  /** The user actually logged in. */
  callerUserId: string
  /** The account whose data the caller sees. Equal to callerUserId unless
   *  the caller is an accepted member of a parent account. */
  effectiveOwnerUserId: string
  /** Role on the parent account, or null if the caller IS the owner. */
  role: 'admin' | 'member' | null
  /** Permission flags for the caller. NULL when the caller IS the owner
   *  (owners implicitly have all permissions; check via isOwner helper). */
  permissions: VaPermissions | null
}

/** True when the caller is the account owner (not a VA / agency member). */
export function isOwner(ctx: AgencyContext): boolean {
  return ctx.role === null
}

/** Check whether the caller has a specific VA permission. Owners always
 *  return true. VAs return the value from their permissions JSONB. */
export function hasPermission(ctx: AgencyContext, key: VaPermissionKey): boolean {
  if (isOwner(ctx)) return true
  return !!ctx.permissions?.[key]
}

/** Resolve full agency context for a user. Useful when a route needs both
 *  the owner id AND the caller's role + permissions (e.g. gating
 *  "compose newsletter" so members without manage_newsletter can't). */
export async function resolveAgencyContext(callerUserId: string): Promise<AgencyContext> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('agency_members')
    .select('owner_user_id, role, permissions')
    .eq('member_user_id', callerUserId)
    .is('revoked_at', null)
    .maybeSingle()
  if (data?.owner_user_id) {
    return {
      callerUserId,
      effectiveOwnerUserId: data.owner_user_id as string,
      role: (data.role as 'admin' | 'member') ?? 'member',
      permissions: normalizePermissions(data.permissions),
    }
  }
  return { callerUserId, effectiveOwnerUserId: callerUserId, role: null, permissions: null }
}

/** Seat ceiling per tier. Pro gets 3 seats; admin gets Infinity (UI
 *  displays "Unlimited"). Future Agency-specific tier could raise this;
 *  trial/creator/studio can't invite anyone (they hit the paywall in
 *  the UI).
 *
 *  Returns Infinity (not Number.MAX_SAFE_INTEGER) so the UI can detect
 *  "unbounded" with isFinite() and render "Unlimited" instead of the
 *  raw number — earlier code returned MAX_SAFE_INTEGER which leaked
 *  "0 of 9007199254740991 seats used" to admin users. */
export function maxSeatsForTier(tier: string | null | undefined): number {
  switch (tier) {
    case 'pro': return 3
    case 'admin': return Number.POSITIVE_INFINITY
    default: return 0
  }
}
