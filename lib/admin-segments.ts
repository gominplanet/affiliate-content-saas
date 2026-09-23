// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Who counts as trial, who counts as paid, in one place.
//
// WHY THIS EXISTS. /api/admin/broadcast carried its own copy:
//
//     const PAID = new Set(['creator', 'studio', 'pro'])
//
// That set was written before the Amazon plan, and never grew. Amazon is the
// plan the ads sell and the only one with a live card on /amazon-influencer,
// and every one of its subscribers fell through both segments: not 'trial',
// not in PAID, and 'amazon' was not an option in the audience picker either.
// So "All paid" quietly skipped our paying customers, and the only way to
// reach them at all was to mail everybody.
//
// A segment that silently excludes people is worse than one that errors. The
// send succeeds, the screen says how many it went to, and nothing anywhere
// says who it missed. That is the failure this file is here to end: the sets
// are derived from lib/tier, so a new plan joins the right segment the day it
// is added rather than the day somebody notices.
//
// The hint strings are part of the contract, not decoration. "Creator +
// Studio + Pro" was the label on the button in the broadcast UI, and it was
// the one place the omission was visible to a human, in a form nobody reads
// as a list of who is excluded.

import { TIERS, type Tier } from '@/lib/tier'

/** Never in any segment. Staff accounts are not an audience. */
export const NEVER_MAIL: readonly Tier[] = ['admin'] as const

/** Everyone on a plan they pay for, frozen plans included: a grandfathered
 *  Creator subscriber is as paid as a new Amazon one, and an announcement
 *  about the product reaches them both. */
export const PAID_TIERS: readonly Tier[] = (Object.keys(TIERS) as Tier[])
  .filter((t) => !NEVER_MAIL.includes(t) && t !== 'trial'
    && ((TIERS[t] as { price?: number }).price ?? 0) > 0)

export type Segment = 'all' | 'trial' | 'paid' | Tier

/** Does a user on `tier` belong in `segment`? A user with no integrations row
 *  reads as 'trial' at the call site, which is what a brand-new signup is. */
export function inSegment(tier: string, segment: Segment): boolean {
  if ((NEVER_MAIL as readonly string[]).includes(tier)) return false
  switch (segment) {
    case 'all': return true
    case 'trial': return tier === 'trial'
    case 'paid': return (PAID_TIERS as readonly string[]).includes(tier)
    default: return tier === segment
  }
}

/** The audience picker, built from the plans that exist. */
export function segmentOptions(): { id: Segment; label: string; hint: string }[] {
  const paidLabels = PAID_TIERS.map((t) => TIERS[t].label).join(' + ')
  return [
    { id: 'all', label: 'All users', hint: 'Everyone except admin accounts' },
    { id: 'trial', label: 'Trial only', hint: 'Free accounts, including signups with no plan row yet' },
    { id: 'paid', label: 'All paid', hint: paidLabels },
    ...PAID_TIERS.map((t) => ({
      id: t as Segment,
      label: `${TIERS[t].label} only`,
      hint: `$${(TIERS[t] as { price?: number }).price}/mo subscribers`,
    })),
  ]
}
