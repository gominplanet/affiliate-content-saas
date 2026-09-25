// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Co-Pilot: "This video compares products". LABS (admin while testing).
//
// Set before Generate metadata: the creator switches it on and gives each
// product an ASIN or a link. The slots are filled in from what MVP can
// already see (the product set on the card, product links in the video's
// description) so most of the time it is a check, not typing.
//
// AFTER GENERATING IT SAYS WHAT HAPPENED, product by product: its real
// title, and the link that went into the description, with a note when a
// link fell back to another style or the product list could not be saved.
'use client'

import { Plus, X, CheckCircle, AlertCircle } from 'lucide-react'
import { COMPARISON_MAX, COMPARISON_MIN, readComparisonSlots, type ComparisonSlotInput } from '@/lib/comparison-products'

export interface ComparisonResultItem {
  asin: string
  label: string
  title: string
  imageUrl: string | null
  link: string
  linkNote: string | null
}

export default function ComparisonProducts({ on, onToggle, slots, onChange, result, saved, disabled }: {
  on: boolean
  onToggle: (on: boolean) => void
  slots: ComparisonSlotInput[]
  onChange: (slots: ComparisonSlotInput[]) => void
  /** What the last generation got, or null before one. */
  result: ComparisonResultItem[] | null
  /** Whether the product list was saved on the video (migration 375). */
  saved: 'saved' | 'missing_column' | 'no_row' | 'failed' | null
  disabled?: boolean
}) {
  const check = on ? readComparisonSlots(slots) : null
  const set = (i: number, patch: Partial<ComparisonSlotInput>) => onChange(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  return (
    <div className="mb-2 rounded-lg border border-[#7C3AED]/20 bg-[#7C3AED]/[0.04] px-2.5 py-2 text-[11px]">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="accent-[#7C3AED]" />
        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">This video compares products</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white font-semibold uppercase tracking-wide">Labs</span>
      </label>
      {on && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
            {COMPARISON_MIN} to {COMPARISON_MAX} products, in the order you show them. Paste each one&apos;s ASIN or link. The titles,
            the description (one link per product), the tags and the thumbnail then cover all of them.
          </p>
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-4 text-right text-[#86868b] tabular-nums">{i + 1}.</span>
              <input
                value={s.input}
                onChange={(e) => set(i, { input: e.target.value.slice(0, 500) })}
                placeholder="ASIN or product link"
                disabled={disabled}
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] text-[11px] outline-none focus:border-[#7C3AED]"
              />
              <input
                value={s.label ?? ''}
                onChange={(e) => set(i, { label: e.target.value.slice(0, 40) })}
                placeholder="Role (optional)"
                disabled={disabled}
                className="w-28 min-w-0 px-2 py-1 rounded-md border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] text-[11px] outline-none focus:border-[#7C3AED]"
              />
              {slots.length > COMPARISON_MIN && (
                <button type="button" onClick={() => onChange(slots.filter((_, k) => k !== i))} disabled={disabled}
                  aria-label={`Remove product ${i + 1}`} className="p-1 rounded text-[#86868b] hover:text-[#ff3b30]">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {slots.length < COMPARISON_MAX && (
            <button type="button" onClick={() => onChange([...slots, { input: '', label: '' }])} disabled={disabled}
              className="self-start inline-flex items-center gap-1 text-[11px] font-medium text-[#7C3AED] hover:underline">
              <Plus size={11} /> Add a product
            </button>
          )}
          {check?.error && slots.some((s) => s.input.trim()) && <p className="text-[10px] text-[#ff3b30]">{check.error}</p>}

          {result && (
            <div className="mt-1 rounded-md border border-[#7C3AED]/15 bg-white/60 dark:bg-black/20 px-2 py-1.5">
              <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">In the description, one link each:</p>
              <ul className="flex flex-col gap-1">
                {result.map((r, i) => (
                  <li key={r.asin} className="flex items-start gap-1.5">
                    {r.linkNote ? <AlertCircle size={11} className="text-[#ff9500] mt-0.5 shrink-0" /> : <CheckCircle size={11} className="text-[#34c759] mt-0.5 shrink-0" />}
                    <span className="min-w-0">
                      <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{i + 1}. {r.label ? `${r.label}: ` : ''}{r.title === r.asin ? `${r.asin} (Amazon did not return its title)` : r.title.slice(0, 90)}</span>
                      <span className="block text-[10px] text-[#86868b] truncate">{r.link}</span>
                      {r.linkNote && <span className="block text-[10px] text-[#ff9500]">{r.linkNote}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {saved && saved !== 'saved' && (
                <p className="mt-1 text-[10px] text-[#ff9500]">
                  {saved === 'missing_column'
                    ? 'The product list could not be saved on the video (migration 375 has not been run), so Encore will only watch the first product.'
                    : saved === 'no_row'
                      ? 'This video is not in your synced videos yet, so the product list was not saved on it. The description still has every link.'
                      : 'The product list could not be saved on the video. The description still has every link.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
