// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "MVP already made this" — shown on a generator before it spends anything.
// Lists what exists for the product, video or brand (lib/made-before) with a
// way to reuse each: use the picture as is, open the post, or load the script
// or email back. Making a new one stays one click away, as always.
//
// Silent when there is nothing, and silent when the lookup fails: a generator
// with no history behaves exactly as it did before this existed.

'use client'

import { useEffect, useState } from 'react'
import { History, ExternalLink } from 'lucide-react'
import type { MadeItem } from '@/lib/made-before'

/** "Sep 14", never a year (CLAUDE.md). Pure. */
function when(at: string | null): string {
  if (!at) return ''
  const d = new Date(at)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

export function useMadeBefore(q: { asin?: string | null; video?: string | null; brand?: string | null }): MadeItem[] {
  const [items, setItems] = useState<MadeItem[]>([])
  const asin = (q.asin || '').trim().toUpperCase()
  const video = (q.video || '').trim()
  const brand = (q.brand || '').trim()
  useEffect(() => {
    const p = new URLSearchParams()
    if (/^[A-Z0-9]{10}$/.test(asin)) p.set('asin', asin)
    if (video) p.set('video', video)
    if (brand.length >= 2) p.set('brand', brand)
    if (![...p.keys()].length) { setItems([]); return }
    let cancelled = false
    // Typed fields change on every key; wait for the creator to stop.
    const t = setTimeout(() => {
      fetch(`/api/made-before?${p.toString()}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setItems(Array.isArray(d?.items) ? d.items : []) })
        .catch(() => { if (!cancelled) setItems([]) })
    }, 450)
    return () => { cancelled = true; clearTimeout(t) }
  }, [asin, video, brand])
  return items
}

export default function MadeBefore({
  asin, video, brand, only, formats, onUseImage, onLoad, onBuildOn, buildOnId, heading,
}: {
  /** Start the new piece from this one: its facts carried over, written fresh. */
  onBuildOn?: (item: MadeItem) => void
  /** The item currently being built on, shown as chosen. */
  buildOnId?: string | null
  asin?: string | null
  video?: string | null
  brand?: string | null
  /** Show only these kinds (a script page shows scripts, not deal posts). */
  only?: MadeItem['kind'][]
  /** For designs, only these shapes (a pin composer shows pins). */
  formats?: string[]
  /** Use a picture MVP already made instead of rendering a new one. */
  onUseImage?: (url: string, item: MadeItem) => void
  /** Load a saved script or email back into the page. */
  onLoad?: (item: MadeItem) => void
  heading?: string
}) {
  const all = useMadeBefore({ asin, video, brand })
  const items = all
    .filter((i) => !only || only.includes(i.kind))
    .filter((i) => !formats || i.kind !== 'design' || formats.includes(i.format || ''))
  if (!items.length) return null
  return (
    <div className="rounded-lg border border-[#7C3AED]/30 bg-[#7C3AED]/5 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <History size={13} className="shrink-0 text-[#7C3AED]" />
        <span>{heading || 'MVP already made these for this. Reuse one instead of making it again.'}</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.kind}-${i}`} className="flex items-center gap-2.5">
            {it.imageUrl
              ? <img loading="lazy" decoding="async" src={it.imageUrl} alt="" className="h-9 w-16 shrink-0 rounded border bg-white object-cover" />
              : null}
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {it.label}{when(it.at) ? <span className="text-muted-foreground"> · {when(it.at)}</span> : null}
            </span>
            {it.imageUrl && onUseImage && (
              <button type="button" onClick={() => onUseImage(it.imageUrl as string, it)}
                className="shrink-0 rounded-md border border-[#7C3AED]/40 px-2 py-1 text-[11px] font-medium text-[#7C3AED] hover:bg-[#7C3AED]/10">
                Use this image
              </button>
            )}
            {!it.imageUrl && it.id && onLoad && (it.kind === 'script' || it.kind === 'collab') && (
              <button type="button" onClick={() => onLoad(it)}
                className="shrink-0 rounded-md border border-[#7C3AED]/40 px-2 py-1 text-[11px] font-medium text-[#7C3AED] hover:bg-[#7C3AED]/10">
                Load it
              </button>
            )}
            {onBuildOn && it.id && (it.kind === 'blog' || it.kind === 'deal' || it.kind === 'campaign' || it.kind === 'script') && (
              <button type="button" onClick={() => onBuildOn(it)}
                className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${buildOnId === it.id ? 'border-[#7C3AED] bg-[#7C3AED] text-white' : 'border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/10'}`}>
                {buildOnId === it.id ? 'Building on this' : 'Build on it'}
              </button>
            )}
            {it.url && (
              <a href={it.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent">
                Open <ExternalLink size={10} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
