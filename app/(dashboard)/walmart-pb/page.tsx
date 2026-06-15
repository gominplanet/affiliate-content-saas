'use client'

/**
 * Walmart PB — admin-only Labs tool that shows your live PartnerBoost Walmart
 * brands (via /api/walmart/brands → Monetization API). Read-only on purpose:
 * it lists the brands you can promote + your relationship status + the
 * deep-link tracking base. JOINING happens in PartnerBoost (terms + merchant
 * approval), so this links out to the dashboard for that. Once a brand is
 * Joined (green), MVP can monetize any product on its site via the deep-link.
 *
 * Admin-only while testing: the sidebar entry is isAdmin-gated and the API
 * returns 403 for non-admins (we show a clean notice if someone deep-links in).
 */

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, ExternalLink, Copy, FlaskConical, Lock, Store, CheckCircle2, Clock, ChevronDown, Wand2, Package } from 'lucide-react'
import { toast } from 'sonner'

const PB_DASHBOARD = 'https://app.partnerboost.com/'

interface Brand {
  mcid: string | null
  brand_id: string | null
  merchant_name: string
  comm_rate: string
  avg_payout: string
  offer_type: string
  relationship: string
  allow_sml: boolean
  categories: string
  tags: string
  country: string
  logo: string
  site_url: string
  tracking_url: string
  tracking_url_short: string
  brand_status: string
  rd: string
}

interface WMProduct {
  name: string
  price: string | null
  oldPrice: string | null
  currency: string | null
  description: string
  image: string | null
  url: string
  category: string | null
  brand: string | null
  merchantName: string | null
  mcid: string | null
  brandId: string | null
  sku: string | null
  trackingUrl: string
}

const REL_FILTERS = ['', 'Joined', 'Pending', 'No Relationship'] as const
// Only networks that actually return inventory through PartnerBoost's API.
// TikTok dropped 2026-06-15 — the account has 0 TikTok brands (and the datafeed
// returns none). Re-add if TikTok Shop campaigns ever appear.
const NETWORKS = ['Walmart', 'Amazon', 'DTC'] as const

function relStyle(rel: string): { bg: string; fg: string; icon: React.ReactNode } {
  const r = (rel || '').toLowerCase()
  if (r.includes('joined')) return { bg: 'rgba(16,185,129,0.14)', fg: '#10B981', icon: <CheckCircle2 size={12} /> }
  if (r.includes('pending')) return { bg: 'rgba(245,158,11,0.14)', fg: '#f59e0b', icon: <Clock size={12} /> }
  if (r.includes('reject')) return { bg: 'rgba(239,68,68,0.14)', fg: '#ef4444', icon: <Lock size={12} /> }
  return { bg: 'var(--surface-bright)', fg: 'var(--text-soft)', icon: <span /> }
}

