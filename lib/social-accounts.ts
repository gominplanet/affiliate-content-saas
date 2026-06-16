/**
 * Multi-account social helpers (Facebook Pages + Instagram + Threads).
 *
 * The `social_accounts` table (migration 057) holds ONE row per connectable
 * destination — a Facebook Page, an Instagram account, a Threads profile.
 * `platform` is a free-text column (no CHECK constraint) so new platforms need
 * no migration. Posting routes resolve
 * which destination a post goes to, in priority order:
 *   1. an explicit `social_accounts.id` passed per-post  (PRO only — picking
 *      among several accounts is the Pro upgrade), else
 *   2. the user's `is_default` row for that platform, else
 *   3. the legacy single columns on `integrations`  (zero-migration fallback,
 *      so nothing breaks for users whose social_accounts wasn't populated).
 *
 * SECURITY: access_token must NEVER reach the browser. `listForClient`
 * strips it; only the server-side resolve path reads it.
 *
 * The repo has no generated Supabase types (the client is cast to `any`
 * everywhere because the row types resolve to `never`), so these helpers
 * accept a loosely-typed client to match that house style.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'

export type SocialPlatform = 'facebook' | 'instagram' | 'threads'

/** A connectable destination, resolved for server-side posting. */
export interface ResolvedAccount {
  /** social_accounts.id, or null when resolved from the legacy columns. */
  id: string | null
  /** Native id — FB Page id / IG user id. */
  externalId: string
  /** The page/account access token. Server-side only. */
  accessToken: string
  displayName: string | null
}

/** Safe shape returned to the browser — NO access_token. */
export interface SocialAccountListItem {
  id: string
  platform: SocialPlatform
  externalId: string
  displayName: string | null
  kind: string
  isDefault: boolean
}

/** Legacy `integrations` credentials, used as the final resolve fallback. */
export interface LegacyCreds {
  externalId?: string | null
  accessToken?: string | null
  displayName?: string | null
}

/**
 * List a user's connected accounts for a platform (or all), token-stripped.
 * Safe to feed straight to a client component.
 */
export async function listSocialAccounts(
  supabase: any,
  userId: string,
  platform?: SocialPlatform,
): Promise<SocialAccountListItem[]> {
  let q = supabase
    .from('social_accounts')
    .select('id,platform,external_id,display_name,kind,is_default')
    .eq('user_id', userId)
  if (platform) q = q.eq('platform', platform)
  const { data, error } = await q.order('is_default', { ascending: false }).order('display_name', { ascending: true })
  if (error || !data) return []
  return (data as any[]).map((r) => ({
    id: r.id,
    platform: r.platform,
    externalId: r.external_id,
    displayName: r.display_name,
    kind: r.kind,
    isDefault: !!r.is_default,
  }))
}

/**
 * Resolve the destination a post should publish to.
 *
 * @param socialAccountId  explicit per-post selection (honored only when
 *                         `allowSelection` is true — i.e. the user is Pro).
 * @param allowSelection   gate: non-Pro users always fall through to their
 *                         default/legacy account regardless of what id they
 *                         pass, so the multi-account picker can't be abused.
 * @param legacy           legacy `integrations` creds for the final fallback.
 */
export async function resolveSocialAccount(
  supabase: any,
  userId: string,
  platform: SocialPlatform,
  opts: { socialAccountId?: string | null; allowSelection: boolean; legacy?: LegacyCreds },
): Promise<ResolvedAccount | null> {
  const { socialAccountId, allowSelection, legacy } = opts

  // 1. Explicit selection — Pro only. Verify ownership + platform.
  // (Tokens are encrypted at rest per the 2026-06-02 rollout — every
  // accessToken in the returned ResolvedAccount is plaintext thanks to
  // maybeDecrypt() right before return.)
  if (socialAccountId && allowSelection) {
    const { data } = await supabase
      .from('social_accounts')
      .select('id,external_id,access_token,display_name')
      .eq('id', socialAccountId)
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle()
    if (data?.external_id && data?.access_token) {
      return { id: data.id, externalId: data.external_id, accessToken: maybeDecrypt(data.access_token) || '', displayName: data.display_name }
    }
    // Fall through if the id was bogus / not theirs rather than failing the post.
  }

  // 2. The user's default row for this platform.
  const { data: def } = await supabase
    .from('social_accounts')
    .select('id,external_id,access_token,display_name')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('is_default', true)
    .maybeSingle()
  if (def?.external_id && def?.access_token) {
    return { id: def.id, externalId: def.external_id, accessToken: maybeDecrypt(def.access_token) || '', displayName: def.display_name }
  }

  // 3. Legacy integrations columns (zero-migration safety net).
  // These come from the caller already decrypted via decryptIntegrationRow,
  // so no double-decrypt here.
  if (legacy?.externalId && legacy?.accessToken) {
    return { id: null, externalId: legacy.externalId, accessToken: legacy.accessToken, displayName: legacy.displayName ?? null }
  }

  return null
}

