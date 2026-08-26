'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X, ArrowRight } from 'lucide-react'

/**
 * Missing-Amazon-tag alert. Reads /api/affiliate-links/status and, when the
 * creator has NO Amazon Associates tag set for their active site (or account),
 * shows a slim dismissible banner. Without a tag, every Amazon affiliate link MVP
 * generates earns NOTHING — whatever Link style they picked, and even Passport
 * routes shoppers to a store under this tag — so this is the difference between
 * "creating affiliate content" and "creating content that can't pay you."
 *
 * Dismiss is remembered locally so it doesn't nag within a browser, but it
 * returns on a new session until the tag is actually set. Fails open (renders
 * nothing) on any read error, so it never blocks the dashboard.
 */
export default function AmazonTagNudge() {
  const [missing, setMissing] = useState(false)
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we know

  useEffect(() => {
    let alive = true
    fetch('/api/affiliate-links/status')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; hasAmazonTag?: boolean } | null) => {
        if (!alive || !d || d.ok === false) return
        if (d.hasAmazonTag === false) {
          setMissing(true)
          try { if (localStorage.getItem('mvp_amazon_tag_nudge') === '1') return } catch { /* private mode */ }
          setDismissed(false)
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!missing || dismissed) return null

  function close() {
    try { localStorage.setItem('mvp_amazon_tag_nudge', '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  const accent = '#ff9500'
  return (
    <div
      className="flex items-center gap-2.5 border-b px-6 py-2 text-[12px]"
      style={{ borderColor: 'var(--border)', backgroundColor: `${accent}12` }}
    >
      <AlertTriangle size={14} style={{ color: accent }} className="flex-shrink-0" />
      <span style={{ color: 'var(--text)' }}>
        No <b>Amazon Associates tag</b> is set, so the Amazon links MVP generates won&rsquo;t earn you commission. Add yours to start earning.
      </span>
      <Link
        href="/brand#affiliate"
        onClick={close}
        className="ml-auto flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
        style={{ background: accent }}
      >
        Add my tag <ArrowRight size={12} />
      </Link>
      <button onClick={close} aria-label="Dismiss" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
        <X size={14} />
      </button>
    </div>
  )
}
