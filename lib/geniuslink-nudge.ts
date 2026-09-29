// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-time client nudge after a creator publishes to social: if NOTHING is
// tracking their clicks per channel, say so once, ever, and point at the link
// style setting. Fully best-effort and gated on localStorage so it never nags
// and never blocks a publish.
//
// WHO IT IS FOR. Only a creator whose links are plain tagged Amazon URLs.
// Passport Links already file every click under its channel, and Genius Links
// and Bitly links have click counts of their own, so a creator on any of those
// was being told to go and buy something they did not need. It used to fire for everyone without
// Geniuslink keys, Passport users included.

import { toast } from 'sonner'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

const SEEN_KEY = 'mvp_gl_nudge_v1'

/**
 * Show the nudge at most once, and only to a creator on plain Amazon links.
 * A creator on a tracked link style is remembered so it never checks again.
 * Safe to call from any social-publish success path.
 */
export async function nudgeGeniuslinkAfterPublish(): Promise<void> {
  try {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(SEEN_KEY)) return
    const res = await fetchWithTimeout('/api/integrations/geniuslink-status', { timeoutMs: 15_000 })
    const d = (await res.json().catch(() => ({}))) as { connected?: boolean; linkStyle?: string | null }
    if (d?.connected || (d?.linkStyle && d.linkStyle !== 'direct')) { localStorage.setItem(SEEN_KEY, 'tracked'); return }
    // No answer is not an answer: say nothing and ask again next time.
    if (d?.linkStyle !== 'direct') return
    localStorage.setItem(SEEN_KEY, '1')
    toast('See which channel drives your clicks', {
      description: 'Your links are plain Amazon links, so nothing shows whether Facebook, Pinterest, X or your blog drove a click. Passport Links track that per channel with no setup.',
      action: { label: 'Choose link style', onClick: () => { window.location.href = '/brand#affiliate' } },
      duration: 12000,
    })
  } catch { /* never block publishing */ }
}
