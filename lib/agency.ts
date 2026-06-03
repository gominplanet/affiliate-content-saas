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

/** All permission keys a Virtual Assistant can be granted. Owners (no
 *  agency parent) implicitly have all permissions. The blocked-for-VAs
 *  surfaces (BLOCKED_FOR_VAS below) are NEVER toggleable — there's no
 *  legitimate scenario where a VA should manage billing or the brand. */
export const VA_PERMISSION_KEYS = [
  'generate_posts',
  'publish_to_socials',
  'manage_newsletter',
  'youtube_copilot',
  'manage_videos',
  'view_analytics',
] as const

export type VaPermissionKey = (typeof VA_PERMISSION_KEYS)[number]

export type VaPermissions = Record<VaPermissionKey, boolean>

/** Default permissions for a NEW invite. Sensible "content VA" preset:
 *  the VA can produce + publish + manage videos but can't send to your
 *  newsletter list or see analytics. Owner can toggle in the invite UI. */
export const DEFAULT_VA_PERMISSIONS: VaPermissions = {
  generate_posts:     true,
  publish_to_socials: true,
  manage_newsletter:  false,
  youtube_copilot:    true,
  manage_videos:      true,
  view_analytics:     false,
}

/** Human-readable label + description for each permission. Used by the
 *  invite form + the member-edit panel. Keep label under 30 chars. */
export const VA_PERMISSION_META: Record<VaPermissionKey, { label: string; help: string }> = {
  generate_posts:     { label: 'Generate blog posts',     help: 'Can use the Content page and the blog generator.' },
  publish_to_socials: { label: 'Publish to socials',      help: 'Can post to Facebook, Instagram, TikTok, Threads, Pinterest, X, Bluesky, Telegram.' },
  manage_newsletter:  { label: 'Manage newsletter',       help: 'Can compose and send newsletter broadcasts. Off by default — you control the list.' },
  youtube_copilot:    { label: 'YouTube Co-Pilot',        help: 'Can generate YouTube titles, descriptions, tags, and thumbnails.' },
  manage_videos:      { label: 'Manage video library',    help: 'Can add, edit, and remove videos in the content library.' },
  view_analytics:     { label: 'View analytics & SEO',    help: 'Can see Analytics, SEO dashboard, and content performance reports.' },
}

/** Routes a Virtual Assistant can NEVER access regardless of permissions.
 *  These are the owner-only surfaces: billing, brand identity, integrations,
 *  multi-site WordPress config, plugin connect tokens, and the team-
 *  management page itself (so VAs can't invite other VAs). Middleware +
 *  page-level checks both reference this list. */
export const BLOCKED_FOR_VAS: ReadonlyArray<string> = [
  '/branding',           // White-label config — owner's brand
  '/setup',              // Integrations (Geniuslink, Amazon, social OAuth) — owner's accounts
  '/customize',          // Blog customization
  '/billing',            // Stripe + tier management
  '/agency',             // VA management itself — VAs can't manage other VAs
  '/developers',         // API keys — owner-only
  '/admin',              // Internal MVP admin
]

/** True when the given pathname matches one of the BLOCKED_FOR_VAS roots.
 *  Used by middleware to short-circuit before the page renders. */
export function isPathBlockedForVa(pathname: string): boolean {
  return BLOCKED_FOR_VAS.some(blocked => pathname === blocked || pathname.startsWith(blocked + '/'))
}

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

/** Normalize a raw permissions value (from DB or request body) into a
 *  full VaPermissions object. Missing keys default to false. */
export function normalizePermissions(raw: unknown): VaPermissions {
  const out: VaPermissions = { ...DEFAULT_VA_PERMISSIONS }
  for (const k of VA_PERMISSION_KEYS) out[k] = false
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    for (const k of VA_PERMISSION_KEYS) {
      if (typeof r[k] === 'boolean') out[k] = r[k] as boolean
    }
  }
  return out
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
