'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone, X, ArrowRight } from 'lucide-react'

/**
 * Dashboard NEWS / announcement banner — red-tinted, dismissible.
 *
 * Content is managed (no deploy) from the admin "News banner" page
 * (/admin/announcement), which writes to the `announcements` table. This
 * component fetches the current active announcement from GET /api/announcement.
 *
 * Each announcement has its own id; dismissal is stored per-id in
 * localStorage, so publishing a new message re-shows it to everyone — even
 * users who dismissed the previous one.
 */

interface Announcement {
  id: string
  title: string
  body: string
  cta_label: string | null
  cta_href: string | null
}

const STORAGE_KEY = 'mvp_news_seen'

export default function NewsBanner() {
  const [news, setNews] = useState<Announcement | null>(null)
  // Start dismissed so we never flash a banner before we know what's live.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/announcement')
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const a = (d?.announcement as Announcement | null) ?? null
        if (!a) return
        setNews(a)
        try {
          setDismissed(localStorage.getItem(STORAGE_KEY) === a.id)
        } catch {
          setDismissed(false)
        }
      })
      .catch(() => { /* no banner on error */ })
    return () => { alive = false }
  }, [])

  if (!news || dismissed) return null

  const a = news
  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, a.id) } catch { /* ignore */ }
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
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{a.title}</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{a.body}</p>
          {a.cta_label && a.cta_href && (
            <Link
              href={a.cta_href}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#dc2626] hover:underline mt-2"
            >
              {a.cta_label} <ArrowRight size={11} />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
