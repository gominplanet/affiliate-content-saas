'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, X, ArrowRight } from 'lucide-react'

/**
 * "What's new" callout on the dashboard.
 *
 * Bump CURRENT_ID whenever you ship something worth surfacing — every user
 * sees the new banner once, until they dismiss it. Dismissal is per-id, so
 * future updates re-show even if the previous one was dismissed.
 *
 * Storage key: `mvp_whatsnew_seen` — value is the id of the last dismissed
 * release. If it matches CURRENT_ID, we hide.
 */

const CURRENT_ID = 'instagram-image-posts-2026-05-15'
const STORAGE_KEY = 'mvp_whatsnew_seen'

export default function WhatsNew() {
  const [dismissed, setDismissed] = useState(true) // start true so we don't flash before hydration

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY)
      setDismissed(seen === CURRENT_ID)
    } catch {
      setDismissed(false)
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, CURRENT_ID) } catch { /* ignore */ }
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <div
      className="card mb-6 p-5 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(240, 148, 51, 0.06) 0%, rgba(220, 39, 67, 0.06) 50%, rgba(188, 24, 136, 0.06) 100%)',
        borderColor: 'rgba(220, 39, 67, 0.25)',
      }}
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' }}
        >
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#bc1888]">New</span>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Instagram image posts for long-form videos</p>
          </div>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
            Your horizontal YouTube reviews now auto-compose into a 1080×1350 Instagram
            feed post — title, thumbnail, excerpt, and brand colors. We also generate a
            matching 9:16 Story so nothing zoom-crops. Pro plan.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/content"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' }}
            >
              Try it on a horizontal video <ArrowRight size={11} />
            </Link>
            <button
              onClick={dismiss}
              className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
