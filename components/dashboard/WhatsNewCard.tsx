'use client'

/**
 * WhatsNewCard — a "What's new" changelog for EXISTING users. Distinct from
 * <NewsBanner/> (one admin-managed announcement). On a new release it opens
 * EXPANDED; closing it doesn't hide it — it COLLAPSES into a small rectangular
 * card that re-expands on click, so the updates are always one tap away.
 *
 * To publish a new batch: bump RELEASE_ID and replace UPDATES. The new RELEASE_ID
 * re-opens the panel for everyone (even people who collapsed the last batch) and
 * fires the one-time "what's new" toast. Collapsed state is stored per-release in
 * localStorage.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'

// Bump this whenever UPDATES changes — re-opens the panel AND fires the one-time
// toast to everyone (both gated per-release in localStorage).
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
  // Collapsed by default (also the pre-hydration state) so we never flash the
  // full panel. `ready` gates the first paint until we've read localStorage.
  const [collapsed, setCollapsed] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === RELEASE_ID)
    } catch {
      setCollapsed(false)
    }
    setReady(true)
  }, [])

  // One-time-per-release attention toast so users notice new features even if
  // the panel is collapsed. Separate key from the collapse state.
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
        onClick: () => {
          setCollapsed(false)
          document.getElementById('mvp-whats-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        },
      },
    })
  }, [])

  function collapse() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE_ID) } catch { /* ignore */ }
    setCollapsed(true)
  }
  function expand() {
    setCollapsed(false)
  }

  if (!ready) return null

  // ── Collapsed: a neat little rectangular card, right-aligned ─────────────
  if (collapsed) {
    return (
      <div className="flex justify-end mb-6" id="mvp-whats-new">
        <button
          onClick={expand}
          className="inline-flex items-center gap-2 rounded-xl border pl-2.5 pr-3 py-2 transition-all hover:shadow-sm hover:-translate-y-px"
          style={{
            background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.10) 0%, rgba(188, 24, 136, 0.08) 100%)',
            borderColor: 'rgba(124, 58, 237, 0.28)',
          }}
          aria-label="Open what's new"
        >
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #bc1888 100%)' }}
          >
            <Sparkles size={13} className="text-white" />
          </span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            What&apos;s new
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ color: '#fff', background: '#7C3AED' }}
          >
            {UPDATES.length}
          </span>
          <ChevronDown size={15} style={{ color: 'var(--text-faint)' }} />
        </button>
      </div>
    )
  }

  // ── Expanded: the full changelog grid ───────────────────────────────────
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
        onClick={collapse}
        className="absolute top-3.5 right-3.5 inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        style={{ color: 'var(--text-faint)' }}
        aria-label="Collapse what's new"
      >
        Collapse <ChevronUp size={13} />
      </button>

      <div className="flex items-center gap-3 mb-5 pr-24">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #bc1888 100%)' }}
        >
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--text)' }}>
            What&apos;s new in MVP
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
            {UPDATES.length} updates from the last few days · tap any to open it
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {UPDATES.map((u, i) => {
          const inner = (
            <div
              className="h-full rounded-xl border p-3.5 bg-white/70 dark:bg-white/[0.035] transition-all duration-200 hover:shadow-sm hover:-translate-y-px"
              style={{ borderColor: `${u.tone}33` }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ color: u.tone, backgroundColor: `${u.tone}1f` }}
                >
                  {u.badge}
                </span>
                {u.href && (
                  <ArrowUpRight
                    size={13}
                    style={{ color: u.tone }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                )}
              </div>
              <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
                {u.title}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                {u.desc}
              </p>
            </div>
          )
          return (
            <li key={i} className="group">
              {u.href
                ? <Link href={u.href} className="block h-full">{inner}</Link>
                : inner}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
