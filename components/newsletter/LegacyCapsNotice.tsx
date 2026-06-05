/**
 * Banner shown to Creator-tier users who were grandfathered on the OLD
 * newsletter caps (1000 subs / 4 sends per month) after the 2026-06-04
 * pricing restructure dropped them to 500 / 1.
 *
 * Mounted on /newsletter (where they feel it) and /billing (where they
 * shop). Self-hides for users who aren't on the legacy flag — no extra
 * fetch elsewhere. Dismiss persists in localStorage so the banner stays
 * out of the way once read, but reads at every mount so a fresh dismiss
 * elsewhere shows up immediately.
 */

'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

const DISMISS_KEY = 'mvp-legacy-creator-newsletter-dismiss'

export function LegacyCapsNotice() {
  const [show, setShow] = useState(false)
  const [tier, setTier] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('integrations')
        .select('tier, legacy_creator_newsletter')
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return
      const row = data as { tier?: string; legacy_creator_newsletter?: boolean } | null
      if (!row || !row.legacy_creator_newsletter) return
      setTier(row.tier ?? 'creator')
      try {
        if (localStorage.getItem(DISMISS_KEY) === '1') return
      } catch { /* ignore — banner just shows */ }
      setShow(true)
    })()
    return () => { cancelled = true }
  }, [])

  if (!show) return null

  return (
    <div className="rounded-xl border border-[#7C3AED]/30 bg-gradient-to-r from-[#7C3AED]/10 to-[#7C3AED]/5 p-4 mb-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
        <Sparkles size={16} className="text-[#7C3AED]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          You&apos;re on the legacy Creator newsletter plan
        </p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          We lowered the Creator newsletter caps on 2026-06-04 (now 500 subscribers + 1 send/month for new sign-ups). You&apos;re grandfathered: you keep <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">1,000 subscribers</strong> and <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">4 sends per month</strong> for as long as you stay on Creator. If you cancel and re-subscribe, you&apos;ll move to the new caps.
        </p>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1.5">
          Need more headroom? <a href="/billing?plan=studio" className="text-[#7C3AED] hover:underline font-medium">Studio unlocks 5,000 subs + 4 sends/mo</a> with everything else Creator has.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
          setShow(false)
        }}
        className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors flex-shrink-0"
        aria-label="Dismiss notice"
      >
        <X size={14} />
      </button>
      {/* Hidden tier value kept around so the linter doesn't warn about
          the destructured `tier` — useful later if we want to show the
          tier name in the copy. */}
      {tier && <span className="sr-only">Tier: {tier}</span>}
    </div>
  )
}
