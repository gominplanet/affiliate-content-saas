'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Request indexing for one post, from anywhere on the SEO page. Google has no
// API to request indexing for a blog post, so MVP fetches Google's own link to
// the post in URL inspection (the API's inspectionResultLink) and the page
// shows it as a link to click (components/seo/RequestIndexingButton). Opening
// it is remembered for a week so lists move on; the board and step 2 share it.


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

export interface InspectionLink {
  /** Google's own link to this post in URL inspection, or null. */
  link: string | null
  /** Google already has the post. */
  indexed: boolean
  /** Why there is no link, in words. */
  error?: string
}

/** Ask MVP for Google's inspection link for one post. Never opens anything:
 *  the page shows the link and the creator clicks it (an empty tab opened in
 *  advance and steered later stayed blank in some browsers, 2026-10-11). */
export async function fetchInspectionLink(url: string): Promise<InspectionLink> {
  try {
    const r = await fetch(`/api/seo/inspect-link?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25_000) })
    const d = await r.json().catch(() => ({})) as { link?: string | null; indexed?: boolean; error?: string }
    if (!r.ok || !d.link) return { link: null, indexed: !!d.indexed, error: d.error || `Search Console did not give a link (${r.status}).` }
    return { link: d.link, indexed: !!d.indexed }
  } catch {
    return { link: null, indexed: false, error: 'Search Console took too long to answer.' }
  }
}

/** Search Console's home for the property: the "Inspect any URL" bar is at the top. */
export function searchConsoleHome(property: string | null): string {
  const root = 'https://search.google.com/search-console'
  return property ? `${root}?resource_id=${encodeURIComponent(property)}` : root
}
