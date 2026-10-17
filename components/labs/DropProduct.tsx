'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: the product an ASIN is, with its photo and name, beside the video it
// is for, so the creator sees "yes, this is the one" before anything goes out
// (app/api/drop/product). A product Amazon would not show says so: an empty
// box would look like a match.

import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, PackageSearch } from 'lucide-react'

interface Product { title: string | null; imageUrl: string | null; price: string | null; rating: string | null; url: string }

export default function DropProduct({ asin }: { asin: string }) {
  const [state, setState] = useState<{ asin: string; p: Product | null; error: string | null; loading: boolean }>({ asin: '', p: null, error: null, loading: false })
  const key = asin.trim()

  useEffect(() => {
    if (!key) return
    let gone = false
    // A moment after typing stops, so each key press is not a read of Amazon.
    const t = setTimeout(() => {
      setState({ asin: key, p: null, error: null, loading: true })
      fetch(`/api/drop/product?asin=${encodeURIComponent(key)}`).then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (gone) return
        if (r.ok && j.ok) setState({ asin: key, p: j as Product, error: null, loading: false })
        else setState({ asin: key, p: null, error: String(j.error || 'Amazon did not show this product just now.'), loading: false })
      }).catch(() => { if (!gone) setState({ asin: key, p: null, error: 'Could not reach Amazon just now.', loading: false }) })
    }, 600)
    return () => { gone = true; clearTimeout(t) }
  }, [key])

  if (!key) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>
        <PackageSearch size={16} /> Add the product (ASIN or Amazon link) and its photo shows here, so you can check it is the right one.
      </div>
    )
  }
  if (state.loading || state.asin !== key) {
    return (
      <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
        <Loader2 size={14} className="animate-spin" /> Looking up {key} on Amazon
      </div>
    )
  }
  if (!state.p) {
    return (
      <p className="rounded-xl px-3 py-2.5 text-[12px] text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">
        Could not check {key}: {state.error} It still goes with this product; check it on Amazon if you are not sure.
      </p>
    )
  }
  const p = state.p
  return (
    <div className="flex items-start gap-3 rounded-xl border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
      <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-white flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.imageUrl ? <img src={p.imageUrl} alt="" className="max-w-full max-h-full object-contain" /> : <PackageSearch size={18} style={{ color: 'var(--text-3)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Is this the product in your video?</p>
        <p className="text-[12.5px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{p.title || key}</p>
        <p className="text-[11.5px] mt-0.5 flex flex-wrap gap-x-2" style={{ color: 'var(--text-2)' }}>
          <span className="font-mono">{key}</span>
          {p.price && <span>{p.price}</span>}
          {p.rating && <span>{p.rating}</span>}
          <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">On Amazon <ExternalLink size={10} /></a>
        </p>
      </div>
    </div>
  )
}
