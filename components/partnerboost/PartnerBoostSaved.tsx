'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Saved for later" shelf for the PartnerBoost MVP Finder. Products bookmarked
// from the Finder land here to act on later: Generate post · Buy to review ·
// Remove. Backed by cc_saved_finds (source='partnerboost') via
// /api/partnerboost/saved; the deep-link bases are stashed so shelf-generate
// stays monetized. Parent bumps `reloadKey` after the Finder saves.

import { useEffect, useState, useCallback } from 'react'
import { Bookmark, ShoppingCart, Sparkles, X, Loader2, CheckCircle2, ExternalLink, MessageCircle } from 'lucide-react'
import MessageBrandFlow, { type MessageBrandTarget } from '@/components/campaigns/MessageBrandFlow'

const CYAN = '#0E7490'

interface SavedItem {
  id: string
  asin: string            // product key
  title: string | null
  brand: string | null
  image_url: string | null
  commission_pct: number | null
  price: number | null
  marketplace: string | null   // network
  details_url: string | null   // product page
  campaign_id: string | null   // brand deep-link base
  notes: string | null         // product tracking link
}
type GenState = { loading?: boolean; url?: string; editUrl?: string; draft?: boolean; error?: string }

export default function PartnerBoostSaved({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<SavedItem[] | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [gen, setGen] = useState<Record<string, GenState>>({})
  const [msg, setMsg] = useState<MessageBrandTarget | null>(null)

  const load = useCallback(() => {
    fetch('/api/partnerboost/saved').then(r => r.json()).then(d => {
      setItems(d?.ok && Array.isArray(d.saved) ? d.saved : [])
    }).catch(() => setItems([]))
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  async function remove(id: string) {
    setRemoving(prev => new Set(prev).add(id))
    setItems(prev => (prev ?? []).filter(i => i.id !== id))
    try { await fetch(`/api/partnerboost/saved?id=${id}`, { method: 'DELETE' }) }
    finally { setRemoving(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  async function generate(it: SavedItem) {
    setGen(g => ({ ...g, [it.id]: { loading: true } }))
    try {
      const res = await fetch('/api/walmart/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            name: it.title, price: it.price != null ? String(it.price) : null, oldPrice: null,
            currency: null, description: '', image: it.image_url, url: it.details_url,
            category: null, brand: it.brand, merchantName: it.brand, sku: null, trackingUrl: it.notes || '',
          },
          brandTrackingUrl: it.campaign_id || '', network: it.marketplace || 'Walmart', draft: true,
        }),
      })
      const j = await res.json()
      if (!j.ok) { setGen(g => ({ ...g, [it.id]: { error: j.error || 'Generation failed' } })); return }
      setGen(g => ({ ...g, [it.id]: { url: j.wordpressUrl, editUrl: j.editUrl, draft: !!j.draft } }))
    } catch {
      setGen(g => ({ ...g, [it.id]: { error: 'Network error during generation.' } }))
    }
  }

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
            const g = gen[it.id] || {}
            return (
              <div key={it.id} className="px-4 py-3 flex gap-3 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.image_url
                  ? <img src={it.image_url} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0 bg-white" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(14,116,144,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>
                    {it.title || '(untitled)'}{it.brand ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {it.brand}</span> : null}
                  </p>
                  <p className="text-[11px] mt-1 flex flex-wrap gap-x-2 items-center" style={{ color: 'var(--text-soft)' }}>
                    {it.marketplace && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold" style={{ background: 'rgba(14,116,144,0.12)', color: CYAN }}>{it.marketplace}</span>}
                    {it.commission_pct != null && <span style={{ color: '#10B981', fontWeight: 600 }}>{it.commission_pct}% commission</span>}
                    {it.price != null && <span>${it.price}</span>}
                  </p>
                  {g.error && <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{g.error}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {g.url ? (
                      <a href={g.draft ? (g.editUrl || g.url) : g.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#10B981' }}>
                        <CheckCircle2 size={12} /> {g.draft ? 'View draft' : 'View post'} <ExternalLink size={10} />
                      </a>
                    ) : (
                      <button onClick={() => generate(it)} disabled={g.loading || !it.details_url}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white disabled:opacity-60"
                        style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
                        {g.loading ? <><Loader2 size={11} className="animate-spin" /> Generating…</> : <><Sparkles size={11} /> Generate post</>}
                      </button>
                    )}
                    {it.details_url && (
                      <a href={it.details_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white" style={{ background: '#34c759' }}>
                        <ShoppingCart size={11} /> Buy to review
                      </a>
                    )}
                    <button onClick={() => setMsg({ product: it.title || '', brand: it.brand || '', asin: it.asin, commissionPct: it.commission_pct, network: 'PartnerBoost', networkUrl: 'https://app.partnerboost.com/' })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
                      <MessageCircle size={11} /> Message brand
                    </button>
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

      {msg && <MessageBrandFlow target={msg} onClose={() => setMsg(null)} />}
    </div>
  )
}
