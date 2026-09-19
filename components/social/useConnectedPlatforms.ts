// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One hook, three modals. Deal Radar, Walmart and Wayward each have their own
// "Quick post to socials" and all three opened with every platform ticked, so
// all three produced the same complaint. Fixing them one at a time is how two
// of them end up fixed and the third does not.

'use client'

import { useEffect, useState } from 'react'
import { preselectPlatforms } from '@/lib/connected-platforms'

export interface ConnectedState {
  /** Platform keys the creator can actually post to. Empty until known. */
  connected: Set<string>
  /** false while in flight, or after a failed lookup. Never guess past this. */
  known: boolean
}

/**
 * Reads /api/social/connected once per mount.
 *
 * Starts `known: false` on purpose, which every caller must treat as "select
 * everything". The modal opens instantly and a slow lookup can only ever REMOVE
 * ticks a moment later; it can never leave a creator staring at a set of
 * buttons that is quietly smaller than their real reach with nothing on screen
 * to explain why.
 */
export function useConnectedPlatforms(): ConnectedState {
  const [state, setState] = useState<ConnectedState>({ connected: new Set(), known: false })
  useEffect(() => {
    let alive = true
    fetch('/api/social/connected')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok || !Array.isArray(d.connected)) return
        setState({ connected: new Set<string>(d.connected), known: !!d.known })
      })
      .catch(() => { /* leave known:false — every platform stays selectable */ })
    return () => { alive = false }
  }, [])
  return state
}

/**
 * The selection a modal should show, recomputed when the lookup lands.
 *
 * `offered` is what the PLAN allows (Pinterest and Instagram are tier-gated), so
 * the two questions stay separate: the plan decides what appears, the
 * connections decide what is ticked. Conflating them is how a paid feature
 * disappears from the screen because an unrelated account is not linked.
 */
export function useSelectedPlatforms(offered: string[], state: ConnectedState) {
  // Opens with everything ticked, which is the pre-change behaviour and the
  // right answer for the half-second before the lookup lands.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(offered))
  const [applied, setApplied] = useState(false)
  const offeredKey = offered.join(',')
  const connectedKey = [...state.connected].sort().join(',')
  useEffect(() => {
    // Applied EXACTLY ONCE, when the lookup lands. Re-applying on every change
    // would fight the creator: they untick Facebook, a render happens, and the
    // preselection puts it back. The whole complaint is about a modal that
    // ignores what the creator does with it.
    if (applied || !state.known) return
    setSelected(new Set(preselectPlatforms(offeredKey.split(',').filter(Boolean), connectedKey.split(',').filter(Boolean), true)))
    setApplied(true)
  }, [applied, state.known, offeredKey, connectedKey])
  return [selected, setSelected] as const
}
