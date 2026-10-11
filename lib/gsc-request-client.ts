'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Opening Google's own Request indexing page for one post, from anywhere on the
// SEO page. Google has no API to request indexing for a blog post, so this
// opens Search Console's URL Inspection for it (the link the URL Inspection API
// returns), and remembers the request for a week so lists move on.
//
// Shared by the per-post board and step 2 of "Get your posts into Google", so
// both remember the same requests.

import { toast } from 'sonner'
import { gscPageIndexingUrl } from '@/lib/gsc-links'

export const REQUESTED_KEY = 'mvp.seo.requested.v1'
export const REQUESTED_EVENT = 'mvp:seo-requested'

export function readRequested(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(REQUESTED_KEY) || '{}') || {} } catch { return {} }
}

export function markRequested(url: string): Record<string, string> {
  const next = { ...readRequested(), [url]: new Date().toISOString() }
  try { localStorage.setItem(REQUESTED_KEY, JSON.stringify(next)) } catch { /* the page still opens */ }
  try { window.dispatchEvent(new Event(REQUESTED_EVENT)) } catch { /* no listeners */ }
  return next
}

/** When this post was last sent to Google from MVP, or null. */
export function requestedAt(url: string | null | undefined): string | null {
  if (!url) return null
  return readRequested()[url] ?? null
}

/** Open Search Console's inspection of `url`, where the Request indexing button
 *  is. The tab opens at once (so the browser does not block it), then goes to
 *  Google's link. Without one, the address is copied and the Pages report opens. */
export async function openRequestIndexing(url: string, property: string | null): Promise<void> {
  markRequested(url)
  const w = window.open('about:blank', '_blank')
  try {
    const r = await fetch(`/api/seo/inspect-link?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25_000) })
    const d = await r.json().catch(() => ({})) as { link?: string | null; indexed?: boolean; error?: string }
    if (d.indexed) toast.success('Google now says this post is indexed. Nothing to request.')
    if (d.link && w) { w.location.href = d.link; return }
    throw new Error(d.error || 'no link')
  } catch {
    try { await navigator.clipboard?.writeText(url) } catch { /* shown below anyway */ }
    if (w) w.location.href = gscPageIndexingUrl(property)
    toast('Google did not give MVP a direct link for this post. Its address is copied: paste it into the "Inspect any URL" bar at the top of Search Console, then press Request indexing.', { duration: 12000 })
  }
}
