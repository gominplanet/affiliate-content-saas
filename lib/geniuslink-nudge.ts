// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-time client nudge: after a creator publishes to social WITHOUT Geniuslink,
// remind them (once, ever) that connecting it unlocks per-channel click
// attribution — and hand them the sign-up link. Fully best-effort and gated on
// localStorage so it never nags and never blocks a publish.

import { toast } from 'sonner'
import { GENIUSLINK_SIGNUP_URL } from '@/lib/geniuslink-signup'

const SEEN_KEY = 'mvp_gl_nudge_v1'

/**
 * Show the nudge at most once, and only when the user isn't on Geniuslink.
 * Checks a cheap status endpoint; if connected, records that so it never even
 * checks again. Safe to call from any social-publish success path.
 */
export async function nudgeGeniuslinkAfterPublish(): Promise<void> {
  try {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(SEEN_KEY)) return
    const res = await fetch('/api/integrations/geniuslink-status')
    const d = (await res.json().catch(() => ({}))) as { connected?: boolean }
    if (d?.connected) { localStorage.setItem(SEEN_KEY, 'connected'); return }
    // Not connected → show it once and remember.
    localStorage.setItem(SEEN_KEY, '1')
    toast('See which channel drives your clicks', {
      description: 'Connect Geniuslink and MVP automatically tracks whether Facebook, Pinterest, X or your blog drove each click — per channel, no setup.',
      action: { label: 'Get Geniuslink', onClick: () => window.open(GENIUSLINK_SIGNUP_URL, '_blank', 'noopener,noreferrer') },
      duration: 12000,
    })
  } catch { /* never block publishing */ }
}
