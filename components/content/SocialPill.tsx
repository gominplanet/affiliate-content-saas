// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// SocialPill — a single Library-row pill for a social channel (Facebook,
// LinkedIn, etc.). Three visual states + a failure overlay:
//
//   - posted=true            : filled brand-coloured pill, success check
//   - locked=true            : dashed outline, "Upgrade" tag, links to /pricing
//   - posted=false (default) : outlined button (clickable)
//   - scheduleFailed=true    : adds a red border + ⚠ icon overlay
//
// Pure presentational component — no parent state required. Extracted
// from the 4500-line content/page.tsx so the file gets a little less
// terrifying to edit. 2026-06-07 first split.
'use client'

import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export interface SocialPillProps {
  brand: string
  icon: React.ReactNode
  label: string
  postedLabel: string
  posted: boolean
  loading: boolean
  onClick?: () => void
  /** Platform is connected but not allowed on the user's tier — show a
   *  locked pill that links to pricing instead of posting. */
  locked?: boolean
  /** Most-recent scheduled push for this channel FAILED. Drives a small
   *  ⚠ overlay on the pill so the user can spot broken cascades at a
   *  glance. 2026-06-07 P1.2 fix. */
  scheduleFailed?: boolean
}

export function SocialPill({
  brand,
  icon,
  label,
  postedLabel,
  posted,
  loading,
  onClick,
  locked,
  scheduleFailed,
}: SocialPillProps) {
  if (locked) {
    return (
      <a
        href="/pricing"
        title={`${label} publishing is on a higher plan — upgrade to unlock`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-gray-300 dark:border-white/15 text-[#86868b] hover:border-[#7C3AED]/40 hover:text-[#7C3AED] transition-colors"
      >
        <span style={{ display: 'inline-flex', opacity: 0.55 }}>{icon}</span>
        <span>{label}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-gray-100 dark:bg-white/10">Upgrade</span>
      </a>
    )
  }
  if (posted) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shadow-sm"
        style={{ background: brand }}
      >
        <CheckCircle size={11} /> {postedLabel}
      </span>
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={scheduleFailed ? `${label}: last scheduled push failed — click to retry manually` : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/[0.04] disabled:opacity-60 transition-all ${
        scheduleFailed
          ? 'border-[#ff3b30]/40 bg-[#ff3b30]/5 dark:bg-[#ff3b30]/10 hover:border-[#ff3b30]/60'
          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] hover:border-gray-300 dark:hover:border-white/20'
      }`}
    >
      {loading
        ? <Loader2 size={11} className="animate-spin" style={{ color: brand }} />
        : <span style={{ color: brand, display: 'inline-flex' }}>{icon}</span>
      }
      <span>{label}</span>
      {scheduleFailed && (
        <AlertCircle size={11} className="text-[#ff3b30]" aria-label="Last scheduled push failed" />
      )}
    </button>
  )
}
