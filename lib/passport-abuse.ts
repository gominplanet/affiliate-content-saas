// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Protecting a shared domain from one bad account.
//
// Every creator's Passport links live on mvpl.ink. That is one reputation,
// shared. If a single account mints ten thousand links at a spam destination,
// the domain gets flagged and every other creator's links stop working, with no
// warning and nothing they did wrong. Pinterest already blocks the domain as a
// redirector; a blocklist entry on top of that would be much harder to undo.
//
// So the controls here are not about rationing. A real creator should never see
// them. They exist so that when something goes wrong it hits one account
// instead of all of them, and so there is a record to show a platform reviewer
// that the domain is policed rather than open.
//
// Three parts, kept pure so the thresholds are readable and testable rather
// than buried in a mint function:
//   - how many links an account may create, per tier
//   - whether a burst is over that
//   - a link that can be switched off without touching anyone else's
//
// NOT included, deliberately: restricting destinations to Amazon only. Passport
// already supports non-Amazon store and brand links as a shipped feature, and
// isSafePassportDestination (lib/passport-links) already refuses private hosts,
// self-referential loops and credential-in-URL tricks. Removing a capability
// people use is a bigger cost than the abuse it would prevent.

import type { Tier } from '@/lib/tier'

export interface MintAllowance {
  perHour: number
  perDay: number
}

/**
 * Deliberately generous. A creator running Deal Radar hard, publishing a
 * roundup and pushing to every channel might mint a few hundred links in a busy
 * day, and MVP must not be the thing that stops them. These numbers are set
 * where no plausible human workflow reaches them, so anything that does is
 * either broken code or someone abusing the domain, and both are worth halting.
 *
 * Infinity for admin: the account that has to clean up an incident cannot be
 * the account that gets rate limited doing it.
 */
export function mintAllowance(tier: Tier | null | undefined): MintAllowance {
  switch (tier) {
    case 'admin': return { perHour: Infinity, perDay: Infinity }
    case 'pro':
    case 'studio': return { perHour: 500, perDay: 3000 }
    case 'creator':
    case 'amazon': return { perHour: 250, perDay: 1500 }
    // Below the paid tiers Passport is not available at all (canUsePassport),
    // so this is a floor rather than a real allowance.
    default: return { perHour: 20, perDay: 50 }
  }
}

export interface MintVerdict {
  allowed: boolean
  /** Shown to the creator. Null when allowed. */
  reason: string | null
  /** For the log. Names the window that tripped, so an incident is diagnosable. */
  window: 'hour' | 'day' | null
}

/**
 * May this account mint another link right now?
 *
 * Counts are "links this account created in the last hour / last 24 hours".
 * Both windows exist because they catch different things: an hour catches a
 * runaway loop, a day catches a slow bulk import that would still poison the
 * domain by tomorrow.
 */
export function mintVerdict(
  counts: { lastHour: number; lastDay: number },
  tier: Tier | null | undefined,
): MintVerdict {
  const allow = mintAllowance(tier)
  const hour = Math.max(0, Math.floor(counts.lastHour || 0))
  const day = Math.max(0, Math.floor(counts.lastDay || 0))

  if (hour >= allow.perHour) {
    return {
      allowed: false,
      window: 'hour',
      reason: `That is ${hour} new links in an hour, which is past the limit for your plan. Existing links keep working. If this was not you, change your password; if it was, get in touch and we will raise it.`,
    }
  }
  if (day >= allow.perDay) {
    return {
      allowed: false,
      window: 'day',
      reason: `That is ${day} new links today, which is past the daily limit for your plan. Existing links keep working. Get in touch if you genuinely need more.`,
    }
  }
  return { allowed: true, reason: null, window: null }
}

/**
 * Should this stored link still redirect?
 *
 * A link is switched off per row rather than per account, so a moderator can
 * kill one bad link, or one account's links, while every other creator on the
 * domain is untouched. That per-row switch is the whole point: without it the
 * only lever is taking the domain down for everybody.
 */
export function linkIsLive(row: { disabled?: boolean | null } | null | undefined): boolean {
  return !!row && row.disabled !== true
}
