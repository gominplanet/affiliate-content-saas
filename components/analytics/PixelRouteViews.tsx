// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The PageView the inline pixel script cannot fire.
//
// app/layout.tsx fires PageView once, from a <Script> that runs on a hard page
// load. App Router navigation replaces the page without re-running it, so
// every page a visitor read after the first one was invisible, and the events
// that did fire on those pages were reported at the URL the visitor had
// arrived on. lib/pixel-routes has the measurements and the reasoning.
//
// This fills that gap for marketing pages only, and for navigation only: the
// first page of a visit is already counted by the inline script, so firing
// here on mount would double every landing.
//
// WHAT IT DOES NOT FIX, said plainly because the dataset will still show it: a
// member who hard-loads a dashboard page still produces a PageView from the
// inline script, filed at that dashboard URL. Making the inline script
// conditional means teaching a server component which route it is rendering,
// which it cannot know reliably. What this does remove is the much larger
// volume: 89 dashboard routes' worth of client-side navigation, which would
// have buried the funnel it exists to show.
'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackMeta } from '@/lib/meta-pixel'
import { countsAsFunnelView } from '@/lib/pixel-routes'

export default function PixelRouteViews() {
  const pathname = usePathname()
  // The path the inline script already counted. Seeded on the first effect
  // run rather than at render, so a visitor's landing page is recorded as
  // "seen" without a second event being sent for it.
  const counted = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (counted.current === null) {
      counted.current = pathname
      return
    }
    if (pathname === counted.current) return
    counted.current = pathname
    if (!countsAsFunnelView(pathname)) return
    trackMeta('PageView')
  }, [pathname])

  return null
}
