'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Saved for later" shelf — replaces the old Campaign queue under the MVP
// Finder. Products/campaigns the creator saved from the Finder land here as a
// buy-to-review shortlist: revisit, Message the brand, Buy to review, or remove.
// Self-contained (cc_saved_finds via /api/campaigns/saved); the parent owns the
// Message-brand modal + exposes a ref-like refresh via the `reloadKey` prop.

import { useEffect, useState, useCallback } from 'react'
import { Bookmark, MessageCircle, ShoppingCart, X, Loader2, Star } from 'lucide-react'
import type { MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

interface SavedFind {
  id: string
  asin: string
  source: 'campaign' | 'onsite'
  campaign_id: string | null
  title: string | null
  brand: string | null
  image_url: string | null
  commission_pct: number | null
  price: number | null
  monthly_sales: number | null
  rating: number | null
  has_video: boolean | null
  marketplace: string | null
  details_url: string | null
}

export default function SavedFinds({
  reloadKey,
  onMessageBrand,
}: {
  /** Bump to force a reload (e.g. after the Finder saves something). */
  reloadKey: number
  onMessageBrand: (c: MessageBrandCampaign) => void
}) {
  const [items, setItems] = useState<SavedFind[] | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    fetch('/api/campaigns/saved').then(r => r.json()).then(d => {
      setItems(d?.ok && Array.isArray(d.saved) ? d.saved : [])
    }).catch(() => setItems([]))
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  async function remove(id: string) {
    setRemoving(prev => new Set(prev).add(id))
    setItems(prev => (prev ?? []).filter(i => i.id !== id)) // optimistic
    try { await fetch(`/api/campaigns/saved?id=${id}`, { method: 'DELETE' }) }
    finally { setRemoving(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  const host = (m: string | null) => ({ ca: 'www.amazon.ca', uk: 'www.amazon.co.uk', au: 'www.amazon.com.au' }[m || 'us'] || 'www.amazon.com')

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          <Bookmark size={14} className="inline -mt-0.5 mr-1.5" style={{ color: '#f59e0b' }} />
          Saved for later
          {items && items.length > 0 && <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {items.length}</span>}
        </p>
        <button onClick={load} className="text-[12px] font-semibold text-[#7C3AED] hover:underline">Refresh</button>
      </div>

      {items === null ? (
        <div className="card p-6 text-center"><Loader2 size={16} className="animate-spin inline text-[#86868b]" /></div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          Nothing saved yet. In the <b style={{ color: 'var(--text-soft)' }}>MVP Finder</b> above, hit <b style={{ color: 'var(--text-soft)' }}>Save</b> on any product to keep it here — your buy-to-review shortlist.
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 dark:divide-white/10 overflow-hidden">
          {items.map((it) => (
            <div key={it.id} className="px-4 py-3 flex gap-3 items-start">
              {it.image_url
                ? <img src={it.image_url} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0 bg-white" />
                : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                    style={it.source === 'campaign' ? { background: 'rgba(124,58,237,0.12)', color: '#7C3AED' } : { background: 'rgba(10,132,255,0.12)', color: '#0a84ff' }}>
                    {it.source === 'campaign' ? 'Affiliate+' : 'Onsite'}
                  </span>
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {it.title || it.asin}{it.brand ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {it.brand}</span> : null}
                  </p>
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-soft)' }}>
                  {it.commission_pct != null ? `${it.commission_pct}% commission` : null}
                  {it.price != null ? `${it.commission_pct != null ? ' · ' : ''}$${it.price}` : null}
                  {it.rating != null ? <> · <Star size={9} className="inline -mt-0.5" style={{ color: '#ff9500' }} /> {it.rating}</> : null}
                  {it.monthly_sales != null ? <> · {it.monthly_sales.toLocaleString()}+ sold/mo</> : null}
                  {it.has_video ? <> · 🎬 video carousel</> : null}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {it.source === 'campaign' && (
                    <button
                      onClick={() => onMessageBrand({
                        product: it.title || it.asin, asin: it.asin,
                        commissionPct: it.commission_pct, detailsUrl: it.details_url || '',
                        brandLabel: it.brand || undefined,
                      })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
                      <MessageCircle size={11} /> Message brand
                    </button>
                  )}
                  <a href={`https://${host(it.marketplace)}/dp/${it.asin}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white" style={{ background: '#34c759' }}>
                    <ShoppingCart size={11} /> Buy to review
                  </a>
                  <button onClick={() => remove(it.id)} disabled={removing.has(it.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-50"
                    style={{ color: 'var(--text-faint)' }} title="Remove from Saved">
                    {removing.has(it.id) ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Remove
                  </button>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-faint)' }}>{it.asin}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
