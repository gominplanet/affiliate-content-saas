'use client'

/**
 * WhatsNewCard — a "What's new" changelog for EXISTING users. Renders as a small
 * pill ("✨ What's new · N"); clicking it opens a centered MODAL with the full
 * changelog, so it never pushes the page around. On a new release the modal
 * auto-opens once; after that it stays as the pill until clicked.
 *
 * To publish a new batch: bump RELEASE_ID and replace UPDATES. The new RELEASE_ID
 * auto-opens the modal once more for everyone. "Seen" is stored per-release in
 * localStorage.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Sparkles, ArrowUpRight, X } from 'lucide-react'

// Bump this whenever UPDATES changes — auto-opens the modal once for everyone.
const RELEASE_ID = '2026-09-25'
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
    badge: 'NEW',
    tone: '#E4572E',
    title: 'Liftoff: launch up to ten videos at once',
    desc: 'One press sends up to ten videos to YouTube and to every Amazon storefront country you pick. Each video gets its own date and time, its own thumbnail with the right face ("Who is in this video?"), its own Amazon title, and your CTA exactly where you placed it. MVP checks the YouTube channel before anything uploads, and with SCOUT it keeps going even after you close the page. On the Pro plan, in Labs.',
    href: '/liftoff',
  },
  {
    badge: 'NEW',
    tone: '#E4572E',
    title: 'Encore: timely sale comments on your videos',
    desc: 'When a product you already reviewed goes on sale, Encore writes a comment for that video in your voice, with your link and the Amazon disclosure, posts it and pins it with SCOUT. When the sale ends it edits the comment so it no longer mentions a sale. Each promo also comes with a Short script, a Community post and a social post. On the Pro plan, under Create.',
    href: '/encore',
  },
  {
    badge: 'NEW',
    tone: '#BE185D',
    title: 'My features: pin what you use most',
    desc: 'Hover any feature in the sidebar and tap its star to pin it to My features at the top. Tap the star again to take it out. Your list follows you to every device.',
  },
  {
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'See every limit on your plan',
    desc: 'Your usage, under Account, shows each limit on your plan in plain words: what it counts, how much you have used, how much is left and when it resets. Anything used up or nearly used up is at the top.',
    href: '/usage',
  },
  {
    badge: 'IMPROVED',
    tone: '#C2410C',
    title: 'Co-Pilot finishes the job in YouTube Studio',
    desc: 'With SCOUT, Co-Pilot now sets the product tag, monetization and the paid promotion disclosure in Studio the way you would by hand, and tells you what Studio kept. Notify subscribers is a real switch, off by default. Videos that already went live leave the Needs metadata list.',
    href: '/co-pilot',
  },
  {
    badge: 'IMPROVED',
    tone: '#0a84ff',
    title: 'Set the product on any video',
    desc: 'Every video in Co-Pilot has a Set the product link, even when its title has no ASIN, and a thumbnail you already made for that product can be reused instead of made again.',
    href: '/co-pilot',
  },
  {
    badge: 'IMPROVED',
    tone: '#6d28d9',
    title: 'Every Full guide rewritten',
    desc: 'The Full guide on each page now explains what that page does today, including a new one for Liftoff. New tutorial videos are being recorded for the latest features.',
  },
  {
    badge: 'NEW',
    tone: '#34c759',
    title: 'More in the free Amazon guide',
    desc: 'The free guide now has a full Amazon Live module, what to do when Amazon sends a warning email, tracking IDs per platform, a troubleshooting section, and a search box.',
    href: '/freeguide',
  },
]

export default function WhatsNewCard() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  // On mount: enable the portal, and auto-open the modal once per release.
  useEffect(() => {
    setMounted(true)
    let seen: string | null = null
    try { seen = localStorage.getItem(STORAGE_KEY) } catch { /* private mode */ }
    if (seen !== RELEASE_ID) setOpen(true)
  }, [])

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE_ID) } catch { /* ignore */ }
  }
  function close() { setOpen(false); markSeen() }
  function openModal() { setOpen(true) }

  return (
    <>
      {/* Trigger pill — sits inline in the hero pills row (next to Tutorials).
          Filled gradient + a pulsing dot so it's noticeable. */}
      <button
        onClick={openModal}
        className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:-translate-y-px"
        style={{ background: 'linear-gradient(135deg, #FF5A1F 0%, #E11900 100%)' }}
        aria-label="Open what's new"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#FFD400' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#FFD400' }} />
        </span>
        <Sparkles size={12} />
        What&apos;s new
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/25">
          {UPDATES.length}
        </span>
      </button>

      {/* Modal — centered overlay, doesn't affect page layout. */}
      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="What's new in MVP"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

          <div
            className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border shadow-2xl bg-white dark:bg-[#141418]"
            style={{ borderColor: 'rgba(124, 58, 237, 0.30)' }}
          >
            {/* Sticky header */}
            <div
              className="sticky top-0 z-10 flex items-center gap-3 px-5 py-4 border-b bg-white/95 dark:bg-[#141418]/95 backdrop-blur"
              style={{ borderColor: 'var(--border, rgba(0,0,0,0.08))' }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #bc1888 100%)' }}
              >
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold leading-tight" style={{ color: 'var(--text)' }}>
                  What&apos;s new in MVP
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {UPDATES.length} updates from the last few days · tap any to open it
                </p>
              </div>
              <button
                onClick={close}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                style={{ color: 'var(--text-faint)' }}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {/* Grid */}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-5">
              {UPDATES.map((u, i) => {
                const inner = (
                  <div
                    className="h-full rounded-xl border p-3.5 bg-black/[0.015] dark:bg-white/[0.035] transition-all duration-200 hover:shadow-sm hover:-translate-y-px"
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
                      // The free guide is a static page behind a rewrite, which
                      // an in-app Link can fail to reach: a plain link loads it.
                      ? u.href.startsWith('/freeguide')
                        ? <a href={u.href} onClick={close} className="block h-full">{inner}</a>
                        : <Link href={u.href} onClick={close} className="block h-full">{inner}</Link>
                      : inner}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