/**
 * Upsert all of a user's Facebook Pages into social_accounts and mark the
 * active one as default. Called from the FB connect routes so the picker
 * has every page the user manages (not just the active one). Idempotent.
 */
export async function syncFacebookAccounts(
  supabase: any,
  userId: string,
  pages: Array<{ id: string; name: string; access_token: string }>,
  activePageId: string,
): Promise<void> {
  if (!pages.length) return
  const now = new Date().toISOString()
  // Encrypt access tokens at rest (2026-06-02). resolveSocialAccount()
  // decrypts on the way out.
  const rows = pages.map((p) => ({
    user_id: userId,
    platform: 'facebook' as const,
    external_id: p.id,
    display_name: p.name,
    kind: 'page',
    access_token: maybeEncrypt(p.access_token),
    is_default: p.id === activePageId,
    updated_at: now,
  }))
  await supabase.from('social_accounts').upsert(rows, { onConflict: 'user_id,platform,external_id' })
}

/**
 * Upsert an Instagram account into social_accounts and make it the default.
 *
 * Multiple IG accounts accumulate here (one row each) as the user connects
 * them via Instagram Login. The most recently connected becomes the default,
 * so we clear the flag on the others first. token_expiry (epoch ms) is stashed
 * in `extra` so the post route can refresh the right account's token.
 */
export async function syncInstagramAccount(
  supabase: any,
  userId: string,
  account: { externalId: string; username: string | null; accessToken: string; tokenExpiry?: number | null },
): Promise<void> {
  if (!account.externalId || !account.accessToken) return
  // This account becomes the new default — clear the flag on the others.
  await supabase
    .from('social_accounts')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('platform', 'instagram')
  await supabase.from('social_accounts').upsert(
    {
      user_id: userId,
      platform: 'instagram',
      external_id: account.externalId,
      display_name: account.username,
      kind: 'account',
      access_token: maybeEncrypt(account.accessToken),
      extra: account.tokenExpiry ? { token_expiry: account.tokenExpiry } : {},
      is_default: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,platform,external_id' },
  )
}

/**
 * Upsert a Threads profile into social_accounts and make it the default.
 *
 * Mirrors syncInstagramAccount: multiple Threads profiles accumulate (one row
 * each) and the most recently connected becomes the default. The legacy
 * integrations.threads_* columns stay populated in parallel, so the existing
 * single-account Threads post path keeps working until callers read from
 * social_accounts. token_expiry (epoch ms) is stashed in `extra` for refresh.
 */
export async function syncThreadsAccount(
  supabase: any,
  userId: string,
  account: { externalId: string; username: string | null; accessToken: string; tokenExpiry?: number | null },
): Promise<void> {
  if (!account.externalId || !account.accessToken) return
  // This profile becomes the new default — clear the flag on the others.
  await supabase
    .from('social_accounts')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('platform', 'threads')
  await supabase.from('social_accounts').upsert(
    {
      user_id: userId,
      platform: 'threads',
      external_id: account.externalId,
      display_name: account.username,
      kind: 'account',
      access_token: maybeEncrypt(account.accessToken),
      extra: account.tokenExpiry ? { token_expiry: account.tokenExpiry } : {},
      is_default: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,platform,external_id' },
  )
}

/**
 * Remove all of a user's accounts for a platform. Called from the disconnect
 * routes so revoked tokens don't linger in the picker. Scoped to user+platform.
 */
export async function deleteSocialAccountsForPlatform(
  supabase: any,
  userId: string,
  platform: SocialPlatform,
): Promise<void> {
  await supabase
    .from('social_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform)
}

/**
 * Make `externalId` the default for a platform (and clear the flag on the
 * others). Used by the FB "switch active page" route so the legacy active
 * page and the social_accounts default stay in sync.
 */
export async function setDefaultSocialAccount(
  supabase: any,
  userId: string,
  platform: SocialPlatform,
  externalId: string,
): Promise<void> {
  // Clear existing defaults for this platform, then set the chosen one.
  await supabase
    .from('social_accounts')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('platform', platform)
  await supabase
    .from('social_accounts')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('external_id', externalId)
}
