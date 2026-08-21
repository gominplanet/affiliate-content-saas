'use client'

/**
 * AnnouncementModal — a center-screen popup for an admin announcement whose
 * variant is 'modal'. Same source as the dashboard NewsBanner (the
 * `announcements` table via GET /api/announcement) and the same per-id
 * dismissal, but shown as a modal so an action-needed message (e.g. "reconnect
 * your link shortener") isn't missed. Mounted in the dashboard shell so it can
 * pop on any page. NewsBanner ignores the 'modal' variant, so there's no
 * double render.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Megaphone, X, ArrowRight } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  body: string
  cta_label: string | null
  cta_href: string | null
  variant?: string | null
}

const STORAGE_KEY = 'mvp_news_seen'

export default function AnnouncementModal() {
  const [news, setNews] = useState<Announcement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/announcement')
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const a = (d?.announcement as Announcement | null) ?? null
        if (!a || a.variant !== 'modal') return
        let seen = false
        try { seen = localStorage.getItem(STORAGE_KEY) === a.id } catch { seen = false }
        if (seen) return
        setNews(a)
        setOpen(true)
      })
      .catch(() => { /* no modal on error */ })
    return () => { alive = false }
  }, [])

  if (!news || !open) return null
  const a = news

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, a.id) } catch { /* ignore */ }
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={dismiss}>
      <div
        className="card w-full max-w-md p-6 bg-white dark:bg-[#18181b] relative"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#dc2626]/10">
            <Megaphone size={18} className="text-[#dc2626]" />
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{a.title}</p>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed whitespace-pre-line">{a.body}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={dismiss}
            className="px-3 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-black/[0.03] dark:hover:bg-white/5"
          >
            Dismiss
          </button>
          {a.cta_label && a.cta_href && (
            <Link
              href={a.cta_href}
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9]"
            >
              {a.cta_label} <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