export default function WalmartPBPage() {
  const [loading, setLoading] = useState(true)
  const [brands, setBrands] = useState<Brand[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [needsToken, setNeedsToken] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [rel, setRel] = useState<string>('')
  const [network, setNetwork] = useState<string>('Walmart')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ brandType: network })
      if (rel) qs.set('relationship', rel)
      const res = await fetch(`/api/walmart/brands?${qs.toString()}`, { cache: 'no-store' })
      if (res.status === 403) { setForbidden(true); setBrands([]); return }
      const j = await res.json()
      if (j.needsToken) { setNeedsToken(true); setBrands([]); return }
      if (!j.ok) { setError(j.error || 'Failed to load'); setBrands([]); return }
      setForbidden(false); setNeedsToken(false)
      setBrands(Array.isArray(j.brands) ? j.brands : [])
      setTotal(Number(j.total) || (j.brands?.length ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setBrands([])
    } finally {
      setLoading(false)
    }
  }, [rel, network])

  useEffect(() => { load() }, [load])

  const joined = brands.filter((b) => /joined/i.test(b.relationship)).length

  const copyLink = async (url: string) => {
    if (!url) { toast.error('No tracking link on this brand yet'); return }
    try { await navigator.clipboard.writeText(url); toast.success('Tracking link copied') }
    catch { toast.error('Could not copy') }
  }

  // ── Per-brand product browsing + one-click post generation ────────────────
  const [openBrand, setOpenBrand] = useState<string | null>(null)
  const [products, setProducts] = useState<Record<string, WMProduct[]>>({})
  const [prodLoading, setProdLoading] = useState<string | null>(null)
  const [prodErr, setProdErr] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { url: string; cloaked: boolean }>>({})

  const toggleProducts = async (b: Brand) => {
    if (!b.mcid) return
    if (openBrand === b.mcid) { setOpenBrand(null); return }
    setOpenBrand(b.mcid)
    if (products[b.mcid]) return // already loaded
    setProdLoading(b.mcid)
    setProdErr((m) => ({ ...m, [b.mcid!]: '' }))
    try {
      const qs = new URLSearchParams({ limit: '24', brandType: network })
      if (b.brand_id) qs.set('brandId', b.brand_id)
      qs.set('mcid', b.mcid)
      const res = await fetch(`/api/walmart/products?${qs.toString()}`, { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) { setProdErr((m) => ({ ...m, [b.mcid!]: j.error || 'Failed to load products' })); return }
      setProducts((m) => ({ ...m, [b.mcid!]: Array.isArray(j.products) ? j.products : [] }))
    } catch (e) {
      setProdErr((m) => ({ ...m, [b.mcid!]: e instanceof Error ? e.message : 'Network error' }))
    } finally {
      setProdLoading(null)
    }
  }

  const generatePost = async (b: Brand, pr: WMProduct) => {
    const key = pr.url || pr.sku || pr.name
    setGenerating(key)
    try {
      const res = await fetch('/api/walmart/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: pr, brandTrackingUrl: b.tracking_url, network }),
      })
      const j = await res.json()
      if (!j.ok) { toast.error(j.error || 'Generation failed'); return }
      setResults((m) => ({ ...m, [key]: { url: j.wordpressUrl, cloaked: !!j.cloaked } }))
      toast.success(j.cloaked ? 'Post published — link cloaked via Geniuslink' : 'Post published')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Labs identity pill */}
      <div className="mb-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide"
          style={{ background: 'rgba(34,211,238,0.14)', color: '#0E7490' }}>
          <FlaskConical size={11} /> MVP Labs · admin only
        </span>
      </div>

      <PageHero
        title="PartnerBoost"
        subtitle="Your live PartnerBoost brands across every network — commission, your join status, and the deep-link base for each. Pick a network, browse a Joined brand's products, and turn any one into a post with a cloaked affiliate link."
        accent="rgba(34,211,238,0.32)"
      />

      {/* What this is */}
      <div className="rounded-xl border p-4 mb-5 text-[13px] leading-relaxed"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
        <p className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
          <Store size={14} style={{ color: '#0E7490' }} /> What this shows
        </p>
        This is a live read of the PartnerBoost Monetization API across all networks. It can&rsquo;t join campaigns for you —
        joining means accepting a brand&rsquo;s terms (and, for manual programs, waiting on their approval), which lives in the
        PartnerBoost dashboard. Use <span className="font-medium">Join more in PartnerBoost</span> below, then come back and refresh
        to see new <span style={{ color: '#10B981', fontWeight: 600 }}>Joined</span> brands.
      </div>

      {/* Forbidden / token / error states */}
      {forbidden && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <p className="text-[13px]" style={{ color: 'var(--text)' }}>
            PartnerBoost is admin-only while it&rsquo;s in Labs.
          </p>
        </div>
      )}

      {needsToken && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.40)' }}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <div className="text-[13px]" style={{ color: 'var(--text)' }}>
            <p className="font-semibold mb-1">PartnerBoost token not configured</p>
            Set <code className="px-1 rounded" style={{ background: 'var(--surface-bright)' }}>PARTNERBOOST_API_TOKEN</code> in
            the Vercel environment (your PartnerBoost dashboard → Tools → API token), then redeploy and refresh this page.
          </div>
        </div>
      )}

      {error && !forbidden && !needsToken && (
        <div className="rounded-xl border p-4 mb-4 text-[13px]"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)', color: 'var(--text)' }}>
          {error}
        </div>
      )}

      {/* Network picker */}
      {!forbidden && !needsToken && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {NETWORKS.map((n) => (
            <button key={n}
              onClick={() => { if (n !== network) { setNetwork(n); setOpenBrand(null); setProducts({}); setProdErr({}) } }}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
              style={{
                background: network === n ? 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' : 'var(--surface)',
                color: network === n ? '#fff' : 'var(--text-soft)',
                border: '1px solid var(--border)',
              }}>
              {n}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      {!forbidden && !needsToken && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-1">
            {REL_FILTERS.map((f) => (
              <button key={f || 'all'} onClick={() => setRel(f)}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  background: rel === f ? 'rgba(34,211,238,0.16)' : 'var(--surface)',
                  color: rel === f ? '#0E7490' : 'var(--text-soft)',
                  border: '1px solid var(--border)',
                }}>
                {f || 'All'}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
          <a href={PB_DASHBOARD} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
            style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)', color: '#fff' }}>
            Join more in PartnerBoost <ExternalLink size={12} />
          </a>
          <span className="ml-auto text-[12px]" style={{ color: 'var(--text-soft)' }}>
            {loading ? 'Loading…' : <>{total} {network} brand{total === 1 ? '' : 's'} · {joined} joined</>}
          </span>
        </div>
      )}

      {/* Brand list */}
      {!forbidden && !needsToken && !loading && brands.length === 0 && !error && (
        <div className="rounded-xl border p-6 text-center text-[13px]"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          No {network} brands{rel ? ` with status “${rel}”` : ''} on this account. Try another network above, or
          <span className="font-medium"> Join more in PartnerBoost</span> and refresh.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {brands.map((b) => {
          const rs = relStyle(b.relationship)
          const isJoined = /joined/i.test(b.relationship)
          const open = !!b.mcid && openBrand === b.mcid
          const prods = b.mcid ? products[b.mcid] : undefined
          const pErr = b.mcid ? prodErr[b.mcid] : ''
          return (
            <div key={(b.mcid || b.merchant_name) + b.relationship}
              className="rounded-xl border"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="p-3 flex items-center gap-3">
                {/* Logo */}
                <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center"
                  style={{ background: 'var(--surface-bright)' }}>
                  {b.logo
                    ? <img src={b.logo} alt="" className="w-full h-full object-contain" />
                    : <Store size={18} style={{ color: 'var(--text-soft)' }} />}
                </div>

                {/* Name + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>{b.merchant_name || '—'}</p>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                      style={{ background: rs.bg, color: rs.fg }}>
                      {rs.icon} {b.relationship || 'Unknown'}
                    </span>
                    {b.allow_sml && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: 'rgba(34,211,238,0.12)', color: '#0E7490' }}
                        title="Deep-linking enabled — any product URL on this brand can be affiliate-wrapped">
                        deep-link
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] truncate" style={{ color: 'var(--text-soft)' }}>
                    {b.comm_rate || '—'}{b.offer_type ? ` · ${b.offer_type}` : ''}
                    {b.categories ? ` · ${b.categories}` : ''}{b.country ? ` · ${b.country}` : ''}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isJoined && b.mcid && (
                    <button onClick={() => toggleProducts(b)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{ background: open ? 'rgba(34,211,238,0.16)' : 'var(--surface-bright)', color: open ? '#0E7490' : 'var(--text)' }}
                      title="Browse this brand's products and generate a post">
                      <Package size={12} /> Products
                      <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                    </button>
                  )}
                  {b.tracking_url && (
                    <button onClick={() => copyLink(b.tracking_url)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                      style={{ background: 'var(--surface-bright)', color: 'var(--text)' }}
                      title="Copy the deep-link tracking base">
                      <Copy size={12} /> Link
                    </button>
                  )}
                  {b.site_url && (
                    <a href={b.site_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
                      style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}
                      title="Open brand site">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </div>

              {/* Products expander (joined brands) */}
              {open && (
                <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
                  {prodLoading === b.mcid ? (
                    <p className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
                      <Loader2 size={13} className="animate-spin" /> Loading products…
                    </p>
                  ) : pErr ? (
                    <p className="text-[12px]" style={{ color: '#ef4444' }}>{pErr}</p>
                  ) : (prods || []).length === 0 ? (
                    <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>No products in the datafeed for this brand yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {(prods || []).map((pr) => {
                        const key = pr.url || pr.sku || pr.name
                        const gen = generating === key
                        const done = results[key]
                        return (
                          <div key={key} className="flex items-center gap-3 rounded-lg p-2" style={{ background: 'var(--surface-bright)' }}>
                            <div className="w-9 h-9 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface)' }}>
                              {pr.image ? <img src={pr.image} alt="" className="w-full h-full object-contain" /> : <Package size={15} style={{ color: 'var(--text-soft)' }} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{pr.name}</p>
                              <p className="text-[11px]" style={{ color: 'var(--text-soft)' }}>
                                {pr.price ? `$${pr.price}` : '—'}{pr.oldPrice ? ` (was $${pr.oldPrice})` : ''}{pr.category ? ` · ${pr.category}` : ''}
                              </p>
                            </div>
                            {done ? (
                              <a href={done.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
                                style={{ background: 'rgba(16,185,129,0.16)', color: '#10B981' }}>
                                <CheckCircle2 size={12} /> View post <ExternalLink size={11} />
                              </a>
                            ) : (
                              <button onClick={() => generatePost(b, pr)} disabled={gen}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 disabled:opacity-60"
                                style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)', color: '#fff' }}>
                                {gen ? <><Loader2 size={12} className="animate-spin" /> Writing…</> : <><Wand2 size={12} /> Generate post</>}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
