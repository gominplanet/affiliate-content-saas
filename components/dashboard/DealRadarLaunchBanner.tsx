// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// New-features launch announcement on the dashboard: Amazon Deal Radar
// (graduated out of Labs 2026-07-27, now open to all paid tiers) PLUS the
// shoppable Link-in-Bio Shop page and auto Instagram Stories that pair with it.
// The server page decides ELIGIBILITY (paid tier via canUseDealRadar) and
// renders this; the client component only handles "don't show again" dismissal
// via localStorage — same pattern as MetaLiveBanner / ProTourBanner (null guard
// avoids the SSR/CSR flicker).

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Radar, ArrowRight, X, ShieldCheck, Instagram, ShoppingBag } from 'lucide-react'

// Bump the version to re-surface the banner after a major change.
// v2: broadened from Deal-Radar-only to the full launch trio (Deal Radar +
// Shop page + auto IG Stories).
const STORAGE_KEY = 'mvp.dealRadarLaunch.dismissed.v2'

export default function DealRadarLaunchBanner() {
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

  return (
    <div
      className="relative rounded-2xl border transition-transform hover:scale-[1.005]"
      style={{
        background: 'linear-gradient(135deg, #F97316 0%, #EA580C 42%, #7C3AED 100%)',
        borderColor: 'rgba(124, 58, 237, 0.45)',
        boxShadow: '0 8px 32px -8px rgba(234, 88, 12, 0.55)',
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

      <Link href="/deal-radar" className="flex items-center gap-4 p-5 sm:p-6 pr-14 sm:pr-44">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255, 255, 255, 0.18)' }}
        >
          <Radar size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white">
              New · now on your plan
            </span>
          </div>
          <p className="text-[16px] sm:text-[17px] font-bold text-white">3 big new features are live 🎯</p>
          <p className="text-[13px] mt-1 text-white/90">
            <strong>Amazon Deal Radar</strong> finds real, price-verified deals in your niche — post them in one
            click, auto-generate <strong>Instagram Stories</strong>, and send followers to your new shoppable{' '}
            <strong>Shop page</strong>. All on your plan, no extra cost.
          </p>
          <div className="hidden sm:flex items-center gap-3 mt-2 text-[12px] font-medium text-white/85">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={13} /> Real deals only</span>
            <span className="inline-flex items-center gap-1"><Instagram size={13} /> Auto IG Stories</span>
            <span className="inline-flex items-center gap-1"><ShoppingBag size={13} /> Shoppable Shop page</span>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold bg-white text-[#EA580C] flex-shrink-0">
          Explore deals <ArrowRight size={13} />
        </span>
      </Link>
    </div>
  )
}
