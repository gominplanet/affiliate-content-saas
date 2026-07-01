'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ArrowUpCircle, CheckCircle, Loader2 } from 'lucide-react'
import { getScoutStatus } from '@/lib/extension-frame'
import { SCOUT_LATEST_VERSION, SCOUT_DOWNLOAD_URL, SCOUT_WHATS_NEW, isScoutOutdated } from '@/lib/scout-version'
import CopyChromeExtensions from '@/components/scout/CopyChromeExtensions'

/**
 * SCOUT extension status pill for the dashboard hero — sits beside the
 * "Theme & Plugin" pill. SCOUT is a load-unpacked extension (no Web Store
 * auto-update), so we ping the installed copy and surface its state:
 *   - checking        → a brief "Checking SCOUT…" badge (the ping resolves fast)
 *   - not installed   → orange "Get SCOUT extension" → opens a visible info card
 *                       (what it is + 2-step install + download). Not hover-only,
 *                       so first-timers (and mobile/touch) actually see why.
 *   - installed/behind → LOUD orange "Update SCOUT vX" download (unzip + reload)
 *   - installed/current → a bright orange "Scout Extension up to date" badge
 *
 * Bright SCOUT-orange throughout so it reads as a distinct pill next to the
 * green "Theme & Plugin" pill and the purple "Tutorials" pill.
 *
 * Note: the ping needs NEXT_PUBLIC_SCOUT_EXTENSION_ID set (same dependency as
 * the top-bar SCOUT button). Without it the pill reads "not installed".
 */
export default function ScoutUpdatePill() {
  const [status, setStatus] = useState<{ installed: boolean; version: string | null } | null>(null)
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
    getScoutStatus()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ installed: false, version: null }) })
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

  const outdated = status.installed && isScoutOutdated(status.version)

  // Not installed → button that opens a visible explainer + install + download.
  if (!status.installed) {
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
            className="fixed z-[100] w-[330px] max-w-[88vw] rounded-xl border p-4 text-left shadow-xl"
            style={{ top: pos.top, left: pos.left, backgroundColor: 'var(--surface, #fff)', borderColor: 'var(--border, rgba(0,0,0,0.1))' }}
            role="dialog"
          >
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text, #1d1d1f)' }}>
              What is SCOUT? <span className="font-normal" style={{ color: 'var(--text-faint, #86868b)' }}>Free Chrome extension</span>
            </p>
            <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: 'var(--text-soft, #6e6e73)' }}>
              SCOUT runs in your browser and makes a few things noticeably better — it captures real frames from your YouTube videos for sharper thumbnails, reads Amazon product details when our server is blocked, and finds your on-Amazon videos for brand recaps. It&apos;s optional, but recommended.
            </p>
            <p className="text-[12px] font-semibold mt-3" style={{ color: 'var(--text, #1d1d1f)' }}>Install in 2 steps:</p>
            <ol className="list-decimal ml-4 mt-1 flex flex-col gap-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-soft, #6e6e73)' }}>
              <li>Download &amp; unzip the file below.</li>
              <li>Open Chrome → <CopyChromeExtensions /> → turn on <b>Developer mode</b> (top-right) → <b>Load unpacked</b> → pick the unzipped folder.</li>
            </ol>
            <a
              href={SCOUT_DOWNLOAD_URL}
              download
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 3px 12px rgba(255,107,0,0.35)' }}
            >
              <Download size={13} /> Download SCOUT
            </a>
          </div>,
          document.body,
        )}
      </div>
    )
  }

  // Installed but behind → loud update.
  if (outdated) {
    return (
      <a
        href={SCOUT_DOWNLOAD_URL}
        download
        title={`A newer SCOUT (v${SCOUT_LATEST_VERSION}) is ready. ${SCOUT_WHATS_NEW} Download, unzip over your SCOUT folder, then reload it at chrome://extensions.`}
        className="group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg, #FF9F0A 0%, #FF6B00 100%)', boxShadow: '0 4px 16px rgba(255,107,0,0.38)' }}
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70"></span>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"></span>
        </span>
        <ArrowUpCircle size={15} /> Update SCOUT to v{SCOUT_LATEST_VERSION}
      </a>
    )
  }

  // Installed + current → bright SCOUT-orange "up to date" badge.
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{ background: 'rgba(255,149,0,0.14)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.34)' }}
    >
      <CheckCircle size={13} /> Scout Extension up to date
    </span>
  )
}
