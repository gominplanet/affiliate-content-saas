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
import { toast } from 'sonner'

// Bump this whenever UPDATES changes — re-shows the card AND fires the one-time
// "what's new" toast to everyone (both gated per-release in localStorage).
const RELEASE_ID = '2026-06-20'
const STORAGE_KEY = 'mvp_whats_new_seen'
const TOAST_KEY = 'mvp_whats_new_toasted'

interface Update {
  badge: string
  tone: string // accent color for the badge chip
  title: string
  desc: string
  href?: string
}

const UPDATES: Update[] = [
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Pick what to do, fast',
    desc: 'The dashboard now has big, colour-coded shortcuts for every workflow — YouTube metadata, a blog from a video or a link, comparisons, guides, socials, deals and the newsletter.',
    href: '/dashboard',
  },
  {
    badge: 'IMPROVED',
    tone: '#34c759',
    title: 'Any video works in Co-Pilot',
    desc: 'You no longer need the Amazon ASIN in your title. We identify the product from your title and what you actually say in the video, and still add your affiliate link.',
    href: '/co-pilot',
  },
  {
    badge: 'IMPROVED',
    tone: '#FF9500',
    title: 'Mobile-friendly blog posts',
    desc: 'Your published reviews now read cleanly on phones — the text, the video and the “best price” card all fit the screen. (Update your site theme from the prompt above to get it.)',
  },
  {
    badge: 'NEW',
    tone: '#0a84ff',
    title: 'Never miss a site update',
    desc: 'When new theme or plugin software is ready, you’ll get a clear prompt to one-click install it — no wp-admin trip.',
    href: '/dashboard',
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

  // One-time-per-release attention toast — so users actually notice new features
  // instead of relying on them spotting the card. Separate key from the card's
  // dismissal so the popup fires once per release regardless. "See all" scrolls
  // to the card (a no-op if it's been dismissed).
  useEffect(() => {
    let toasted: string | null = null
    try { toasted = localStorage.getItem(TOAST_KEY) } catch { /* private mode */ }
    if (toasted === RELEASE_ID) return
    try { localStorage.setItem(TOAST_KEY, RELEASE_ID) } catch { /* ignore */ }
    const top = UPDATES[0]
    const more = Math.max(0, UPDATES.length - 1)
    toast('✨ What’s new in MVP', {
      description: top
        ? `${top.title}${more ? ` — and ${more} more update${more === 1 ? '' : 's'}` : ''}.`
        : `${UPDATES.length} new update${UPDATES.length === 1 ? '' : 's'}.`,
      duration: 11000,
      action: {
        label: 'See all',
        onClick: () => { document.getElementById('mvp-whats-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) },
      },
    })
  }, [])

  if (dismissed) return null

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE_ID) } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div
      id="mvp-whats-new"
      className="rounded-2xl border p-5 relative mb-6 scroll-mt-24"
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
