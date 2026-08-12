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
const RELEASE_ID = '2026-08-12'
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
    title: 'Pulse — hashtags that actually work',
    desc: 'Pulse learns which hashtags earn the most reach, from your own posts and pooled across every MVP creator in your niche, then leads with those proven tags in every caption it writes. It sharpens the more you post. Find it under Grow.',
    href: '/pulse',
  },
  {
    badge: 'IMPROVED',
    tone: '#0a84ff',
    title: 'Sharper hashtags on every post',
    desc: 'Captions now build a deliberate tag mix: your brand, tags specific to the exact product, and broad reach tags matched to the real product category (grounded in Amazon’s own category tree), with spammy tags filtered out. So an RC car reaches RC fans, not random car enthusiasts.',
  },
  {
    badge: 'NEW',
    tone: '#34c759',
    title: 'Edit your Reel caption before you post',
    desc: 'The Reel caption is now an editable box. Tweak the wording or add your own hashtags before you post, copy or download. Whatever you leave in is exactly what goes out.',
  },
  {
    badge: 'FIXED',
    tone: '#ff3b30',
    title: 'Know when a post’s images didn’t make it',
    desc: 'If in-article images don’t come through, the post now clearly flags it with a one-click “Retry images”, instead of quietly publishing without them. No more finding out on the live site.',
    href: '/content',
  },
  {
    badge: 'IMPROVED',
    tone: '#FF6B00',
    title: 'Shorts recover on their own',
    desc: 'When YouTube blocks a clip download, Shorts now fall back to the reliable download path automatically and cache the video, so the rest of your clips from that video render instantly. Fewer dead-ends, less re-uploading.',
    href: '/clip-factory',
  },
  {
    badge: 'NEW',
    tone: '#5856d6',
    title: 'A guided start on your dashboard',
    desc: 'New accounts get a simple checklist that points at the single next step to your first published post, so you always know what to do instead of facing every menu at once. It ticks itself off and disappears once you’re rolling.',
    href: '/dashboard',
  },
  {
    badge: 'FIXED',
    tone: '#bc1888',
    title: 'Posted items leave your to-do list',
    desc: 'Once a post publishes, its video reliably moves out of “needs posting” and won’t bounce back a minute later. And Refresh Price and other one-tap actions no longer hang when your site is slow.',
    href: '/content',
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
