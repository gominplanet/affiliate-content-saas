'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ArrowUpCircle, CheckCircle, Loader2 } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

/**
 * SCOUT extension status pill for the dashboard hero — sits beside the
 * "Theme & Plugin" pill. SCOUT now lives on the Chrome Web Store, so Chrome
 * keeps it updated automatically — we never nag users to "update" a store
 * install (there's nothing for them to click; clicking just reopens the store).
 * We only surface the two things Chrome CAN'T do for the user:
 *   - checking     → a brief "Checking SCOUT…" badge (the ping resolves fast)
 *   - not installed → orange "Get SCOUT extension" → opens a visible info card
 *                     (what it is + one-click store install). Not hover-only, so
 *                     first-timers (and mobile/touch) actually see why.
 *   - sideloaded   → orange "Move SCOUT to the Web Store" — the old manually
 *                     loaded build never auto-updates; reinstalling from the
 *                     store hands updates back to Chrome for good.
 *   - store install → a calm "Scout Extension up to date" badge (Chrome handles
 *                     any version bumps in the background).
 *
 * Bright SCOUT-orange throughout so it reads as a distinct pill next to the
 * green "Theme & Plugin" pill and the purple "Tutorials" pill.
 *
 * Note: the ping needs the extension to declare mvpaffiliate.io in
 * externally_connectable. Without a reachable copy the pill reads "not installed".
 */
export default function ScoutUpdatePill() {
  const [status, setStatus] = useState<{ kind: 'store' | 'sideload' | 'none'; version: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // The explainer card is rendered in a PORTAL (document.body) so it isn't
  // clipped by the dashboard hero's `overflow-hidden`. `pos` anchors the
  // fixed-position card just below the button.
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Position the portaled card under the button; re-anchor on scroll/resize.
  useEffect(() => {
    if (!open) { setPos(null); return }
    const compute = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const W = 330
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 12))
      setPos({ top: r.bottom + 8, left })
    }
    compute()
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => { window.removeEventListener('scroll', compute, true); window.removeEventListener('resize', compute) }
  }, [open])

  useEffect(() => {
    let cancelled = false
    getScoutInstallKind()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ kind: 'none', version: null }) })
    return () => { cancelled = true }
  }, [])

  // Close the "what is SCOUT" card on outside-click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      // The card is portaled outside wrapRef, so exclude it too — else clicking
      // inside the card (e.g. the copy chip) would close it immediately.
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Still pinging the extension.
  if (!status) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
        style={{ background: 'rgba(255,149,0,0.10)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.25)' }}
      >
        <Loader2 size={12} className="animate-spin" /> Checking SCOUT…
      </span>
    )
  }

  // Old sideloaded (load-unpacked) build → nudge to the auto-updating store
  // version so Chrome keeps SCOUT fresh from here on.
  if (status.kind === 'sideload') {
    return (
      <a
        href={SCOUT_STORE_LISTING_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="You're on the older manually-installed SCOUT. Reinstall from the Chrome Web Store so Chrome keeps it updated automatically (you can remove the old load-unpacked copy after)."
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 4px 16px rgba(255,107,0,0.38)' }}
      >
        <ArrowUpCircle size={15} /> Move SCOUT to the Web Store
      </a>
    )
  }

  // Not installed → button that opens a visible explainer + one-click store install.
  if (status.kind === 'none') {
    return (
      <div ref={wrapRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 3px 12px rgba(255,107,0,0.35)' }}
        >
          <Download size={13} /> Get SCOUT extension
        </button>

        {open && pos && typeof document !== 'undefined' && createPortal(
          <div
            ref={popRef}
            className="fixed z-[100] w-[330px] max-w-[88vw] rounded-xl border p-4 text-left shadow-xl bg-white dark:bg-[#16161a]"
            style={{ top: pos.top, left: pos.left, borderColor: 'var(--border, rgba(0,0,0,0.1))' }}
            role="dialog"
          >
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text, #1d1d1f)' }}>
              What is SCOUT? <span className="font-normal" style={{ color: 'var(--text-faint, #86868b)' }}>Free Chrome extension</span>
            </p>
            <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: 'var(--text-soft, #6e6e73)' }}>
              SCOUT runs in your browser and makes a few things noticeably better — it captures real frames from your YouTube videos for sharper thumbnails, reads Amazon product details when our server is blocked, and finds your on-Amazon videos for brand recaps. It&apos;s optional, but recommended.
            </p>
            <p className="text-[12px] leading-relaxed mt-3" style={{ color: 'var(--text-soft, #6e6e73)' }}>
              One click from the Chrome Web Store — click <b>Add to Chrome</b>, and Chrome keeps it updated automatically.
            </p>
            <a
              href={SCOUT_STORE_LISTING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 3px 12px rgba(255,107,0,0.35)' }}
            >
              <Download size={13} /> Add to Chrome
            </a>
          </div>,
          document.body,
        )}
      </div>
    )
  }

  // Store install → Chrome keeps it updated automatically, so there's nothing to
  // nag about. Show a calm "up to date" badge.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{ background: 'rgba(255,149,0,0.14)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.34)' }}
    >
      <CheckCircle size={13} /> Scout Extension up to date
    </span>
  )
}
