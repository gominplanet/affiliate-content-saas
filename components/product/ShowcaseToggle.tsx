// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Send this post's clicks to my TikTok Shop showcase instead."
//
// It starts in whatever state the account is actually in: OFF for an Amazon
// account, ON for a creator whose account default is their shop (migration
// 333). A control that always started off would be telling a TikTok-first
// creator something untrue on every post they ever wrote.
//
// The three things this control has to get right:
//
//   1. A toggle that is ON with nothing to point at must BLOCK the post. Left
//      to publish, it would fall back to Amazon links under a switch that reads
//      as on, and the only place that shows up is their own analytics weeks
//      later. `blocked` is what the composers disable their buttons on.
//
//   2. It has to say what else changes. Turning this on also removes every
//      Amazon price claim from the copy, because a discount quoted over a link
//      to a different shop is a claim about a store the reader is never sent
//      to. A creator who is not told that will think the writer broke.
//
//   3. Unticking it on a shop account is a real choice, not a return to
//      neutral: that one post goes to Amazon while the rest of the account does
//      not. It says so rather than looking like the box was simply off.

'use client'

import { useEffect, useState } from 'react'
import { Store, Check, AlertCircle } from 'lucide-react'

export interface ShowcaseState {
  on: boolean
  /** The URL to send, or '' when the saved default should be used. */
  override: string
  /** The saved default from Settings, or null when none is saved. */
  saved: string | null
  /** What will actually be used: the override, else the saved default. */
  effective: string
  /** The toggle is on and there is nothing to point at. Block the post. */
  blocked: boolean
  /** This account sends links to the shop by default, so the box started on
   *  and unticking it is a deliberate one-off Amazon post. */
  isDefault: boolean
}

/** Loads the creator's saved showcase link and holds the per-post override. */
export function useShowcase(): ShowcaseState & {
  setOn: (v: boolean) => void
  setOverride: (v: string) => void
} {
  const [on, setOn] = useState(false)
  const [override, setOverride] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  // Whether this account sends links to the shop by default (migration 333).
  // The box starts TICKED for those creators, because it is showing them what
  // will actually happen. A control that always started off would be lying to
  // a TikTok-first account on every single post.
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    fetch('/api/affiliate-links/save')
      .then(r => r.json())
      .then((d) => {
        if (typeof d?.tiktokShowcaseUrl === 'string') setSaved(d.tiktokShowcaseUrl || null)
        if (d?.linkDestination === 'showcase') { setIsDefault(true); setOn(true) }
      })
      // Having no default saved is a normal state, not an error worth a toast.
      .catch(() => { /* leave null */ })
  }, [])

  const effective = override.trim() || saved || ''
  return { on, override, saved, effective, isDefault, blocked: on && !effective, setOn, setOverride }
}

export default function ShowcaseToggle({ state, setOn, setOverride, compact = false }: {
  state: ShowcaseState
  setOn: (v: boolean) => void
  setOverride: (v: string) => void
  /** Tighter styling for the narrow composer columns. */
  compact?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOn(!state.on)}
        className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-start gap-2.5 transition ${state.on ? 'border-[#7C3AED] bg-[#7C3AED]/10' : 'bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/5'}`}
        style={{ borderColor: state.on ? '#7C3AED' : undefined }}>
        <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded border shrink-0 ${state.on ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : ''}`}>
          {state.on && <Check size={12} />}
        </span>
        <span className="min-w-0">
          <span className="text-[13px] font-medium flex items-center gap-1.5"><Store size={13} /> Send clicks to my TikTok Shop showcase</span>
          {!compact && (
            <span className="block text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-soft)' }}>
              {state.isDefault && state.on
                ? 'This is your account default. Untick it to make this one post link to Amazon instead.'
                : 'No Amazon affiliate link on this one. The copy also drops Amazon prices and discounts, because they describe a shop the reader is not being sent to.'}
            </span>
          )}
          {!compact && state.isDefault && !state.on && (
            <span className="block text-[11px] leading-snug mt-0.5 text-amber-700 dark:text-amber-500">
              Your account sends links to your shop. This one post will link to Amazon instead.
            </span>
          )}
        </span>
      </button>

      {state.on && (
        <div className="flex flex-col gap-1.5">
          <input
            type="url" value={state.override} onChange={(e) => setOverride(e.target.value)}
            placeholder={state.saved || 'https://www.tiktok.com/@you/showcase'}
            className="w-full text-[13px] rounded-xl border px-3 py-2 bg-transparent"
            style={{ borderColor: 'var(--border, #d2d2d7)' }}
          />
          {state.saved && !state.override.trim() && (
            <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>
              Using your saved showcase link. Paste another here to use it on this post only.
            </span>
          )}
          {state.blocked && (
            <span className="text-[11px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              No showcase link yet. Paste one here, or save a default under Brand Profile &rarr; Where your links send people. Posting without it would put Amazon links on this post.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
