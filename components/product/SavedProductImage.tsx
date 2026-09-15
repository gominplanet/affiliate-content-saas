// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "You already made art for this product" — the one panel every composer shows
// when an approved image exists for the ASIN being posted.
//
// The rule this component exists to enforce: reuse is never silent. The panel
// shows the actual image, says where and when it was approved, and always
// leaves a one-click way to make a new one. A composer that quietly swapped in
// an old image would look identical to one that generated a fresh one, which
// is the exact failure mode this codebase keeps getting bitten by.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw, AlertTriangle } from 'lucide-react'
import { reuseLabel, isAsin, type ProductImageRecord } from '@/lib/product-image-label'

/** Fetch the approved image for an ASIN. Null while loading or when none. */
export function useSavedProductImage(asin: string | null | undefined): {
  saved: ProductImageRecord | null
  loading: boolean
  clear: () => void
  reload: () => void
} {
  const [saved, setSaved] = useState<ProductImageRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = (asin || '').trim().toUpperCase()

  useEffect(() => {
    if (!isAsin(key)) { setSaved(null); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/product-image?asin=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((d) => { if (!cancelled) setSaved((d?.image as ProductImageRecord | null) ?? null) })
      // A recall that fails is not an error the creator needs to see — the
      // composer simply behaves as it always did, with no saved image.
      .catch(() => { if (!cancelled) setSaved(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [key, nonce])

  const clear = useCallback(() => setSaved(null), [])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { saved, loading, clear, reload }
}

/**
 * Save an image against a product. Best-effort and deliberately quiet: this
 * runs after a post has already succeeded, and a creator who just published
 * does not need a toast about a memory write.
 */
export async function saveProductImage(opts: {
  asin: string; imageUrl: string; surface: string; modelUsed?: string | null
  source?: 'generated' | 'upload'
}): Promise<boolean> {
  if (!isAsin(opts.asin) || !opts.imageUrl) return false
  try {
    const res = await fetch('/api/product-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asin: opts.asin.trim().toUpperCase(),
        imageUrl: opts.imageUrl,
        surface: opts.surface,
        source: opts.source || 'generated',
        modelUsed: opts.modelUsed || undefined,
      }),
    })
    const d = await res.json().catch(() => ({}))
    return res.ok && d?.ok === true
  } catch {
    return false
  }
}

export default function SavedProductImage({
  saved, inUse, onUse, onReplace, replaceLabel = 'Make a new one', keepLabel,
}: {
  saved: ProductImageRecord
  /** Is the saved image the one this composer will post? */
  inUse: boolean
  /** Switch back to the saved image. */
  onUse: () => void
  /** Stop using it: generate fresh, or fall back to the product photo. */
  onReplace: () => void
  replaceLabel?: string
  /** What the composer would use instead, named plainly. */
  keepLabel?: string
}) {
  const label = reuseLabel(saved)
  return (
    <div className={`rounded-lg border p-3 ${inUse ? 'border-[#7C3AED]/40 bg-[#7C3AED]/5' : 'bg-background'}`}>
      <div className="flex gap-3">
        <img
          loading="lazy" decoding="async" src={saved.imageUrl} alt=""
          className="h-14 w-24 shrink-0 rounded border bg-white object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <History size={13} className="shrink-0 text-[#7C3AED]" />
            <span className="truncate">{inUse ? label.text : 'You have a saved image for this product'}</span>
          </div>
          {label.note && (
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-500">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{label.note}</span>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {inUse ? (
              <button type="button" onClick={onReplace}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent">
                <RefreshCw size={11} /> {replaceLabel}
              </button>
            ) : (
              <button type="button" onClick={onUse}
                className="rounded-md border border-[#7C3AED]/40 px-2 py-1 text-[11px] font-medium text-[#7C3AED] hover:bg-[#7C3AED]/10">
                Use it
              </button>
            )}
            {inUse && keepLabel && (
              <span className="text-[11px] text-muted-foreground">Otherwise {keepLabel}.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
