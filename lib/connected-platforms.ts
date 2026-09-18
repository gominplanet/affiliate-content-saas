// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH SOCIALS THIS CREATOR CAN ACTUALLY POST TO.
//
// The "Quick post to socials" modal opened with every platform selected, on
// every surface that has one (Deal Radar, Walmart, Wayward). A creator with one
// connected network had to unselect six buttons before every single post, and
// the cost of forgetting was not nothing: the post went out to the one that
// works and came back with six red errors saying the others failed, which reads
// as a broken product rather than as six accounts that were never connected.
// Gina asked for this after doing it by hand for weeks.
//
// THE TRAP, and it is the whole reason this file exists rather than a two-line
// check in the modal: a "connected" list assembled from whatever columns looked
// relevant is a SECOND opinion about connectedness, and the moment it disagrees
// with the publisher the creator gets the worse of both. Say connected when the
// publisher will refuse and they are back to a red error, except now the button
// promised it would work. Say not connected when the publisher would have
// succeeded and we have quietly removed a working channel from their reach, and
// nothing on screen explains why.
//
// So each predicate below is the NEGATION OF THE PUBLISHER'S OWN THROW, copied
// from lib/deal-social-publish.ts line for line:
//
//   twitter    if (!token) throw new Error('X is not connected.')
//   facebook   if (!acct) throw new Error('Facebook Page is not connected.')
//   threads    if (!acct) throw new Error('Threads is not connected.')
//   linkedin   if (!token || !person) throw 'LinkedIn is not connected.'
//   telegram   if (!token || !channel) throw 'Telegram is not connected.'
//   bluesky    if (!handle || !appPw) throw 'Bluesky is not connected.'
//
// Facebook and Threads resolve through social_accounts with the legacy columns
// as fallback, so this module cannot decide them from an integrations row alone
// and takes them as arguments. That is deliberate: the caller does the same
// resolveSocialAccount the publisher does, and passing the result in keeps this
// function pure and testable.
//
// scripts/test-connected-platforms.ts holds the two in sync by reading both
// files: every platform the publisher can throw "not connected" for must have a
// predicate here, so adding a seventh network to the publisher and forgetting
// this file fails the build rather than shipping a button that lies.

import type { QuickPostPlatform } from '@/lib/deal-social-publish'

/** The decrypted integrations row, as far as this module cares about it. */
export interface ConnectionRow {
  twitter_access_token?: string | null
  linkedin_access_token?: string | null
  linkedin_person_id?: string | null
  telegram_bot_token?: string | null
  telegram_channel_id?: string | null
  bluesky_handle?: string | null
  bluesky_app_password?: string | null
  pinterest_access_token?: string | null
  instagram_user_id?: string | null
  instagram_access_token?: string | null
}

export interface ResolvedElsewhere {
  /** A Facebook Page resolved the way the publisher resolves it. */
  facebook: boolean
  /** A Threads profile resolved the way the publisher resolves it. */
  threads: boolean
  /** Telegram falls back to the platform bot when the creator has no own bot. */
  platformTelegramBot?: boolean
}

const has = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0

/**
 * The six caption-link platforms this creator can post to right now.
 *
 * Returns platform keys, never labels: the modal, the publisher and the
 * scheduler all key off the same strings, and a label is a display concern that
 * has no business deciding what gets posted.
 */
export function connectedQuickPostPlatforms(
  row: ConnectionRow | null | undefined,
  resolved: ResolvedElsewhere,
): QuickPostPlatform[] {
  const r = row || {}
  const out: QuickPostPlatform[] = []
  if (has(r.twitter_access_token)) out.push('twitter')
  if (resolved.facebook) out.push('facebook')
  if (resolved.threads) out.push('threads')
  if (has(r.linkedin_access_token) && has(r.linkedin_person_id)) out.push('linkedin')
  // Telegram posts through the creator's own bot OR the platform bot, so the
  // token half of the publisher's check can be satisfied by an env var this
  // module cannot see. The caller reports whether that fallback exists.
  if ((has(r.telegram_bot_token) || !!resolved.platformTelegramBot) && has(r.telegram_channel_id)) out.push('telegram')
  if (has(r.bluesky_handle) && has(r.bluesky_app_password)) out.push('bluesky')
  return out
}

/** Pinterest and Instagram are separate pipelines, so they answer separately. */
export function pinterestConnected(row: ConnectionRow | null | undefined): boolean {
  return has((row || {}).pinterest_access_token)
}

export function instagramConnected(row: ConnectionRow | null | undefined, resolvedIg?: boolean): boolean {
  if (resolvedIg) return true
  const r = row || {}
  return has(r.instagram_user_id) && has(r.instagram_access_token)
}

/**
 * What the modal should preselect, given what the plan offers and what is
 * actually connected.
 *
 * THREE STATES, NOT TWO, and keeping them apart is the whole job:
 *
 *   known=false   the lookup did not complete — the request failed, or has not
 *                 come back yet. Preselect everything, exactly as before this
 *                 change. A failed lookup must never silently untick a channel
 *                 that works; the creator would see a quietly smaller set of
 *                 buttons with nothing on screen to explain it.
 *   known, some   preselect only those. This is Gina's case and the common one.
 *   known, none   preselect NOTHING, and the modal says so in words with a way
 *                 to connect. Preselecting all here is what produced the
 *                 complaint: press Post, get seven red errors for seven
 *                 accounts that were never connected.
 *
 * Preselection is the only thing decided here. The modal still lets an
 * unconnected platform be ticked by hand, deliberately: if a predicate in this
 * file is ever wrong, being wrong costs the creator one extra click rather than
 * locking them out of a channel that works.
 */
export function preselectPlatforms(
  offered: string[],
  connected: string[],
  known: boolean,
): string[] {
  if (!known) return offered
  const set = new Set(connected)
  return offered.filter((k) => set.has(k))
}
