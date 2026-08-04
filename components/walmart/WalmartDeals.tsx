'use client'

/**
 * Walmart Deals — the live Affiliate Boost feed from PartnerBoost: Walmart items
 * with a boosted commission right now. Each card shows the boost %, how long it
 * runs, the product, a one-click "Copy link" (commissionable tracking link), and
 * "Generate post" (reuses /api/walmart/generate with network=Walmart, so the
 * post gets the Walmart-blue CTA and the cloaked deep-link).
 *
 * Read from /api/walmart/deals — open to every signed-in tier (gated only by the
 * user's own PartnerBoost token). Generation still runs the paid + WordPress
 * gates server-side.
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, ExternalLink, Copy, Wand2, Package, CheckCircle2, Clock, Zap, TicketPercent, Store } from 'lucide-react'
import { toast } from 'sonner'

// Walmart brand palette — used only here so the feed reads unmistakably as the
// Walmart feature (the rest of the page uses the PartnerBoost cyan).
const WM_BLUE = '#0071CE'
const WM_SPARK = '#FFC220'

interface Deal {
  itemId: string
  name: string
  price: string | null
  oldPrice: string | null
  image: string | null
  url: string
  category: string | null
  brand: string | null
  sku: string | null
  trackingUrl: string
  boostCommissionPct: number | null
  startTime: string | null
  endTime: string | null
}

/** "ends in 3d" / "ends in 5h" / "ending soon" from an ISO end time. */
function endsIn(iso: string | null): string | null {
  if (!iso) return null
  const end = Date.parse(iso)
  if (!Number.isFinite(end)) return null
  const ms = end - Date.now()
  if (ms <= 0) return null
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `ends in ${days}d`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `ends in ${hours}h`
  return 'ending soon'
}

