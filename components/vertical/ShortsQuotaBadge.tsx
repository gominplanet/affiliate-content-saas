// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
'use client'

/**
 * HOW MANY SHORTS ARE LEFT, WHERE THE RENDER BUTTON IS.
 *
 * 17 Sep 2026, from a Pro creator:
 *
 *   "Hi Seb I am on the pro plan is there a limit to how many renders I can do
 *    now in clip factory? It says I hit my limit of 50."
 *
 * The cap is real and it was working. 50 finished Shorts per billing period,
 * Pro, claimed atomically so concurrent renders cannot slip past it. Her red
 * message was correct.
 *
 * What she never got was a number that moved. The count existed in exactly one
 * place: a small pill beside the Clip Factory page title, loaded once on mount
 * and refreshed only when somebody clicked "Use this clip". She rendered her way
 * to fifty with that pill sitting at whatever it read when the page opened,
 * scrolled far above the Render Short button she was actually pressing. The
 * Shorts Studio modal, which renders through the same capped route, had no
 * counter at all.
 *
 * So the first news of a limit was being refused, and the only honest question
 * left was the one she asked: is there a limit?
 *
 * This puts the number at the decision. It refreshes after every render rather
 * than on mount, because a counter that does not move is worse than no counter:
 * it reads as evidence there is plenty left.
 */

import { useCallback, useEffect, useState } from 'react'

const PURPLE = '#7C3AED'
const EVENT = 'mvp:shorts-usage-changed'

export interface ShortsUsage {
  used: number
  /** null = unlimited (admin). */
  limit: number | null
  remaining: number | null
  resetLabel: string
}

/**
 * Tell every badge on the page that a Short was rendered.
 *
 * A window event rather than a prop chain because the surfaces that render are
 * not all children of the surface that counts: Clip Factory's header pill, the
 * inline create panel and the Shorts Studio modal are three separate trees. The
 * prop chain is how the modal ended up with no counter in the first place.
 */
export function notifyShortsUsageChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** Shared loader, so the pill and any caller read one shape. */
export function useShortsUsage(): { usage: ShortsUsage | null; reload: () => void } {
  const [usage, setUsage] = useState<ShortsUsage | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/youtube/shorts/usage', { cache: 'no-store' })
      if (res.ok) setUsage(await res.json() as ShortsUsage)
    } catch {
      // A failed read leaves the last known number rather than replacing it
      // with a zero. Inventing "50 left" is the failure this file exists for.
    }
  }, [])
  useEffect(() => {
    void load()
    const onChange = () => { void load() }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [load])
  return { usage, reload: load }
}

/** How close to the cap counts as worth warning about. Five is roughly a day's
 *  work for the creators who hit this, so it arrives while there is still time
 *  to choose which clips are worth a slot. */
export const LOW_WATER = 5

/**
 * Which of the three things this pill is saying. Pure, exported and tested,
 * because the first version of this decision lived inline in the JSX where the
 * only thing a test could do was grep for the constant's name — and a guard
 * that greps for a name passes when the name survives and the behaviour does
 * not. Verified by renaming the constant and watching the test still pass.
 */
export function quotaTone(remaining: number): 'spent' | 'low' | 'ok' {
  if (remaining <= 0) return 'spent'
  return remaining <= LOW_WATER ? 'low' : 'ok'
}

/**
 * The pill. Renders nothing for admin (no limit) and nothing until the first
 * answer arrives, because a placeholder number is a claim.
 */
export function ShortsQuotaBadge({ className = '' }: { className?: string }) {
  const { usage } = useShortsUsage()
  if (!usage || usage.limit === null) return null
  const remaining = usage.remaining ?? Math.max(0, usage.limit - usage.used)
  const tone = quotaTone(remaining)
  const spent = tone === 'spent'
  const low = tone === 'low'
  const style = spent
    ? { borderColor: '#ff3b30', color: '#ff3b30' }
    : low
      ? { borderColor: '#ff9500', color: '#b45309' }
      : { borderColor: `${PURPLE}66`, color: PURPLE }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${className}`}
      style={style}
      title={usage.resetLabel ? `Resets ${usage.resetLabel}` : undefined}
    >
      {/* Remaining, not used. "38 / 50" needs arithmetic to become a decision;
          "12 Shorts left" is already one. The cap is still shown, because a
          creator asking "is there a limit" wants the number, and because the
          reset date is the other half of the answer. */}
      {spent
        ? `No Shorts left this period${usage.resetLabel ? ` · resets ${usage.resetLabel}` : ''}`
        : `${remaining} of ${usage.limit} Shorts left${low && usage.resetLabel ? ` · resets ${usage.resetLabel}` : ''}`}
    </span>
  )
}
