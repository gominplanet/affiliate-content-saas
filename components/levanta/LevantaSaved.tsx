'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Saved for later" shelf for the Levanta MVP Finder — the products a creator
// bookmarked to act on later. Each item can be turned into a post, bought to
// review, or removed. Backed by cc_saved_finds (source='levanta') via
// /api/levanta/saved. Parent bumps `reloadKey` after the Finder saves something.

import { useEffect, useState, useCallback } from 'react'
import { Bookmark, ShoppingCart, Sparkles, X, Loader2, Star, CheckCircle2, ExternalLink } from 'lucide-react'

const CYAN = '#0E7490'

interface SavedItem {
  id: string
  asin: string
  title: string | null
  brand: string | null
  image_url: string | null
  commission_pct: number | null
  price: number | null
  rating: number | null
  marketplace: string | null
}
type GenState = { loading?: boolean; url?: string; error?: string }

export default function LevantaSaved({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<SavedItem[] | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [gen, setGen] = useState<Record<string, GenState>>({})

  const load = useCallback(() => {
    fetch('/api/levanta/saved').then(r => r.json()).then(d => {
      setItems(d?.ok && Array.isArray(d.saved) ? d.saved : [])
    }).catch(() => setItems([]))
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  async function remove(id: string) {
    setRemoving(prev => new Set(prev).add(id))
    setItems(prev => (prev ?? []).filter(i => i.id !== id)) // optimistic
    try { await fetch(`/api/levanta/saved?id=${id}`, { method: 'DELETE' }) }
    finally { setRemoving(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  async function generate(it: SavedItem) {
    setGen(g => ({ ...g, [it.asin]: { loading: true } }))
    try {
      const res = await fetch('/api/levanta/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            asin: it.asin, title: it.title, image: it.image_url, price: it.price,
            brandName: it.brand, marketplace: it.marketplace || 'amazon.com',
          },
          draft: true, // shelf generates a draft to review — safe default
        }),
      })
      const j = await res.json()
      if (!j.ok) { setGen(g => ({ ...g, [it.asin]: { error: j.error || 'Generation failed' } })); return }
      setGen(g => ({ ...g, [it.asin]: { url: j.wordpressUrl } }))
    } catch {
      setGen(g => ({ ...g, [it.asin]: { error: 'Network error during generation.' } }))
    }
  }

  // Nothing saved yet → keep the shelf out of the way entirely (no empty card
  // cluttering the page before the user has saved anything).
  if (items !== null && items.length === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          <Bookmark size={14} className="inline -mt-0.5 mr-1.5" style={{ color: '#f59e0b' }} />
          Saved for later
          {items && items.length > 0 && <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {items.length}</span>}
        </p>
        <button onClick={load} className="text-[12px] font-semibold hover:underline" style={{ color: CYAN }}>Refresh</button>
      </div>

      {items === null ? (
        <div className="rounded-xl border p-6 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <Loader2 size={16} className="animate-spin inline" style={{ color: 'var(--text-faint)' }} />
        </div>
      ) : (
        <div className="rounded-xl border divide-y divide-gray-100 dark:divide-white/10 overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {items.map((it) => {
            const g = gen[it.asin] || {}
            return (
              <div key={it.id} className="px-4 py-3 flex gap-3 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.image_url
                  ? <img src={it.image_url} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0 bg-white" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(14,116,144,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>
                    {it.title || it.asin}{it.brand ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {it.brand}</span> : null}
                  </p>
                  <p className="text-[11px] mt-1 flex flex-wrap gap-x-2 items-center" style={{ color: 'var(--text-soft)' }}>
                    {it.commission_pct != null && <span style={{ color: '#10B981', fontWeight: 600 }}>{it.commission_pct}% commission</span>}
                    {it.price != null && <span>${it.price}</span>}
                    {it.rating != null && <span className="inline-flex items-center gap-0.5"><Star size={10} className="fill-current" style={{ color: '#f59e0b' }} /> {it.rating}</span>}
                    <a href={`https://www.${it.marketplace || 'amazon.com'}/dp/${it.asin}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 hover:underline" style={{ color: CYAN }}>
                      {it.asin} <ExternalLink size={9} />
                    </a>
                  </p>
                  {g.error && <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{g.error}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {g.url ? (
                      <a href={g.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#10B981' }}>
                        <CheckCircle2 size={12} /> View post <ExternalLink size={10} />
                      </a>
                    ) : (
                      <button onClick={() => generate(it)} disabled={g.loading}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-60"
                        style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
                        {g.loading ? <><Loader2 size={11} className="animate-spin" /> Generating…</> : <><Sparkles size={11} /> Generate post</>}
                      </button>
                    )}
                    <a href={`https://www.${it.marketplace || 'amazon.com'}/dp/${it.asin}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white" style={{ background: '#34c759' }}>
                      <ShoppingCart size={11} /> Buy to review
                    </a>
                    <button onClick={() => remove(it.id)} disabled={removing.has(it.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-50"
                      style={{ color: 'var(--text-faint)' }} title="Remove from Saved">
                      {removing.has(it.id) ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Remove
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
