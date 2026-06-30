// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP x Levanta — admin-only Labs tool. Browse your Levanta brands + products
// (Amazon Creator network) and turn any product into a published post with a
// real commissionable Levanta tracking link. Mirrors Brand Boost: read-only
// browse here; joining brands happens in the Levanta dashboard. Token is a
// server-only env var (LEVANTA_API_TOKEN) surfaced via a setup notice when unset.

'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import ExternalKeyConnect from '@/components/integrations/ExternalKeyConnect'
import {
  ShoppingBag, RefreshCw, Loader2, ExternalLink,
  CheckCircle2, Clock, Lock, Sparkles,
} from 'lucide-react'

const LEVANTA_DASHBOARD = 'https://app.levanta.io/'
const CYAN = '#0E7490'

interface Brand {
  brandId: string; brandName: string; bio: string; image: string | null
  access: boolean; url: string; marketplace: string
}
interface Product {
  asin: string; marketplace: string; price: number | null; currency: string | null
  commission: number | null; title: string; inStock: boolean; category: string | null
  brandId: string | null; access: boolean; image: string | null
  rating: string | null; ratingsTotal: number | null; platformEpc: number | null
}
type GenState = { loading?: boolean; url?: string; error?: string }

export default function LevantaPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [needsToken, setNeedsToken] = useState(false)
  const [partneredOnly, setPartneredOnly] = useState(true)
  const [publishLive, setPublishLive] = useState(false)

  const [openBrand, setOpenBrand] = useState<string | null>(null)
  const [products, setProducts] = useState<Record<string, Product[]>>({})
  const [prodErr, setProdErr] = useState<Record<string, string>>({})
  const [prodLoading, setProdLoading] = useState<string | null>(null)
  const [gen, setGen] = useState<Record<string, GenState>>({}) // keyed by asin

  const load = useCallback(async () => {
    setLoading(true); setError(''); setForbidden(false); setNeedsToken(false)
    try {
      const qs = partneredOnly ? '?access=true' : ''
      const res = await fetch(`/api/levanta/brands${qs}`)
      const j = await res.json()
      if (res.status === 403) { setForbidden(true); setBrands([]); return }
      if (j.needsToken) { setNeedsToken(true); setBrands([]); return }
      if (!j.ok) { setError(j.error || 'Failed to load brands'); setBrands([]); return }
      setBrands(j.brands || [])
    } catch {
      setError('Network error loading brands.')
    } finally {
      setLoading(false)
    }
  }, [partneredOnly])

  useEffect(() => { load() }, [load])

  async function toggleBrand(b: Brand) {
    if (openBrand === b.brandId) { setOpenBrand(null); return }
    setOpenBrand(b.brandId)
    if (products[b.brandId]) return // cached
    setProdLoading(b.brandId)
    setProdErr((m) => ({ ...m, [b.brandId]: '' }))
    try {
      const res = await fetch(`/api/levanta/products?brandId=${encodeURIComponent(b.brandId)}`)
      const j = await res.json()
      if (!j.ok) { setProdErr((m) => ({ ...m, [b.brandId]: j.error || 'Failed to load products' })); return }
      setProducts((m) => ({ ...m, [b.brandId]: j.products || [] }))
    } catch {
      setProdErr((m) => ({ ...m, [b.brandId]: 'Network error loading products.' }))
    } finally {
      setProdLoading(null)
    }
  }

  async function generate(b: Brand, p: Product) {
    setGen((m) => ({ ...m, [p.asin]: { loading: true } }))
    try {
      const res = await fetch('/api/levanta/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            asin: p.asin, title: p.title, image: p.image, price: p.price,
            category: p.category, brandName: b.brandName, marketplace: p.marketplace || b.marketplace,
          },
          draft: !publishLive,
        }),
      })
      const j = await res.json()
      if (!j.ok) { setGen((m) => ({ ...m, [p.asin]: { error: j.error || 'Generation failed' } })); return }
      setGen((m) => ({ ...m, [p.asin]: { url: j.wordpressUrl } }))
    } catch {
      setGen((m) => ({ ...m, [p.asin]: { error: 'Network error during generation.' } }))
    }
  }

  const partnered = brands.filter((b) => b.access).length

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
          style={{ background: 'rgba(34,211,238,0.14)', color: CYAN }}>
          <ShoppingBag size={11} /> Affiliate network
        </span>
      </div>

      <PageHero
        title="MVP x Levanta"
        subtitle="Browse your Levanta brands and turn any Amazon product into a published review — with a real commissionable Levanta tracking link, written in your voice."
        accent="rgba(34,211,238,0.32)"
      />

      {/* Connect your Levanta API key — inline panel, collapses once saved.
          Refreshes the brand list on connect/disconnect. */}
      <ExternalKeyConnect provider="levanta" onConnected={load} />

      {/* How to set up & use — full Levanta onboarding (collapsible, open by default). */}
      <details open className="rounded-xl border mb-5"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <summary className="flex items-center gap-1.5 cursor-pointer select-none p-4 text-[13px] font-semibold"
          style={{ color: 'var(--text)', listStyle: 'none' }}>
          <ShoppingBag size={14} style={{ color: CYAN }} /> How to set up &amp; use MVP x Levanta
        </summary>
        <div className="px-4 pb-4 text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          <p className="mb-3">
            Levanta is an Amazon-focused affiliate network — it pays creators a commission (often above standard
            Amazon Associates) and gives a real tracking link per product. MVP x Levanta reads the brands you&rsquo;re
            partnered with and turns their products into published, affiliate-linked reviews.
          </p>
          <p className="font-semibold mb-1 mt-4" style={{ color: CYAN }}>One-time setup</p>
          <ol className="list-decimal pl-5 space-y-1.5 mb-3">
            <li>
              <span className="font-medium" style={{ color: 'var(--text)' }}>Create a Levanta creator account.</span>{' '}
              <a href={LEVANTA_DASHBOARD} target="_blank" rel="noopener noreferrer"
                className="font-medium inline-flex items-center gap-0.5" style={{ color: CYAN }}>
                Open Levanta <ExternalLink size={11} />
              </a>{' '}— API access is approval-gated, so request it from Levanta if you don&rsquo;t see it.
            </li>
            <li>
              <span className="font-medium" style={{ color: 'var(--text)' }}>Connect it to MVP.</span> Paste your Levanta
              Creator API key in the <span className="font-medium" style={{ color: CYAN }}>Connect Levanta</span> panel at the
              top of this page. It&rsquo;s stored encrypted, server-side.
            </li>
          </ol>
          <p className="font-semibold mb-1 mt-4" style={{ color: CYAN }}>Then, each time you want a post</p>
          <ol className="list-decimal pl-5 space-y-1.5" start={3}>
            <li>
              <span className="font-medium" style={{ color: 'var(--text)' }}>Partner with brands in Levanta.</span> Approve
              the brands you want to promote in the Levanta dashboard — they show here as{' '}
              <span style={{ color: '#10B981', fontWeight: 600 }}>Partnered</span>. <span className="font-medium">Refresh</span> to pull in new ones.
            </li>
            <li>
              <span className="font-medium" style={{ color: 'var(--text)' }}>Browse.</span> Open a brand to see its
              products — each shows the commission %, price, and rating.
            </li>
            <li>
              <span className="font-medium" style={{ color: 'var(--text)' }}>Generate.</span> Hit <span className="font-medium">Generate post</span> on
              any product. MVP mints a Levanta tracking link for that ASIN, pulls the real Amazon listing for specs &amp;
              images, writes a fact-grounded review in your voice (cloaked via Geniuslink if connected), and saves to
              WordPress — <span className="font-medium">draft</span> or <span className="font-medium">live</span>, per the toggle below.
            </li>
          </ol>
          <p className="mt-3 text-[12px]">
            Levanta is one of three Amazon paths (native Associate tag, PartnerBoost, Levanta). Compare a brand&rsquo;s
            commission here against your standard tag before you lean on it.
          </p>
        </div>
      </details>

      {forbidden && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <p className="text-[13px]" style={{ color: 'var(--text)' }}>MVP x Levanta is available on any paid plan.</p>
        </div>
      )}

      {needsToken && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.40)' }}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <div className="text-[13px]" style={{ color: 'var(--text)' }}>
            <p className="font-semibold mb-1">Levanta not connected</p>
            Add your Levanta API key in the <strong>Connect Levanta</strong> panel at the top of this page, then Refresh.
          </div>
        </div>
      )}

      {error && !forbidden && !needsToken && (
        <div className="rounded-xl border p-4 mb-4 text-[13px]"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)', color: 'var(--text)' }}>
          {error}
        </div>
      )}

      {/* Controls */}
      {!forbidden && !needsToken && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-1">
            {[{ k: true, label: 'Partnered' }, { k: false, label: 'All' }].map((f) => (
              <button key={String(f.k)} onClick={() => { if (f.k !== partneredOnly) { setPartneredOnly(f.k); setOpenBrand(null) } }}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  background: partneredOnly === f.k ? 'rgba(34,211,238,0.16)' : 'var(--surface)',
                  color: partneredOnly === f.k ? CYAN : 'var(--text-soft)',
                  border: '1px solid var(--border)',
                }}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => setPublishLive((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
            style={{
              background: publishLive ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)',
              color: publishLive ? '#10B981' : '#f59e0b', border: '1px solid var(--border)',
            }}
            title="Draft = saves to WordPress as a draft to review first. Live = publishes immediately.">
            {publishLive ? <><CheckCircle2 size={13} /> Publishing live</> : <><Clock size={13} /> Saving as draft</>}
          </button>
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
          <a href={LEVANTA_DASHBOARD} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
            style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)', color: '#fff' }}>
            Partner with brands in Levanta <ExternalLink size={12} />
          </a>
          <span className="ml-auto text-[12px]" style={{ color: 'var(--text-soft)' }}>
            {loading ? 'Loading…' : <>{brands.length} brand{brands.length === 1 ? '' : 's'} · {partnered} partnered</>}
          </span>
        </div>
      )}

      {!forbidden && !needsToken && !loading && brands.length === 0 && !error && (
        <div className="rounded-xl border p-6 text-center text-[13px]"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          No {partneredOnly ? 'partnered ' : ''}brands on this Levanta account.{' '}
          <span className="font-medium">Partner with brands in Levanta</span> and refresh.
        </div>
      )}

      {/* Brand list */}
      <div className="flex flex-col gap-2">
        {brands.map((b) => {
          const open = openBrand === b.brandId
          const prods = products[b.brandId]
          const pErr = prodErr[b.brandId]
          return (
            <div key={b.brandId} className="rounded-xl border overflow-hidden"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <button onClick={() => toggleBrand(b)} className="w-full flex items-center gap-3 p-3 text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.image
                  ? <img src={b.image} alt="" className="w-9 h-9 rounded object-contain bg-white flex-shrink-0" />
                  : <div className="w-9 h-9 rounded flex-shrink-0" style={{ background: 'var(--surface-bright)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>{b.brandName || b.brandId}</p>
                  {b.bio && <p className="text-[12px] truncate" style={{ color: 'var(--text-soft)' }}>{b.bio}</p>}
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={b.access
                    ? { background: 'rgba(16,185,129,0.14)', color: '#10B981' }
                    : { background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>
                  {b.access ? 'Partnered' : 'Not partnered'}
                </span>
              </button>

              {open && (
                <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
                  {prodLoading === b.brandId && (
                    <p className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--text-soft)' }}>
                      <Loader2 size={12} className="animate-spin" /> Loading products…
                    </p>
                  )}
                  {pErr && <p className="text-[12px]" style={{ color: '#ef4444' }}>{pErr}</p>}
                  {prods && prods.length === 0 && !pErr && (
                    <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>No products returned for this brand.</p>
                  )}
                  <div className="flex flex-col gap-2">
                    {(prods || []).map((p) => {
                      const g = gen[p.asin] || {}
                      return (
                        <div key={p.asin} className="flex items-center gap-3 rounded-lg p-2"
                          style={{ background: 'var(--surface-bright)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.image
                            ? <img src={p.image} alt="" className="w-12 h-12 rounded object-contain bg-white flex-shrink-0" />
                            : <div className="w-12 h-12 rounded flex-shrink-0" style={{ background: 'var(--surface)' }} />}
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{p.title || p.asin}</p>
                            <p className="text-[11px] mt-0.5 flex flex-wrap gap-x-2 items-center" style={{ color: 'var(--text-soft)' }}>
                              {p.price != null && <span>${p.price}</span>}
                              {p.commission != null && <span style={{ color: '#10B981', fontWeight: 600 }}>{p.commission}% commission</span>}
                              {p.rating && <span>★ {p.rating}</span>}
                              <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 hover:underline" style={{ color: CYAN }}>
                                {p.asin} <ExternalLink size={9} />
                              </a>
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            {g.url ? (
                              <a href={g.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#10B981' }}>
                                <CheckCircle2 size={13} /> View post <ExternalLink size={11} />
                              </a>
                            ) : (
                              <button onClick={() => generate(b, p)} disabled={g.loading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                                style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
                                {g.loading ? <><Loader2 size={12} className="animate-spin" /> Generating…</> : <><Sparkles size={12} /> Generate post</>}
                              </button>
                            )}
                            {g.error && <p className="text-[11px] mt-1 max-w-[160px]" style={{ color: '#ef4444' }}>{g.error}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
