// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Social Influencer workspace: the creator's saved research finds on top, the
// Pinterest composer below. Save a product in any research tool (AMZ Finder,
// Deal Radar, CC Campaigns) and it lands here — one click loads it into the
// composer to become a pin / IG / Facebook post. Reads the same shelf as Saved
// Campaigns (/api/campaigns/saved), so there's one saved list, not two.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bookmark, Loader2, Wand2, X, Search } from 'lucide-react'
import PinterestComposer from './PinterestComposer'

interface SavedItem {
  id: string
  asin: string
  title: string | null
  brand: string | null
  image_url: string | null
}

export default function SocialComposer() {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<{ value: string; nonce: number } | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/campaigns/saved').then(r => r.json())
      setItems(Array.isArray(d.saved) ? d.saved : [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const use = useCallback((it: SavedItem) => {
    setPreset({ value: it.asin, nonce: Date.now() })
    // Bring the composer's product field into view.
    document.getElementById('social-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const remove = useCallback(async (it: SavedItem) => {
    setItems(prev => prev.filter(x => x.id !== it.id))
    try { await fetch(`/api/campaigns/saved?asin=${encodeURIComponent(it.asin)}`, { method: 'DELETE' }) } catch { /* revert on failure not worth it */ }
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {/* Saved finds shelf */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bookmark size={15} className="text-[#d97706]" />
            <h2 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Saved products</h2>
            {items.length > 0 && <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>({items.length})</span>}
          </div>
          <Link href="/amazon/research" className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>
            <Search size={11} /> Find more
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: 'var(--text-soft)' }}>
            <Loader2 size={14} className="animate-spin" /> Loading your saved finds…
          </div>
        ) : items.length === 0 ? (
          <p className="text-[13px] leading-relaxed py-2" style={{ color: 'var(--text-soft)' }}>
            No saved products yet. In <Link href="/amazon/research" className="font-semibold hover:underline" style={{ color: '#d97706' }}>Research</Link> (AMZ Finder, Deal Radar, CC Campaigns), tap <span className="font-semibold">Save</span> on a product and it shows up here, ready to turn into a Pin or post.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map(it => (
              <div key={it.id} className="group relative flex flex-col rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden bg-white dark:bg-white/[0.02]">
                <button onClick={() => remove(it)} title="Remove"
                  className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <X size={13} />
                </button>
                <div className="aspect-square bg-gray-50 dark:bg-white/5 flex items-center justify-center overflow-hidden">
                  {it.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={it.image_url} alt={it.title || it.asin} className="w-full h-full object-contain" />
                    : <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>No image</span>}
                </div>
                <div className="p-2.5 flex flex-col gap-2 flex-1">
                  <p className="text-[12px] leading-tight line-clamp-2 flex-1" style={{ color: 'var(--text)' }}>{it.title || it.asin}</p>
                  <button onClick={() => use(it)}
                    className="inline-flex items-center justify-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg text-white transition hover:opacity-90" style={{ backgroundColor: '#d97706' }}>
                    <Wand2 size={13} /> Make post
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div id="social-composer">
        <PinterestComposer presetProduct={preset} />
      </div>
    </div>
  )
}
