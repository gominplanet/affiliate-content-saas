'use client'

/**
 * Walmart Offers — browse the FULL Walmart catalog on PartnerBoost (not only the
 * brands you've joined), run through MVP's rulebook: price band, commission
 * floor, category bans, ranked by estimated $/sale. Keyword-searchable.
 *
 * Cards mirror the Amazon Deal Radar card: Make blog post (→ /api/walmart/generate),
 * Quick post to socials (→ WalmartQuickPostModal), Add to roundup (→ a floating
 * bar → /api/walmart/roundup), View on Walmart, and Copy link (minted + cloaked).
 *
 * Reads /api/walmart/offers — open to every signed-in tier (gated only by the
 * user's PartnerBoost token). Posting actions run the paid + WordPress gates.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Loader2, Search, ExternalLink, Copy, Package, Store, Star, Coins, Flame,
  Plus, Check, Send, ArrowRight, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import WalmartQuickPostModal, { type WalmartQuickPostItem } from '@/components/walmart/WalmartQuickPostModal'

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
  /** URL of the user's existing post for this item, if they already made one. */
  posted: string | null
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
  const [generating, setGenerating] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { url: string; editUrl?: string; draft?: boolean; cloaked: boolean }>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [quickPostItem, setQuickPostItem] = useState<WalmartQuickPostItem | null>(null)
  const [roundupBusy, setRoundupBusy] = useState(false)

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
    try {
      // Mint the guaranteed-attributed link (and cloak via Geniuslink if the
      // user has it) server-side, then copy that — not the bare product URL.
      const res = await fetch('/api/walmart/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: o.itemId, title: o.name, fallbackUrl: o.trackingUrl || o.url }),
      })
      const j = await res.json().catch(() => ({}))
      const url = j.ok ? j.url : (o.trackingUrl || o.url)
      if (!url) { toast.error('No link on this item yet'); return }
      await navigator.clipboard.writeText(url)
      toast.success(
        j.cloaked ? 'Cloaked link copied (Geniuslink)'
        : j.source === 'minted' ? 'Tracking link copied'
        : 'Product link copied (no tracking link yet)',
      )
    } catch { toast.error('Could not copy') }
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
          draft: false,
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

  const toggleSelect = (itemId: string) => setSelected((s) => {
    const n = new Set(s); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n
  })

  const createRoundup = async () => {
    const items = offers.filter((o) => selected.has(o.itemId)).map((o) => ({
      itemId: o.itemId, name: o.name, image: o.image, url: o.url,
      price: o.price, oldPrice: o.oldPrice, discountPct: o.discountPct,
    }))
    if (items.length < 2) { toast.error('Pick at least 2 deals for a roundup.'); return }
    setRoundupBusy(true)
    try {
      const res = await fetch('/api/walmart/roundup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) { toast.error(j.error || 'Could not build the roundup.'); return }
      toast.success('Roundup post published.')
      if (j.url) window.open(j.url, '_blank')
      setSelected(new Set())
    } catch { toast.error('Could not build the roundup.') } finally { setRoundupBusy(false) }
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {offers.map((o) => {
                const gen = generating === o.key
                const done = results[o.key]
                const inRoundup = selected.has(o.itemId)
                return (
                  <div key={o.key} className="rounded-xl border bg-card overflow-hidden flex flex-col transition-shadow hover:shadow-md" style={{ borderColor: 'var(--border)' }}>
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="relative flex items-center justify-center bg-white h-40 p-3">
                      {o.image
                        ? <img src={o.image} alt="" className="max-h-full max-w-full object-contain" />
                        : <div className="flex items-center justify-center text-muted-foreground"><Package size={26} /></div>}
                      {o.discountPct != null && o.discountPct > 0 && (
                        <span className="absolute top-2 left-2 text-xs font-bold bg-red-600 text-white rounded px-1.5 py-0.5">-{Math.round(o.discountPct)}%</span>
                      )}
                      {o.perSale != null && o.perSale >= 10 && (
                        <span className="absolute bottom-2 right-2 text-[10px] font-bold text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5" style={{ background: '#7C3AED' }} title="High estimated earnings per sale"><Flame size={10} /> Top pick</span>
                      )}
                      {o.posted && (
                        <span className="absolute bottom-2 left-2 text-[10px] font-bold bg-emerald-600 text-white rounded px-1.5 py-0.5 inline-flex items-center gap-0.5" title="You've already published this"><Check size={10} /> Published</span>
                      )}
                    </a>
                    <div className="p-3 flex flex-col gap-1.5 flex-1">
                      <div className="text-sm font-medium line-clamp-2 leading-snug min-h-[2.5rem]" style={{ color: 'var(--text)' }}>{o.name}</div>
                      {o.brandName && <div className="text-xs text-muted-foreground">{o.brandName}</div>}
                      <div className="flex items-center gap-2">
                        {o.price && <span className="text-base font-bold" style={{ color: 'var(--text)' }}>${o.price}</span>}
                        {o.oldPrice && <span className="text-xs text-muted-foreground line-through">${o.oldPrice}</span>}
                      </div>
                      {o.rating != null && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Star size={12} className="fill-amber-400 text-amber-400" /> {o.rating.toFixed(1)}
                          {o.ratingsTotal != null && <span>({o.ratingsTotal.toLocaleString()})</span>}
                        </div>
                      )}
                      {o.perSale != null && o.perSale > 0 && (
                        <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 w-fit" title="Estimated commission per sale">
                          <Coins size={12} /> ≈ ${o.perSale.toFixed(2)}/sale
                          {o.commissionPct != null && <span className="font-normal text-muted-foreground">· {o.commissionPct}% comm</span>}
                        </div>
                      )}
                      <div className="mt-auto pt-2 space-y-1.5">
                        {o.posted && !done && (
                          <a href={o.posted} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                            <Check size={12} /> You&apos;ve posted this — view it
                          </a>
                        )}
                        {done ? (
                          <a href={done.draft ? (done.editUrl || done.url) : done.url} target="_blank" rel="noopener noreferrer"
                            className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-emerald-600 text-white py-2">
                            <Check size={14} /> {done.draft ? 'View draft' : 'View post'}
                          </a>
                        ) : (
                          <button onClick={() => generatePost(o)} disabled={gen}
                            className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-full bg-violet-600 hover:bg-violet-700 text-white py-2 disabled:opacity-60 transition">
                            {gen ? <><Loader2 size={14} className="mr-1 animate-spin" /> Writing…</> : o.posted ? <>Post again <ArrowRight size={14} className="ml-1" /></> : <>Make blog post <ArrowRight size={14} className="ml-1" /></>}
                          </button>
                        )}
                        <button onClick={() => setQuickPostItem({ itemId: o.itemId, name: o.name, imageUrl: o.image, url: o.trackingUrl || o.url })}
                          className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white py-2 transition">
                          <Send size={13} /> Quick post to socials
                        </button>
                        <div className="flex items-center justify-between pt-0.5">
                          <button onClick={() => toggleSelect(o.itemId)} title={inRoundup ? 'Remove from roundup' : 'Add to a roundup post'}
                            className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-1 transition ${inRoundup ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : 'text-muted-foreground hover:bg-accent'}`}>
                            {inRoundup ? <><Check size={12} /> In roundup</> : <><Plus size={12} /> Add to roundup</>}
                          </button>
                          <div className="flex items-center gap-2">
                            <button onClick={() => copyLink(o)} title="Copy the commissionable tracking link"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                              <Copy size={12} /> Link
                            </button>
                            <a href={o.url} target="_blank" rel="noopener noreferrer" title="View on Walmart"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                              Walmart <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {nextPage != null && (
              <button onClick={loadMore} disabled={loadingMore}
                className="w-full mt-3 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--surface-bright)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                {loadingMore ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading…</span> : 'Load more offers'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Floating roundup bar — appears once a deal is selected. */}
      {selected.size >= 1 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border bg-white dark:bg-[#16161a] shadow-2xl px-4 py-2.5">
          <span className="text-sm font-medium inline-flex items-center gap-1.5"><Layers size={15} /> {selected.size} selected</span>
          <button onClick={createRoundup} disabled={selected.size < 2 || roundupBusy}
            title={selected.size < 2 ? 'Pick at least 2 deals' : 'Publish a curated roundup post of these Walmart deals'}
            className="text-sm font-semibold rounded-full text-white px-4 py-1.5 disabled:opacity-60 inline-flex items-center gap-1.5"
            style={{ background: WM_BLUE }}>
            {roundupBusy ? <><Loader2 size={14} className="animate-spin" /> Building…</> : 'Create roundup post'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}

      {quickPostItem && <WalmartQuickPostModal item={quickPostItem} onClose={() => setQuickPostItem(null)} />}
    </div>
  )
}
