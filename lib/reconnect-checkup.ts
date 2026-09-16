// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "RECONNECT YOUR ACCOUNTS" IS ADVICE. THIS IS THE LIST.
//
// A run of upgrades landed that a connection cannot pick up on its own, and the
// natural way to tell everyone is a notice saying "please reconnect everything".
// The trouble with that notice is the creator who reads it: they cannot tell
// which of their accounts needs anything, they cannot tell whether reconnecting
// helped, and the ones already fine are being sent to redo work for nothing.
//
// Worse, the cases that prompted it are invisible BY CONSTRUCTION. Each one is a
// connection that still reports healthy:
//
//   X          a grant is fixed at authorization and a refresh re-issues the
//              SAME grant, so an account connected before MVP asked for
//              media.write can never gain it. Posts keep succeeding. The
//              picture is simply dropped. Five accounts were in this state and
//              every screen in the product showed X as connected and working.
//   Geniuslink a key that was encrypted twice decrypts to another ciphertext.
//              Cloaking falls back to a plain link and publishes it. Nothing
//              errors, and the stored value cannot be recovered, so it has to
//              be typed in again.
//   WordPress  a site refusing writes still shows as connected until a publish
//              fails, and a plugin missing upload_files accepts the post and
//              drops the image.
//
// So this builds the list instead of the advice. Every item is a sentence about
// that creator's own account, and the three states are kept apart on purpose:
//
//   action   something is known to be wrong, and there is a link to fix it
//   unknown  we genuinely cannot tell from here, and say so
//   ok       checked, and fine
//
// `unknown` is the one worth defending. Reporting it as a problem sends people
// with perfectly good connections to redo them; folding it into `ok` hides the
// only cases we cannot see. It is its own answer because it is its own thing.

export type CheckupState = 'action' | 'unknown' | 'ok'

export interface CheckupItem {
  key: string
  label: string
  state: CheckupState
  /** A sentence about this creator's account, safe to render as-is. */
  detail: string
  href?: string
  actionLabel?: string
}

export interface CheckupInput {
  /** X is connected at all. Nothing is said about a channel nobody uses. */
  twitterConnected: boolean
  /** integrations.twitter_scopes: the grant as X issued it, or null if we never
   *  recorded one (every row predating migration 337). */
  twitterScopes: string | null | undefined
  /** A Geniuslink key and secret are both stored. */
  geniuslinkConfigured: boolean
  /** The stored key decrypts to another ciphertext, so it cannot be used. */
  geniuslinkUnreadable: boolean
  /** A WordPress site is connected. */
  wordpressConfigured: boolean
  /** A recent publish was refused with no success since (lib/wp-connection-health). */
  wordpressNeedsAttention: boolean
  /** Reactive social health: channels failing their scheduled posts. */
  deadChannels: { platform: string; label: string; message: string }[]
  /**
   * Proactive health, from integrations.connection_health: a token the nightly
   * refresh found revoked. This is the one that arrives EARLY. The reactive
   * list above only speaks after a channel has failed posts, which is after the
   * creator has already lost them.
   */
  staleTokens: { platform: string; label: string }[]
}

import { mediaCapability } from '@/lib/x-scopes'

/** Where a creator goes to redo each connection. */
const HREF = {
  socials: '/connect-socials',
  affiliate: '/brand#affiliate',
  wordpress: '/setup',
} as const

