'use client'

/**
 * INSTAGRAM TAG COUNTS, READ IN THE BACKGROUND (Seb, 2026-10-20: "Do we
 * actually go online to find and pick the winning hashtags? ... anywhere
 * between 10,000 and 200,000"). Every caption's possible tags are counted on
 * YouTube as it is written (lib/hashtag-research); Instagram shows its counts
 * only to a signed-in browser, so the tags it has not counted wait in
 * hashtag_wanted and SCOUT reads up to 20 of them from here, every few hours.
 *
 * NOTHING SHOWS: SCOUT 1.53.6 reads quietly, only through an Instagram tab the
 * creator already has open, and never opens one. It runs only when SCOUT was
 * already allowed on Instagram (it never asks here), and only for who may use
 * live hashtag data (/api/hashtags/trends says). What happened is kept for the
 * Live hashtag data card to say, so a read that found nothing never looks like
 * one that worked. Renders nothing.
 */

import { useEffect } from 'react'
import { getScoutStatus, requestHashtagAccess, requestInstagramTagCounts } from '@/lib/extension-frame'
import { SCOUT_IG_QUIET_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

const KEY = 'mvp.igTagRead'
/** Between reads; after Instagram asked to slow down; while no Instagram tab is open. */
const EVERY_MS = 3 * 3_600_000
const SLOW_MS = 12 * 3_600_000
const NO_TAB_MS = 20 * 60_000
const START_AFTER_MS = 20_000

export interface IgReadNote { at: string; asked: number; counted: number; error: string | null }

export function lastIgRead(): IgReadNote | null {
  try { const n = JSON.parse(localStorage.getItem(KEY) || 'null'); return n && typeof n.at === 'string' ? n as IgReadNote : null } catch { return null }
}
function keep(n: IgReadNote) { try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* read again next visit */ } }

/** How long to wait after this note before reading again. Pure. */
export function igReadWait(n: IgReadNote | null): number {
  if (!n) return 0
  return n.error === 'slow-down' ? SLOW_MS : n.error === 'no-tab' || n.error === 'not-signed-in' ? NO_TAB_MS : EVERY_MS
}

export default function InstagramTagReader() {
  useEffect(() => {
    let alive = true
    const run = async () => {
      const last = lastIgRead()
      if (last && Date.now() - new Date(last.at).getTime() < igReadWait(last)) return
      const s = await getScoutStatus().catch(() => ({ installed: false, version: null as string | null }))
      // An older SCOUT would open its own Instagram window: never from here.
      if (!alive || !s.installed || !scoutAtLeast(s.version, SCOUT_IG_QUIET_MIN_VERSION)) return
      const access = await requestHashtagAccess(false).catch(() => null)
      if (!alive || access?.state !== 'granted' || !access.instagram) return
      const info = await fetch('/api/hashtags/trends').then((r) => (r.ok ? r.json() : null)).catch(() => null) as { allowed?: boolean; instagramNext?: string[] } | null
      if (!alive || !info?.allowed) return
      const tags = (info.instagramNext || []).slice(0, 20)
      if (!tags.length) { keep({ at: new Date().toISOString(), asked: 0, counted: 0, error: null }); return }
      const res = await requestInstagramTagCounts(tags.map((t) => t.replace(/^#/, '')), { quiet: true }).catch(() => ({ ok: false, error: 'no-answer', items: [] }))
      const items = (res.items || []).filter((i) => i.posts != null)
      let error: string | null = res.ok ? null : res.error || 'no-answer'
      if (items.length) {
        const saved = await fetch('/api/hashtags/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'instagram', items }) })
          .then((r) => r.json()).catch(() => null) as { ok?: boolean } | null
        if (!saved?.ok) error = 'not-saved'
      }
      keep({ at: new Date().toISOString(), asked: tags.length, counted: error === 'not-saved' ? 0 : items.length, error })
    }
    const t = setTimeout(() => { void run() }, START_AFTER_MS)
    return () => { alive = false; clearTimeout(t) }
  }, [])
  return null
}
