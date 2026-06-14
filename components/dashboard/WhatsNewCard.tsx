'use client'

/**
 * WhatsNewCard — a compact, dismissible "What's new" panel that tells EXISTING
 * users about the last batch of product updates. Distinct from <NewsBanner/>
 * (which shows ONE admin-managed announcement at a time) — this is a short,
 * hand-curated changelog rendered as labelled badge rows.
 *
 * To publish a new batch: bump RELEASE_ID and replace UPDATES. The new RELEASE_ID
 * means everyone — even people who dismissed the previous batch — sees it once
 * more (dismissal is stored per-release in localStorage).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, X, ArrowUpRight } from 'lucide-react'

// Bump this whenever UPDATES changes — re-shows the card to everyone.
const RELEASE_ID = '2026-06-14'
const STORAGE_KEY = 'mvp_whats_new_seen'

interface Update {
  badge: string
  tone: string // accent color for the badge chip
  title: string
  desc: string
  href?: string
}

const UPDATES: Update[] = [
  {
    badge: 'PRO',
    tone: '#7C3AED',
    title: 'Multiple YouTube channels',
    desc: 'Connect more than one channel, pick a default per site, and pull videos from a secondary channel into any blog.',
    href: '/connect-youtube',
  },
  {
    badge: 'NEW',
    tone: '#34c759',
    title: 'Published Posts, all in one place',
    desc: 'Reviews, comparisons, guides and link posts now live together in one chronological feed — nothing hidden.',
    href: '/content',
  },
  {
    badge: 'IMPROVED',
    tone: '#FF9500',
    title: 'Smarter Blog Post Generator',
    desc: 'Link posts now recloak with Geniuslink, hyperlink your affiliate link through the article, and support manual edits.',
    href: '/content',
  },
  {
    badge: 'NEW',
    tone: '#0a84ff',
    title: 'A dashboard that points you to wins',
    desc: 'See your catalog gaps, posts one push from page 1, posts losing rank, and your real affiliate link clicks at a glance.',
    href: '/dashboard',
  },
  {
    badge: 'NEW',
    tone: '#bc1888',
    title: 'Bulk indexing checks',
    desc: 'On the SEO hub, hit “Check visible” to re-pull Google indexing status for every post at once.',
    href: '/seo',
  },
]

export default function WhatsNewCard() {
  // Start hidden so we never flash before we know the dismissal state.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === RELEASE_ID)
    } catch {
      setDismissed(false)
    }
  }, [])

  if (dismissed) return null

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE_ID) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      className="rounded-2xl border p-5 relative mb-6"
      style={{
        background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.06) 0%, rgba(188, 24, 136, 0.05) 100%)',
        borderColor: 'rgba(124, 58, 237, 0.22)',
      }}
    >
      <button
        onClick={dismiss}
        className="absolute top-3.5 right-3.5 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
        aria-label="Dismiss what's new"
      >
        <X size={15} />
      </button>

      <div className="flex items-center gap-2 mb-4 pr-6">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}
        >
          <Sparkles size={14} className="text-white" />
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          What&apos;s new
        </h3>
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          · the latest updates
        </span>
      </div>

      <ul className="flex flex-col gap-3.5">
        {UPDATES.map((u, i) => {
          const Row = (
            <div className="flex items-start gap-3">
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md flex-shrink-0 mt-0.5"
                style={{ color: u.tone, backgroundColor: `${u.tone}1a` }}
              >
                {u.badge}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold flex items-center gap-1" style={{ color: 'var(--text)' }}>
                  {u.title}
                  {u.href && <ArrowUpRight size={12} className="opacity-50" />}
                </p>
                <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {u.desc}
                </p>
              </div>
            </div>
          )
          return (
            <li key={i}>
              {u.href
                ? <Link href={u.href} className="block group hover:opacity-90 transition-opacity">{Row}</Link>
                : Row}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