export function buildCheckup(input: CheckupInput): CheckupItem[] {
  const items: CheckupItem[] = []

  // ── X, and whether it can attach a picture ────────────────────────────────
  if (input.twitterConnected) {
    const capability = mediaCapability(input.twitterScopes)
    if (capability === 'no') {
      items.push({
        key: 'x-media',
        label: 'X (Twitter)',
        state: 'action',
        detail: 'Your X connection was made before MVP could upload pictures, and X fixes what an app may do at the moment you connect. Your posts go out, but without the image. Reconnecting once is the only way to change it.',
        href: HREF.socials,
        actionLabel: 'Reconnect X',
      })
    } else if (capability === 'unknown') {
      items.push({
        key: 'x-media',
        label: 'X (Twitter)',
        state: 'unknown',
        detail: 'We cannot tell whether your X connection is allowed to upload pictures, because it was made before MVP started recording that. If your posts have been going out without their image, reconnecting fixes it. If they have had images, nothing is wrong.',
        href: HREF.socials,
        actionLabel: 'Reconnect X',
      })
    } else {
      items.push({
        key: 'x-media',
        label: 'X (Twitter)',
        state: 'ok',
        detail: 'Connected, and allowed to post your picture alongside the text.',
      })
    }
  }

  // ── Geniuslink ───────────────────────────────────────────────────────────
  if (input.geniuslinkConfigured) {
    if (input.geniuslinkUnreadable) {
      items.push({
        key: 'geniuslink',
        label: 'Geniuslink',
        state: 'action',
        detail: 'Your Geniuslink key is stored in a form MVP can no longer read, so your links have been publishing uncloaked. The stored value cannot be recovered. Open Affiliate Link Routing and enter your key and secret again.',
        href: HREF.affiliate,
        actionLabel: 'Re-enter key',
      })
    } else {
      items.push({
        key: 'geniuslink',
        label: 'Geniuslink',
        state: 'ok',
        detail: 'Connected, and your links are being cloaked through it.',
      })
    }
  }

  // ── WordPress ────────────────────────────────────────────────────────────
  if (input.wordpressConfigured) {
    items.push(input.wordpressNeedsAttention
      ? {
        key: 'wordpress',
        label: 'WordPress',
        state: 'action',
        detail: 'Your site refused MVP\'s last publish and has not accepted one since. That is usually an app password that was reset, a security plugin blocking the write, or the MVP plugin being switched off. Reconnect it so your posts can go out again.',
        href: HREF.wordpress,
        actionLabel: 'Fix connection',
      }
      : {
        key: 'wordpress',
        label: 'WordPress',
        state: 'ok',
        detail: 'Connected, and accepting posts.',
      })
  }

  // ── A token the nightly refresh found dead ───────────────────────────────
  //
  // Ahead of everything else, because this is knowledge nobody had to lose a
  // post to get. A creator's Threads went stale, the refresh failed every night
  // into a console log, and the first thing that told him was a post failing
  // with a message that named no cause and did not suggest reconnecting.
  for (const stale of input.staleTokens) {
    if (items.some(i => i.key === `dead-${stale.platform}`)) continue
    items.push({
      key: `stale-${stale.platform}`,
      label: stale.label,
      state: 'action',
      detail: `Your ${stale.label} connection has gone stale, so posts to it will not go out. Nothing you did caused it: a ${stale.label} connection has to be renewed periodically and yours could not be. Reconnecting takes a few seconds and fixes it.`,
      href: HREF.socials,
      actionLabel: `Reconnect ${stale.label}`,
    })
  }

  // ── Anything already failing its scheduled posts ─────────────────────────
  //
  // These come from the reactive health system, which only speaks after a
  // channel has failed repeatedly. Included here so one screen answers the
  // whole question rather than sending people to look in two places.
  for (const dead of input.deadChannels) {
    if (dead.platform === 'twitter' && items.some(i => i.key === 'x-media' && i.state === 'action')) continue
    if (items.some(i => i.key === `stale-${dead.platform}`)) continue
    items.push({
      key: `dead-${dead.platform}`,
      label: dead.label,
      state: 'action',
      detail: dead.message,
      href: HREF.socials,
      actionLabel: `Reconnect ${dead.label}`,
    })
  }

  return items
}

export interface CheckupSummary {
  actions: number
  unknowns: number
  /** What the modal says at the top. Never "all good" when something is unknown. */
  headline: string
}

/**
 * The sentence at the top, which has to survive being read quickly.
 *
 * Three outcomes, three sentences, because this is the screen that decides
 * whether somebody does anything. A checkup that says "you're all set" while
 * holding an item it could not verify is the failure this whole module exists
 * to avoid, so an unknown never rounds down to fine.
 */
export function checkupSummary(items: CheckupItem[]): CheckupSummary {
  const actions = items.filter(i => i.state === 'action').length
  const unknowns = items.filter(i => i.state === 'unknown').length

  let headline: string
  if (actions > 0) {
    headline = actions === 1
      ? 'One of your connections needs redoing.'
      : `${actions} of your connections need redoing.`
  } else if (unknowns > 0) {
    headline = unknowns === 1
      ? 'One connection we could not check from here.'
      : `${unknowns} connections we could not check from here.`
  } else if (items.length > 0) {
    headline = 'Your connections are all current. Nothing to do.'
  } else {
    headline = 'Nothing connected yet, so there is nothing to reconnect.'
  }

  return { actions, unknowns, headline }
}
