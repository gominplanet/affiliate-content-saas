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
const RELEASE_ID = '2026-08-09'
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
    title: 'Clip Factory — Shorts that actually work',
    desc: 'Turn a long video into vertical Shorts, pulled straight from a YouTube link or your own upload. Pick Standard or Split screen, get word-for-word captions burned in, then add a shoppable CTA and publish to Instagram, TikTok and YouTube.',
    href: '/clip-factory',
  },
  {
    badge: 'IMPROVED',
    tone: '#34c759',
    title: 'Sharper, more accurate thumbnails',
    desc: 'The generator now double-checks the rendered product matches your real one and re-does it if it drifted — far fewer “wrong product” thumbnails, on every style including Graphic Design.',
    href: '/co-pilot',
  },
  {
    badge: 'NEW',
    tone: '#FF9500',
    title: 'Thumbnail badges',
    desc: 'Add one badge to every thumbnail: a green check, five gold stars, or a red arrow pointing at your product. Or none — that’s the default. Set it once in Co-Pilot.',
    href: '/co-pilot',
  },
  {
    badge: 'IMPROVED',
    tone: '#0a84ff',
    title: 'Co-Pilot, tidied up',
    desc: 'The big “Create my MVP Thumbnail” button now sits below your options, so you choose your method, border and badge first, then generate.',
    href: '/co-pilot',
  },
  {
    badge: 'NEW',
    tone: '#bc1888',
    title: 'Rotating banner ads',
    desc: 'In Ads, switch banners on or off without deleting them, shuffle their order on every page load, and show only 2, 3 or 4 at a time in the sidebar. Labels now appear above each banner too.',
    href: '/ads',
  },
  {
    badge: 'NEW',
    tone: '#30d158',
    title: 'Wayward placement builder',
    desc: 'Answer a few tick-box questions and MVP writes your whole sponsorship pitch for you. Copy it, paste it into Wayward, done.',
    href: '/wayward',
  },
  {
    badge: 'IMPROVED',
    tone: '#5856d6',
    title: 'Support is a real conversation now',
    desc: 'Tickets are an open thread between you and us — back-and-forth in one place, screenshots included, so nothing gets lost.',
    href: '/support',
  },
  {
    badge: 'IMPROVED',
    tone: '#FF6B00',
    title: 'Cleaner, faster blog',
    desc: 'The Clear Cache button now fully clears your site (a true full purge), your read counter shows live on posts, and there’s a quick batch-redirect to send old or broken links to your homepage.',
  },
  {
    badge: 'FIXED',
    tone: '#ff3b30',
    title: 'Link-in-Bio',
    desc: 'The colour-picker error is gone, and there’s a new “I may earn a commission” disclaimer line under your tagline.',
    href: '/link-in-bio',
  },
  {
    badge: 'IMPROVED',
    tone: '#0a84ff',
    title: 'Everything social in one place',
    desc: 'External Integrations now lives under Connect Socials, so all your platform connections are together.',
    href: '/connect-socials',
  },
  {
    badge: 'IMPROVED',
    tone: '#34c759',
    title: 'Safer Instagram auto-posting',
    desc: 'MVP now paces your automatic Instagram posts to help keep your account in good standing.',
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
