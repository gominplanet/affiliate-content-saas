'use client'

/**
 * Walmart Offers — browse the FULL Walmart catalog on PartnerBoost (not only the
 * brands you've joined), run through MVP's rulebook: price band, commission
 * floor, category bans, ranked by estimated $/sale. Keyword-searchable. Each
 * card → Copy link (commissionable) or Generate post (Walmart-blue
 * CTA, cloaked deep-link).
 *
 * Reads /api/walmart/offers — open to every signed-in tier (gated only by the
 * user's PartnerBoost token). Generation runs the paid + WordPress gates.
 */

import { useState, useCallback, useEffect } from 'react'
import { Loader2, Search, ExternalLink, Copy, Wand2, Package, CheckCircle2, Clock, Store, Star } from 'lucide-react'
import { toast } from 'sonner'

const WM_BLUE = '#0071CE'

interface Offer {
  key: string
  itemId: string
  name: string
  price: string | null
  oldPrice: string | null
  commissionPct: number | null
  perSale: number | null
  discountPct: number | null
  rating: number | null
  ratingsTotal: number | null
  image: string | null
  url: string
  category: string | null
  brandName: string | null
  sku: string | null
  trackingUrl: string
}

interface WalmartOffersProps {
  /** Show a connect-PartnerBoost prompt instead of rendering nothing when there's no token. */
  embedded?: boolean
  /** Scan on mount instead of waiting for a "Find offers" click. */
  autoRun?: boolean
  /** "Price drops" mode: only offers marked down at least this much, ranked by discount. */
  minDiscount?: number
  /** Ranking: 'payout' (est $/sale, default) or 'discount' (biggest markdown first). */
  sort?: 'payout' | 'discount'
  title?: string
  subtitle?: string
}

