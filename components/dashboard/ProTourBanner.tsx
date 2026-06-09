// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /pro-tour entry banner on the dashboard — full-bleed purple gradient
// hero card that links to the long-form capabilities tour at /pro-tour.
//
// Extracted from the server-component dashboard into a client component
// so the user can dismiss it ("don't show again"). Dismissal persists
// to localStorage — no DB schema change, no per-device sync. The whole
// surface gracefully no-ops if storage isn't available (e.g. embedded
// in an iframe with storage blocked) because the dismissed=null guard
// keeps the banner rendered as a normal "first visit" state.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Compass, ArrowRight, X } from 'lucide-react'

// Bumping this version invalidates the dismissal — when we ship a major
// expansion of /pro-tour worth re-surfacing the banner, increment from v1.
const STORAGE_KEY = 'mvp.proTourBanner.dismissed.v1'

export default function ProTourBanner() {
  // null = "not yet read from storage" — guards against the SSR/CSR hydration
  // mismatch that would happen if we naively initialized to false and then
  // flipped to true on first effect (the server-rendered HTML would briefly
  // show the banner to a user who'd dismissed it).
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // Storage unavailable — keep showing the banner. We'd rather render
      // the entry point than hide it because of a privacy mode quirk.
      setDismissed(false)
    }
  }, [])

  function dismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try { window.localStorage.setItem(STORAGE_KEY, '1') } catch { /* non-fatal */ }
    setDismissed(true)
  }

  // First paint: render nothing until we know whether they dismissed.
  // Avoids the flicker described above.
  if (dismissed === null) return null
  if (dismissed) return null

  return (
    <div
      className="relative rounded-2xl border transition-transform hover:scale-[1.005]"
      style={{
        background: 'linear-gradient(135deg, #7C3AED 0%, #9D6BFF 55%, #C084FC 100%)',
        borderColor: 'rgba(124, 58, 237, 0.45)',
        boxShadow: '0 8px 32px -8px rgba(124, 58, 237, 0.55)',
      }}
    >
      {/* The dismiss control: top-right pill with icon + label so the
          affordance is explicit ("an X to close that says I do not want
          to see this notice again"). Lives ABOVE the Link in z-order so
          a click never accidentally navigates to /pro-tour. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Don't show this banner again"
        title="Don't show this banner again"
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white/90 hover:text-white bg-white/15 hover:bg-white/25 transition-colors"
      >
        <span className="hidden sm:inline">Don&apos;t show again</span>
        <X size={12} aria-hidden="true" />
      </button>

      <Link
        href="/pro-tour"
        className="flex items-center gap-4 p-5 sm:p-6 pr-14 sm:pr-40"
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255, 255, 255, 0.18)' }}
        >
          <Compass size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white">
              Capabilities tour
            </span>
          </div>
          <p className="text-[16px] sm:text-[17px] font-bold text-white">See everything Pro can do for you</p>
          <p className="text-[13px] mt-1 text-white/85">
            The full tour of every Pro feature live today — generation engine, SEO, newsletter, brand deals,
            multi-site, VAs, white-label, and more.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-white text-[#7C3AED] flex-shrink-0">
          Read the tour <ArrowRight size={13} />
        </span>
      </Link>
    </div>
  )
}
