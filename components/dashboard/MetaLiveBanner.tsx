// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Meta is live" discovery banner on the dashboard — surfaces the newly-
// approved Facebook / Instagram / Threads auto-posting to existing users who
// haven't connected a Meta account yet. (Meta App Review approved 2026-06-15.)
//
// The server page decides ELIGIBILITY (paid tier + no Meta account connected)
// and passes the tier-appropriate platform list as a prop; this client
// component only handles "don't show again" dismissal via localStorage —
// same pattern as ProTourBanner (null guard avoids the SSR/CSR flicker).

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Share2, ArrowRight, X } from 'lucide-react'

// Bump the version to re-surface the banner after a major change.
const STORAGE_KEY = 'mvp.metaLiveBanner.dismissed.v1'

/** "A, B & C" — natural-language join for the platform list. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} & ${items[1]}`
  return `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`
}

export default function MetaLiveBanner({ platforms }: { platforms: string[] }) {
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
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
  if (dismissed === null || dismissed) return null
  if (!platforms.length) return null

  const list = joinList(platforms)

  return (
    <div
      className="relative rounded-2xl border transition-transform hover:scale-[1.005]"
      style={{
        background: 'linear-gradient(135deg, #1877F2 0%, #4F46E5 58%, #7C3AED 100%)',
        borderColor: 'rgba(79, 70, 229, 0.45)',
        boxShadow: '0 8px 32px -8px rgba(79, 70, 229, 0.55)',
      }}
    >
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
        href="/connect-socials"
        className="flex items-center gap-4 p-5 sm:p-6 pr-14 sm:pr-44"
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255, 255, 255, 0.18)' }}
        >
          <Share2 size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white">
              Now live
            </span>
          </div>
          <p className="text-[16px] sm:text-[17px] font-bold text-white">{list} auto-posting is live</p>
          <p className="text-[13px] mt-1 text-white/85">
            Connect your {list} {platforms.length > 1 ? 'accounts' : 'account'} and MVP will auto-post every
            review there alongside your blog and other socials.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-white text-[#4F46E5] flex-shrink-0">
          Connect now <ArrowRight size={13} />
        </span>
      </Link>
    </div>
  )
}
