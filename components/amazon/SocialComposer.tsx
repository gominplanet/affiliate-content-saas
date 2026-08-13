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
import PostComposer from './PostComposer'
import PostToAll from './PostToAll'

const TABS = [
  { key: 'pinterest', label: 'Pinterest', accent: '#E60023' },
  { key: 'instagram', label: 'Instagram', accent: '#E1306C' },
  { key: 'facebook', label: 'Facebook', accent: '#1877F2' },
] as const
type TabKey = typeof TABS[number]['key']

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
  const [tab, setTab] = useState<TabKey>('pinterest')
  const [page, setPage] = useState(0)

  // Show three rows at the widest layout (6 per row), then flip pages.
  const PAGE_SIZE = 18
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageItems = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  // Keep the page in range after removals.
  useEffect(() => { if (page >= totalPages) setPage(totalPages - 1) }, [page, totalPages])

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/campaigns/saved').then(r => r.json())
      setItems(Array.isArray(d.saved) ? d.saved : [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Prefill from ?asin= — lets AMZ Storefront's "Quick social" land here ready
  // to compose for that exact product.
  useEffect(() => {
    try {
      const asin = new URLSearchParams(window.location.search).get('asin')
      if (asin && /^[A-Z0-9]{10}$/i.test(asin)) setPreset({ value: asin.toUpperCase(), nonce: Date.now() })
    } catch { /* no query param */ }
  }, [])

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
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {pageItems.map(it => (
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
                <div className="p-2 flex flex-col gap-1.5 flex-1">
                  <p className="text-[11px] leading-tight line-clamp-2 flex-1" style={{ color: 'var(--text)' }}>{it.title || it.asin}</p>
                  <button onClick={() => use(it)}
                    className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg text-white transition hover:opacity-90" style={{ backgroundColor: '#d97706' }}>
                    <Wand2 size={12} /> Make post
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Page tabs — flip through the rest of the saved finds */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {Array.from({ length: totalPages }, (_, i) => (
              <button key={i} onClick={() => setPage(i)}
                className={`min-w-[28px] h-7 px-2 rounded-lg text-[12px] font-semibold transition ${i === page ? 'bg-[#d97706] text-white' : 'bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20'}`}
                style={i === page ? undefined : { color: 'var(--text-soft)' }}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* One-click fan-out to every connected network */}
      <div id="social-composer">
        <PostToAll presetProduct={preset} />
      </div>

      {/* Network tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition ${tab === t.key ? 'text-white' : 'border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'}`}
              style={tab === t.key ? { backgroundColor: t.accent, borderColor: t.accent } : { color: 'var(--text-soft)' }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tab === t.key ? '#fff' : t.accent }} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Keep every composer mounted so a generated design survives tab switches. */}
        <div className={tab === 'pinterest' ? '' : 'hidden'}><PinterestComposer presetProduct={preset} /></div>
        <div className={tab === 'instagram' ? '' : 'hidden'}><PostComposer network="instagram" presetProduct={preset} /></div>
        <div className={tab === 'facebook' ? '' : 'hidden'}><PostComposer network="facebook" presetProduct={preset} /></div>
      </div>
    </div>
  )
}