export default function WalmartDeals({ timedOnly = false, embedded = false }: { timedOnly?: boolean; embedded?: boolean } = {}) {
  const [loading, setLoading] = useState(true)
  const [deals, setDeals] = useState<Deal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [needsToken, setNeedsToken] = useState(false)
  const [publishLive, setPublishLive] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { url: string; editUrl?: string; draft?: boolean; cloaked: boolean }>>({})

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/walmart/deals', { cache: 'no-store' })
      const j = await res.json()
      if (j.needsToken) { setNeedsToken(true); setDeals([]); return }
      if (!j.ok) { setError(j.error || 'Failed to load Walmart deals'); setDeals([]); return }
      setNeedsToken(false)
      setDeals(Array.isArray(j.deals) ? j.deals : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setDeals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const copyLink = async (d: Deal) => {
    const url = d.trackingUrl || d.url
    if (!url) { toast.error('No link on this item yet'); return }
    try { await navigator.clipboard.writeText(url); toast.success(d.trackingUrl ? 'Tracking link copied' : 'Product link copied (no tracking link yet)') }
    catch { toast.error('Could not copy') }
  }

  const generatePost = async (d: Deal) => {
    setGenerating(d.itemId)
    try {
      const res = await fetch('/api/walmart/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            name: d.name, price: d.price, oldPrice: d.oldPrice, image: d.image, url: d.url,
            category: d.category, brand: d.brand, sku: d.sku, trackingUrl: d.trackingUrl,
          },
          network: 'Walmart',
          draft: !publishLive,
        }),
      })
      const j = await res.json()
      if (!j.ok) { toast.error(j.error || 'Generation failed'); return }
      setResults((m) => ({ ...m, [d.itemId]: { url: j.wordpressUrl, editUrl: j.editUrl, draft: !!j.draft, cloaked: !!j.cloaked } }))
      toast.success(`${j.draft ? 'Draft created' : 'Post published'}${j.cloaked ? ' — link cloaked via Geniuslink' : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally {
      setGenerating(null)
    }
  }

  // In Deal Radar, "real timed deals only" — keep boosts with a genuine future
  // end time (a live countdown), not open-ended ones.
  const shown = timedOnly
    ? deals.filter((d) => d.endTime && Number.isFinite(Date.parse(d.endTime)) && Date.parse(d.endTime) > Date.now())
    : deals

  // On the /partnerboost page the finder below already prompts to connect, so we
  // stay out of the way (null). Embedded in Deal Radar there's no such prompt, so
  // show one — otherwise the Walmart tab looks broken.
  if (needsToken) {
    if (!embedded) return null
    return (
      <div className="rounded-xl border p-4 flex items-start gap-3" style={{ background: 'rgba(0,113,206,0.08)', borderColor: 'rgba(0,113,206,0.35)' }}>
        <Store size={16} className="flex-shrink-0 mt-0.5" style={{ color: WM_BLUE }} />
        <div className="text-[13px]" style={{ color: 'var(--text)' }}>
          <p className="font-semibold mb-1">Connect PartnerBoost to see Walmart deals</p>
          <p style={{ color: 'var(--text-soft)' }}>
            Walmart deals come from your PartnerBoost account. Add your API key in{' '}
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
          <Zap size={16} style={{ color: WM_SPARK }} fill={WM_SPARK} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>Walmart Deals</p>
          <p className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>Live commission boosts on Walmart items, straight from PartnerBoost. Turn any one into a post with a cloaked link.</p>
        </div>
        <button onClick={() => setPublishLive((v) => !v)}
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold"
          style={{ background: publishLive ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)', color: publishLive ? '#10B981' : '#f59e0b', border: '1px solid var(--border)' }}
          title="Draft = saves to WordPress as a draft to review first. Live = publishes immediately.">
          {publishLive ? <><CheckCircle2 size={13} /> Publishing live</> : <><Clock size={13} /> Saving as draft</>}
        </button>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--surface-bright)', color: 'var(--text)', border: '1px solid var(--border)' }}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {/* Body */}
      <div className="p-3">
        {loading ? (
          <p className="text-[12.5px] flex items-center gap-2 p-3" style={{ color: 'var(--text-soft)' }}>
            <Loader2 size={14} className="animate-spin" /> Loading Walmart deals…
          </p>
        ) : error ? (
          /not authorized|affiliate boost|contact publisher/i.test(error) ? (
            <div className="text-[12.5px] p-3 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
              <span className="font-semibold" style={{ color: 'var(--text)' }}>Affiliate Boost isn&rsquo;t enabled on your PartnerBoost account yet.</span>{' '}
              These are live commission boosts on Walmart items. To turn them on, ask PartnerBoost to enable <span className="font-medium">Affiliate Boost for Walmart</span> for your publisher account. Walmart price drops below work without it.
            </div>
          ) : (
            <p className="text-[12.5px] p-3" style={{ color: '#ef4444' }}>{error}</p>
          )
        ) : shown.length === 0 ? (
          <p className="text-[12.5px] p-3" style={{ color: 'var(--text-soft)' }}>
            No live Walmart {timedOnly ? 'timed deals' : 'commission boosts'} right now. Check back — PartnerBoost refreshes these often.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((d) => {
              const gen = generating === d.itemId
              const done = results[d.itemId]
              const ends = endsIn(d.endTime)
              return (
                <div key={d.itemId} className="flex items-center gap-3 rounded-lg p-2.5" style={{ background: 'var(--surface-bright)' }}>
                  <div className="w-11 h-11 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface)' }}>
                    {d.image ? <img src={d.image} alt="" className="w-full h-full object-contain" /> : <Package size={16} style={{ color: 'var(--text-soft)' }} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{d.name}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {d.boostCommissionPct != null && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${WM_BLUE}1a`, color: WM_BLUE }}>
                          <TicketPercent size={10} /> {d.boostCommissionPct}% boost
                        </span>
                      )}
                      {ends && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}>
                          <Clock size={10} /> {ends}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>
                        {d.price ? `$${d.price}` : '—'}{d.oldPrice ? ` (was $${d.oldPrice})` : ''}
                      </span>
                      {d.url && (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline text-[11px]" style={{ color: WM_BLUE }}>
                          See product <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => copyLink(d)}
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
                      <button onClick={() => generatePost(d)} disabled={gen}
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
        )}
      </div>
    </div>
  )
}
