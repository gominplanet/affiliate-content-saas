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
const RELEASE_ID = '2026-08-09'
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
        style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)' }}
        aria-label="Open what's new"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
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
                      ? <Link href={u.href} onClick={close} className="block h-full">{inner}</Link>
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