export default function WalmartOffers({ embedded = false, autoRun = false, minDiscount = 0, sort = 'payout', title, subtitle }: WalmartOffersProps = {}) {
  // MVP's standard (Focus) rulebook is always applied — no user-facing Focus/Wide
  // toggle for Walmart; keyword is the only knob for now.
  const mode = 'focus' as const
  const [q, setQ] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsToken, setNeedsToken] = useState(false)
  const [publishLive, setPublishLive] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { url: string; editUrl?: string; draft?: boolean; cloaked: boolean }>>({})

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    const qs = new URLSearchParams({ mode, page: String(page), limit: '24' })
    if (q.trim()) qs.set('q', q.trim())
    if (minDiscount > 0) qs.set('minDiscount', String(minDiscount))
    if (sort === 'discount') qs.set('sort', 'discount')
    const res = await fetch(`/api/walmart/offers?${qs.toString()}`, { cache: 'no-store' })
    const j = await res.json()
    if (j.needsToken) { setNeedsToken(true); return }
    setNeedsToken(false)
    if (!j.ok) { setError(j.error || 'Failed to load offers'); if (!append) setOffers([]); return }
    setError(null)
    const rows: Offer[] = Array.isArray(j.matches) ? j.matches : []
    setOffers((prev) => append ? [...prev, ...rows] : rows)
    setNextPage(j.nextPage ?? null)
  }, [q, minDiscount, sort])

  const run = useCallback(async () => {
    setLoading(true); setStarted(true); setError(null)
    try { await fetchPage(1, false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Network error'); setOffers([]) }
    finally { setLoading(false) }
  }, [fetchPage])

  // Scan on mount when embedded (Deal Radar) — the user didn't come here to
  // click "Find offers". Mount-only on purpose (re-scan is the Find button).
  useEffect(() => { if (autoRun) void run() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const loadMore = useCallback(async () => {
    if (nextPage == null) return
    setLoadingMore(true)
    try { await fetchPage(nextPage, true) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Network error') }
    finally { setLoadingMore(false) }
  }, [nextPage, fetchPage])

  const copyLink = async (o: Offer) => {
    const url = o.trackingUrl || o.url
    if (!url) { toast.error('No link on this item yet'); return }
    try { await navigator.clipboard.writeText(url); toast.success(o.trackingUrl ? 'Tracking link copied' : 'Product link copied (no tracking link yet)') }
    catch { toast.error('Could not copy') }
  }

  const generatePost = async (o: Offer) => {
    setGenerating(o.key)
    try {
      const res = await fetch('/api/walmart/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            name: o.name, price: o.price, oldPrice: o.oldPrice, image: o.image, url: o.url,
            category: o.category, brand: o.brandName, sku: o.sku, trackingUrl: o.trackingUrl,
          },
          network: 'Walmart',
          draft: !publishLive,
        }),
      })
      const j = await res.json()
      if (!j.ok) { toast.error(j.error || 'Generation failed'); return }
      setResults((m) => ({ ...m, [o.key]: { url: j.wordpressUrl, editUrl: j.editUrl, draft: !!j.draft, cloaked: !!j.cloaked } }))
      toast.success(`${j.draft ? 'Draft created' : 'Post published'}${j.cloaked ? ' — link cloaked via Geniuslink' : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally {
      setGenerating(null)
    }
  }

  if (needsToken) {
    if (!embedded) return null
    return (
      <div className="rounded-xl border p-4 flex items-start gap-3" style={{ background: 'rgba(0,113,206,0.08)', borderColor: 'rgba(0,113,206,0.35)' }}>
        <Store size={16} className="flex-shrink-0 mt-0.5" style={{ color: WM_BLUE }} />
        <div className="text-[13px]" style={{ color: 'var(--text)' }}>
          <p className="font-semibold mb-1">Connect PartnerBoost to see Walmart price drops</p>
          <p style={{ color: 'var(--text-soft)' }}>
            Add your PartnerBoost API key in{' '}
            <a href="/external-integrations" className="font-medium underline" style={{ color: WM_BLUE }}>External Integrations</a>, then refresh.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border mb-5 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 p-4 border-b" style={{ borderColor: 'var(--border)', background: `linear-gradient(90deg, ${WM_BLUE}14 0%, transparent 60%)` }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: WM_BLUE }}>
          <Store size={16} style={{ color: '#fff' }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>{title ?? 'Walmart Offers'}</p>
          <p className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>{subtitle ?? 'The whole Walmart catalog on PartnerBoost, filtered by MVP’s rules — not just brands you’ve joined. Ranked by estimated $/sale.'}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="p-3 flex flex-wrap items-center gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px] px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--surface-bright)', border: '1px solid var(--border)' }}>
          <Search size={13} style={{ color: 'var(--text-soft)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run() }}
            placeholder="Keyword (optional)" className="bg-transparent outline-none text-[12.5px] flex-1" style={{ color: 'var(--text)' }} />
        </div>
        <button onClick={() => setPublishLive((v) => !v)}
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold"
          style={{ background: publishLive ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)', color: publishLive ? '#10B981' : '#f59e0b', border: '1px solid var(--border)' }}
          title="Draft = saves to WordPress as a draft. Live = publishes immediately.">
          {publishLive ? <><CheckCircle2 size={13} /> Live</> : <><Clock size={13} /> Draft</>}
        </button>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
          style={{ background: WM_BLUE, color: '#fff' }}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find offers
        </button>
      </div>

      {/* Body */}
      <div className="p-3">
        {!started ? (
          <p className="text-[12.5px] p-3" style={{ color: 'var(--text-soft)' }}>
            Hit <span className="font-semibold" style={{ color: 'var(--text)' }}>Find offers</span> to scan the Walmart catalog through MVP&rsquo;s rules. Add a keyword to narrow it.
          </p>
        ) : loading ? (
          <p className="text-[12.5px] flex items-center gap-2 p-3" style={{ color: 'var(--text-soft)' }}>
            <Loader2 size={14} className="animate-spin" /> Scanning Walmart offers…
          </p>
        ) : error ? (
          <p className="text-[12.5px] p-3" style={{ color: '#ef4444' }}>{error}</p>
        ) : offers.length === 0 ? (
          <p className="text-[12.5px] p-3" style={{ color: 'var(--text-soft)' }}>
            No Walmart offers cleared the MVP criteria. Try a different keyword, or load more.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {offers.map((o) => {
                const gen = generating === o.key
                const done = results[o.key]
                return (
                  <div key={o.key} className="flex items-center gap-3 rounded-lg p-2.5" style={{ background: 'var(--surface-bright)' }}>
                    <div className="w-11 h-11 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface)' }}>
                      {o.image ? <img src={o.image} alt="" className="w-full h-full object-contain" /> : <Package size={16} style={{ color: 'var(--text-soft)' }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{o.name}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {o.commissionPct != null && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${WM_BLUE}1a`, color: WM_BLUE }}>
                            {o.commissionPct}% comm
                          </span>
                        )}
                        {o.perSale != null && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(16,185,129,0.14)', color: '#10B981' }}>
                            ~${o.perSale.toFixed(2)}/sale
                          </span>
                        )}
                        {o.discountPct != null && o.discountPct > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}>
                            {Math.round(o.discountPct)}% off
                          </span>
                        )}
                        {o.rating != null && (
                          <span className="inline-flex items-center gap-0.5 text-[10.5px]" style={{ color: 'var(--text-soft)' }}>
                            <Star size={9} fill="#f59e0b" style={{ color: '#f59e0b' }} /> {o.rating.toFixed(1)}{o.ratingsTotal ? ` (${o.ratingsTotal.toLocaleString()})` : ''}
                          </span>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>
                          {o.price ? `$${o.price}` : '—'}{o.oldPrice ? ` (was $${o.oldPrice})` : ''}
                        </span>
                        {o.url && (
                          <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline text-[11px]" style={{ color: WM_BLUE }}>
                            See product <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => copyLink(o)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}
                        title="Copy the commissionable tracking link">
                        <Copy size={12} /> Link
                      </button>
                      {done ? (
                        <a href={done.draft ? (done.editUrl || done.url) : done.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
                          style={{ background: 'rgba(16,185,129,0.16)', color: '#10B981' }}>
                          <CheckCircle2 size={12} /> {done.draft ? 'View draft' : 'View post'} <ExternalLink size={11} />
                        </a>
                      ) : (
                        <button onClick={() => generatePost(o)} disabled={gen}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-60"
                          style={{ background: WM_BLUE, color: '#fff' }}>
                          {gen ? <><Loader2 size={12} className="animate-spin" /> Writing…</> : <><Wand2 size={12} /> Generate post</>}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {nextPage != null && (
              <button onClick={loadMore} disabled={loadingMore}
                className="w-full mt-2 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--surface-bright)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                {loadingMore ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading…</span> : 'Load more offers'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
