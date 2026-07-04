'use client'

/**
 * Product Finder — the "ViralVue but live + in MVP" flow. Enter a keyword + rules
 * (must have a carousel video, min monthly sales, how many to scan); SCOUT runs
 * the Amazon search in the user's own browser, deep-checks each result (monthly
 * sales + carousel-video position), filters by the rules, and returns the
 * winners. Each can be turned into a blog post in one click (the from-link flow).
 * Data is LIVE (read at that moment), not a cached third-party database.
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Search, Sparkles, ExternalLink, PackageSearch, MessageSquare, Radar } from 'lucide-react'
import { requestProductSearch, requestFindCampaign, requestCcMatch, type FinderProduct, type CampaignMatch } from '@/lib/extension-frame'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

export default function ProductFinderPage() {
  const [keyword, setKeyword] = useState('')
  const [minSales, setMinSales] = useState('100')
  const [mustVideo, setMustVideo] = useState(false)
  const [maxResults, setMaxResults] = useState('15')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FinderProduct[] | null>(null)
  const [meta, setMeta] = useState<{ scanned?: number; totalFound?: number } | null>(null)
  const [genning, setGenning] = useState<Record<string, 'busy' | 'done'>>({})
  const [genUrl, setGenUrl] = useState<Record<string, string>>({})
  const [msgProduct, setMsgProduct] = useState<MessageBrandCampaign | null>(null)
  const [msgChecking, setMsgChecking] = useState<string | null>(null) // asin being checked
  // Campaign status per ASIN, surfaced on the rows BEFORE Message is opened.
  // `imported` = one of the user's own Creator Connections campaigns (instant DB
  // check). `live` = the result of an on-demand SCOUT CC search for that product.
  type Imported = { detailsUrl: string; brandName: string | null; commissionPct: number | null }
  type Live = { found: boolean; detailsUrl?: string | null; brand?: string | null; commissionPct?: number | null }
  const [imported, setImported] = useState<Record<string, Imported>>({})
  const [live, setLive] = useState<Record<string, Live>>({})
  const [ccChecking, setCcChecking] = useState<string | null>(null) // asin being live-checked
  const [ccAllRunning, setCcAllRunning] = useState(false)          // "Check all CC" in progress

  // Open the Message modal for a found product. First check whether this ASIN is
  // already an imported Creator Connections campaign — if so, open in AUTO-SEND
  // mode (SCOUT delivers it on Amazon); otherwise compose+copy.
  const openMessage = useCallback(async (p: FinderProduct) => {
    // Reuse what the row already knows so the modal opens in the right mode with
    // no wait: an imported campaign, or a live check that already found one.
    const imp = imported[p.asin]
    if (imp) { setMsgProduct({ product: p.title, asin: p.asin, commissionPct: imp.commissionPct, detailsUrl: imp.detailsUrl, brandLabel: imp.brandName || '' }); return }
    const lv = live[p.asin]
    if (lv?.found && lv.detailsUrl) { setMsgProduct({ product: p.title, asin: p.asin, commissionPct: lv.commissionPct ?? null, detailsUrl: lv.detailsUrl, brandLabel: lv.brand || '' }); return }
    // Not known yet — do the single instant imported check (covers the race where
    // the batch check hasn't landed), else open in compose+copy with the in-modal
    // live search still available.
    setMsgChecking(p.asin)
    let detailsUrl = ''
    let brandLabel = ''
    let commissionPct: number | null = null
    try {
      const res = await fetch(`/api/campaigns/find-by-asin?asin=${encodeURIComponent(p.asin)}`)
      const d = await res.json().catch(() => ({}))
      if (d.found && d.detailsUrl) {
        detailsUrl = d.detailsUrl
        brandLabel = d.brandName || ''
        commissionPct = typeof d.commissionPct === 'number' ? d.commissionPct : null
      }
    } catch { /* fall back to compose+copy */ }
    setMsgChecking(null)
    setMsgProduct({ product: p.title, asin: p.asin, commissionPct, detailsUrl, brandLabel })
  }, [imported, live])

  // Batch-check which result ASINs are already the user's imported campaigns, so
  // each row can show its status before Message is opened. Best-effort.
  const checkImported = useCallback(async (products: FinderProduct[]) => {
    const asins = products.map(p => p.asin).filter(Boolean)
    if (asins.length === 0) return
    try {
      const res = await fetch('/api/campaigns/find-by-asins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asins }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.map && typeof d.map === 'object') setImported(d.map as Record<string, Imported>)
    } catch { /* rows just won't show the imported badge */ }
  }, [])

  // On-demand live "is this a Creator Connections campaign?" check for ONE row —
  // the same background SCOUT search the modal runs, but surfaced on the row so
  // the user can probe before hitting Message. Searches CC by the KEYWORD (the CC
  // grid returns cards for a keyword, not a bare ASIN) and confirms the match.
  const checkCC = useCallback(async (p: FinderProduct) => {
    setCcChecking(p.asin)
    try {
      const r = await requestFindCampaign(keyword.trim() || p.asin, p.asin)
      if (r.ok) {
        setLive(s => ({ ...s, [p.asin]: { found: !!r.found, detailsUrl: r.detailsUrl, brand: r.brand, commissionPct: r.commissionPct } }))
        if (r.found) toast.success(`It's a campaign${r.brand ? ` from ${r.brand}` : ''} — you can auto-send.`)
        else toast.message('Not a Creator Connections campaign', { description: 'You can still copy a pitch to reach the brand.' })
      } else if (r.error === 'not-installed') toast.error('Install / enable SCOUT to check Creator Connections.')
      else if (r.error === 'timeout') toast.error('The Creator Connections check timed out — try again.')
      else toast.error(`Couldn't check: ${r.error}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Check failed')
    } finally {
      setCcChecking(null)
    }
  }, [keyword])

  // "Check all CC" — ONE Creator Connections search for the keyword, matched
  // against every not-yet-known result ASIN at once (far cheaper than one search
  // per row). Fills the `live` map for all of them.
  const checkAllCC = useCallback(async () => {
    if (!results || results.length === 0) return
    const todo = results.filter(p => !imported[p.asin] && !live[p.asin]).map(p => p.asin)
    if (todo.length === 0) { toast.message('Every row already has a campaign status.'); return }
    setCcAllRunning(true)
    try {
      const r = await requestCcMatch(keyword.trim(), todo)
      if (!r.ok) {
        if (r.error === 'not-installed') toast.error('Install / enable SCOUT to check Creator Connections.')
        else if (r.error === 'timeout') toast.error('The Creator Connections scan timed out — try Check CC per row instead.')
        else toast.error(`Couldn't scan Creator Connections: ${r.error}`)
        return
      }
      const byAsin: Record<string, CampaignMatch> = {}
      for (const m of (r.matches ?? [])) byAsin[m.asin.toUpperCase()] = m
      setLive(s => {
        const next = { ...s }
        for (const asin of todo) {
          const m = byAsin[asin.toUpperCase()]
          next[asin] = m
            ? { found: true, detailsUrl: m.detailsUrl, brand: m.brand, commissionPct: m.commissionPct }
            : { found: false }
        }
        return next
      })
      const n = (r.matches ?? []).length
      toast.success(n ? `${n} of ${todo.length} are Creator Connections campaigns you can auto-send to.` : `None of the ${todo.length} checked are campaigns.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setCcAllRunning(false)
    }
  }, [results, imported, live, keyword])

  const search = useCallback(async () => {
    if (!keyword.trim()) { toast.error('Enter a keyword to search.'); return }
    setSearching(true); setResults(null); setMeta(null); setImported({}); setLive({})
    try {
      const r = await requestProductSearch(keyword.trim(), {
        minSales: parseInt(minSales, 10) || 0,
        mustVideo,
        maxResults: Math.min(25, Math.max(1, parseInt(maxResults, 10) || 15)),
      })
      if (!r.ok) {
        if (r.error === 'not-installed') toast.error('Install / enable SCOUT to use the Product Finder.')
        else if (r.error === 'amazon-blocked') toast.warning('Amazon is rate-limiting right now — wait a few minutes before scanning again (and scan fewer at a time).', { duration: 11000 })
        else if (r.error === 'no-results') { setResults([]); toast.message('No products found — try a different keyword.') }
        else if (r.error === 'timeout') toast.error('The scan timed out — try fewer results or a narrower keyword.')
        else toast.error(`Search failed: ${r.error}`)
        setResults(r.products ?? [])
        return
      }
      setResults(r.products ?? [])
      setMeta({ scanned: r.scanned, totalFound: r.totalFound })
      const n = (r.products ?? []).length
      if (r.blocked) {
        toast.warning('Amazon started rate-limiting — SCOUT stopped early to avoid a block. Wait a few minutes and scan fewer at a time.', { duration: 11000 })
      } else {
        toast.success(n ? `${n} product${n === 1 ? '' : 's'} passed your rules.` : 'No products passed your rules — loosen them and try again.')
      }
      if (n) checkImported(r.products ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [keyword, minSales, mustVideo, maxResults])

  const generate = useCallback(async (p: FinderProduct) => {
    setGenning(s => ({ ...s, [p.asin]: 'busy' }))
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: `https://www.amazon.com/dp/${p.asin}`,
          productName: p.title,
          scraped: { title: p.title, imageUrl: p.image, price: p.price },
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Generation failed.'); setGenning(s => ({ ...s, [p.asin]: 'done' })); return }
      toast.success('Post generated and published.')
      setGenning(s => ({ ...s, [p.asin]: 'done' }))
      if (d.url) setGenUrl(s => ({ ...s, [p.asin]: d.url }))
    } catch {
      toast.error('Something went wrong.')
      setGenning(s => ({ ...s, [p.asin]: 'done' }))
    }
  }, [])

  const videoBadge = (pos: FinderProduct['carouselPos']) => {
    if (pos === 'top') return <span className="text-[#34c759] font-semibold text-[11px]" title="Video in the TOP hero carousel">🎬 top</span>
    if (pos === 'bottom') return <span className="text-[#FF9500] font-semibold text-[11px]" title="Video only in the lower carousel">🎬 bottom</span>
    return <span className="text-[11px]" style={{ color: 'var(--text-faint)' }} title="No carousel video">🚫 none</span>
  }
  const fmtSales = (n: number | null) => n == null ? '—' : (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

  // The campaign status shown on each row, BEFORE Message is opened:
  //  • imported / live-found → a green "Campaign · auto-send" chip
  //  • live-checked miss     → a faint "Not a campaign" note
  //  • unknown               → a "Check CC" button (runs the live SCOUT search)
  const renderCampaign = (p: FinderProduct) => {
    const imp = imported[p.asin]
    const lv = live[p.asin]
    const isCampaign = !!imp || !!lv?.found
    if (isCampaign) {
      const brand = imp?.brandName || lv?.brand || ''
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#248a3d]"
          title={`Creator Connections campaign${brand ? ` · ${brand}` : ''} — Message will auto-send on Amazon`}>
          🎯 Campaign{imp ? '' : ' (live)'} · auto-send
        </span>
      )
    }
    if (ccChecking === p.asin) {
      return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={10} className="animate-spin" /> Checking CC…</span>
    }
    if (lv && !lv.found) {
      return <span className="text-[11px]" style={{ color: 'var(--text-faint)' }} title="No live Creator Connections campaign matched">— not a campaign</span>
    }
    return (
      <button onClick={() => checkCC(p)} disabled={!!ccChecking}
        title="Ask SCOUT (background) whether this product is a Creator Connections campaign you can auto-send to"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-50">
        <Radar size={11} /> Check CC
      </button>
    )
  }

  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputStyle = { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' } as React.CSSProperties

  return (
    <>
      <PageHero
        title="AMZ Product Finder"
        subtitle="Search Amazon by keyword + rules — SCOUT reads live sales and carousel-video data in your own browser, then you turn any winner into a post."
      />

      <div className="card p-4 mb-5 max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_150px_120px] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Keyword</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input value={keyword} onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !searching) search() }}
                placeholder="e.g. solar outdoor lights" className={inputCls + ' pl-8'} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Min sales / mo</label>
            <input type="number" min="0" value={minSales} onChange={e => setMinSales(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Deep-check</label>
            <input type="number" min="1" max="25" value={maxResults} onChange={e => setMaxResults(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <button onClick={search} disabled={searching}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors h-[38px]">
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </div>
        <label className="flex items-center gap-2 text-[13px] mt-3 cursor-pointer" style={{ color: 'var(--text)' }}>
          <input type="checkbox" checked={mustVideo} onChange={e => setMustVideo(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" />
          Only products that already have a carousel video
        </label>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          SCOUT scans the top ~100 Amazon results for your keyword, then deep-checks the first {maxResults || '15'} of them — opening each product's Amazon page in the background to read live monthly sales + video placement (~1–2 min for 15, longer for more). Data is read at that moment — not a cached database. Rows that are already <span className="font-semibold text-[#248a3d]">🎯 your campaigns</span> are flagged instantly; use <span className="font-semibold text-[#7C3AED]">Check CC</span> (or <span className="font-semibold text-[#7C3AED]">Check all CC</span>) to have SCOUT confirm which are Creator Connections campaigns you can auto-send to.
        </p>
      </div>

      {searching && (
        <div className="card p-6 max-w-4xl flex items-center gap-3 text-sm" style={{ color: 'var(--text-2)' }}>
          <Loader2 size={16} className="animate-spin" /> Scanning Amazon and deep-checking each product… this runs in the background, hang tight.
        </div>
      )}

      {!searching && results && results.length === 0 && (
        <div className="card p-8 max-w-4xl text-center" style={{ color: 'var(--text-faint)' }}>
          <PackageSearch size={28} className="mx-auto mb-2 opacity-60" />
          No products passed your rules{meta?.totalFound ? ` (scanned ${meta.scanned} of ${meta.totalFound} found)` : ''}. Loosen the min-sales or turn off the video filter.
        </div>
      )}

      {!searching && results && results.length > 0 && (
        <div className="max-w-4xl">
          <div className="flex items-center justify-between gap-3 mb-2">
            {meta
              ? <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{results.length} passed · deep-checked {meta.scanned} of {meta.totalFound} scanned</p>
              : <span />}
            {(() => {
              const uncheckable = results.filter(p => !imported[p.asin] && !live[p.asin]).length
              return (
                <button onClick={checkAllCC} disabled={ccAllRunning || uncheckable === 0}
                  title="One Creator Connections search for your keyword, matched against every row at once — flags which products you can auto-send to"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50 flex-shrink-0"
                  style={{ color: '#7C3AED', borderColor: '#d6c6fb', background: 'rgba(124,58,237,0.05)' }}>
                  {ccAllRunning ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                  {ccAllRunning ? 'Scanning Creator Connections…' : `Check all CC${uncheckable ? ` (${uncheckable})` : ''}`}
                </button>
              )
            })()}
          </div>
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            {results.map(p => (
              <div key={p.asin} className="flex items-center gap-3 p-3">
                {p.image
                  ? <img src={p.image} alt="" className="w-12 h-12 rounded object-contain flex-shrink-0" style={{ background: '#fff' }} />
                  : <div className="w-12 h-12 rounded flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{p.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline">{p.asin} <ExternalLink size={9} /></a>
                    {p.price && <span>{p.price}</span>}
                    <span title="Bought in past month">📈 {fmtSales(p.monthlySales)}/mo</span>
                    {videoBadge(p.carouselPos ?? 'none')}
                    {p.rating && <span>★ {p.rating}</span>}
                    <span aria-hidden style={{ color: 'var(--border)' }}>·</span>
                    {renderCampaign(p)}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openMessage(p)} disabled={msgChecking === p.asin}
                    title="Compose a brand-outreach pitch — auto-sends if this product is one of your Creator Connections campaigns, else copy it"
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-60"
                    style={{ color: '#7C3AED', borderColor: '#d6c6fb' }}>
                    {msgChecking === p.asin ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Message
                  </button>
                  {genUrl[p.asin]
                    ? <a href={genUrl[p.asin]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#34c759] hover:underline">View post <ExternalLink size={12} /></a>
                    : <button onClick={() => generate(p)} disabled={genning[p.asin] === 'busy'}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
                        {genning[p.asin] === 'busy' ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : <><Sparkles size={13} /> Generate post</>}
                      </button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {msgProduct && (
        <MessageBrandModal
          campaign={msgProduct}
          onClose={() => setMsgProduct(null)}
          // Live "is this a Creator Connections campaign?" lookup — only reached
          // from the modal when this product wasn't already an imported campaign.
          // Search CC by the KEYWORD (the grid returns cards for a keyword, not a
          // bare ASIN), then confirm the resolved card matches this ASIN.
          onFindCampaign={() => requestFindCampaign(keyword.trim() || msgProduct.asin, msgProduct.asin)}
        />
      )}
    </>
  )
}
