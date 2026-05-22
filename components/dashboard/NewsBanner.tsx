'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone, X, ArrowRight } from 'lucide-react'

/**
 * Dashboard NEWS / announcement banner — red-tinted, dismissible.
 *
 * HOW TO POST AN ANNOUNCEMENT:
 *   1. Edit the NEWS object below (title + body, optional CTA).
 *   2. Bump NEWS.id to a new value.
 * Every user then sees the banner once on the dashboard until they X it out.
 * Because dismissal is keyed on the id, bumping the id re-shows a fresh
 * message even to users who dismissed the previous one.
 *
 * To hide the banner entirely, set NEWS = null.
 *
 * (This is separate from WhatsNew.tsx, which is for product/feature
 * changelogs. Use this one for general heads-up announcements.)
 */

const NEWS: {
  id: string
  title: string
  body: string
  ctaLabel?: string
  ctaHref?: string
} | null = {
  id: 'announcement-2026-05-22',
  title: 'Heads up',
  body: 'This is a sample announcement. Edit components/dashboard/NewsBanner.tsx (the NEWS object) and bump its id to post a new message — it shows here until each user dismisses it.',
  // ctaLabel: 'Learn more',
  // ctaHref: '/community',
}

const STORAGE_KEY = 'mvp_news_seen'

export default function NewsBanner() {
  // Start dismissed so we never flash the banner before hydration reads
  // localStorage.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!NEWS) return
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === NEWS.id)
    } catch {
      setDismissed(false)
    }
  }, [])

  if (!NEWS || dismissed) return null

  const news = NEWS
  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, news.id) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      className="card mb-6 p-4 relative"
      style={{
        background: 'linear-gradient(180deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.02) 100%)',
        borderColor: 'rgba(220, 38, 38, 0.3)',
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
        <div className="w-9 h-9 rounded-xl bg-[#dc2626]/10 flex items-center justify-center flex-shrink-0">
          <Megaphone size={16} className="text-[#dc2626]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{news.title}</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{news.body}</p>
          {news.ctaLabel && news.ctaHref && (
            <Link
              href={news.ctaHref}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#dc2626] hover:underline mt-2"
            >
              {news.ctaLabel} <ArrowRight size={11} />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
