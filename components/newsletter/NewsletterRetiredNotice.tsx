/**
 * Shown on /newsletter and /newsletter/compose in place of the tool while the
 * member newsletter is retired (lib/feature-flags NEWSLETTER_FOR_MEMBERS).
 * Admin still gets the tool; see useNewsletterRetired below.
 */

'use client'

import PageHero from '@/components/layout/PageHero'
import { NEWSLETTER_FOR_MEMBERS } from '@/lib/feature-flags'
import { useEffectiveTier } from '@/lib/useEffectiveTier'

/** 'loading' until the tier is known (so admin never flashes the notice),
 *  then true when this viewer should see the notice instead of the tool. */
export function useNewsletterRetired(): boolean | 'loading' {
  const tier = useEffectiveTier()
  if (NEWSLETTER_FOR_MEMBERS) return false
  if (tier === null) return 'loading'
  return tier !== 'admin'
}

export function NewsletterRetiredNotice() {
  return (
    <>
      <PageHero title="Newsletter" />
      <div className="max-w-xl rounded-2xl border border-[var(--border-2)] bg-[var(--surface-2)] p-5 text-sm text-[var(--text-2)]">
        The Newsletter tool has been retired and is no longer part of MVP. Everything else in your account works exactly as before.
      </div>
    </>
  )
}
