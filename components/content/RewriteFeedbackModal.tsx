// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// RewriteFeedbackModal — opens when a Pro user clicks "Rewrite" on a
// published post. They paste a 1-paragraph guidance note ("the post
// focused too much on price, I wanted more on build quality, also
// missing X") which the rewrite route uses to actually produce a
// different draft (instead of a paraphrase of the original).
//
// Pure UI — the parent owns the state and the submit handler.
// Extracted from app/(dashboard)/content/page.tsx 2026-06-07.
'use client'

import { useRef } from 'react'
import { useModalA11y } from '@/components/ui/useModalA11y'

export function RewriteFeedbackModal({
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onCancel)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Rewrite this post"
        tabIndex={-1}
      >
        <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          Rewrite this post
        </h3>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Pro plans include <span className="font-semibold">one AI rewrite per post</span>.
          Tell us what was missing so the second draft is actually different.
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          autoFocus
          placeholder="e.g. The post focused too much on price — I wanted more on the build quality and a stronger opening hook. Also missing: comparison to the model I mentioned at minute 4."
          className="w-full text-sm p-3 rounded-lg bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={value.trim().length === 0}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Rewrite now
          </button>
        </div>
        <p className="text-[10px] text-[#86868b] mt-3">
          Heads up — this counts as your one rewrite for this post. After this, further changes must be made manually in WordPress.
        </p>
      </div>
    </div>
  )
}
