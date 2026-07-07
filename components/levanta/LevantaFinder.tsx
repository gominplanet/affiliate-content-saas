// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The MVP Finder for Levanta — the cyan-framed hero of /levanta. One "Smart
// Scan" sweeps every partnered brand's products, applies MVP's hidden rulebook
// (lib/levanta-rules.ts) via /api/levanta/finder, and lists only the vetted,
// ranked picks. Each row's single action is "Generate post" (the manual
// brand-browse below stays as the dig-into-one-brand fallback). Thresholds are
// never shown — proprietary.

'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Play, Loader2, ExternalLink, CheckCircle2, Clock, Star, ShoppingCart, Bookmark, MessageCircle, SlidersHorizontal } from 'lucide-react'
import MessageBrandFlow, { type MessageBrandTarget } from '@/components/campaigns/MessageBrandFlow'

const CYAN = '#0E7490'

interface Match {
  asin: string
  title: string
  price: number | null
  commission: number | null
  rating: number | null
  ratingsTotal: number | null
  platformEpc: number | null
  perSale: number | null
  category: string | null
  image: string | null
  brandName: string | null
  brandUrl?: string | null
  marketplace: string
}
type GenState = { loading?: boolean; url?: string; error?: string }

export default function LevantaFinder({ onSavedChange }: { onSavedChange?: () => void }) {
  const [mode, setMode] = useState<'focus' | 'wide'>('focus')
  const [focus, setFocus] = useState('')
  const [count, setCount] = useState<10 | 20 | 50>(20)
  const [publishLive, setPublishLive] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [gen, setGen] = useState<Record<string, GenState>>({})
  const [done, setDone] = useState<string[]>([]) // ASINs already generated → excluded next scan
  const [saved, setSaved] = useState<Set<string>>(new Set()) // ASINs already on the Saved shelf
  const [seen, setSeen] = useState<Set<string>>(new Set()) // every ASIN already SHOWN → paged past on re-scan
  const [lastKey, setLastKey] = useState('') // mode|focus|count of the last scan → same key = "show me more"
  const [msg, setMsg] = useState<MessageBrandTarget | null>(null)

  const scanKey = `${mode}|${focus.trim().toLowerCase()}|${count}`
  // Same search as last time AND we already have results → the next click pages
  // deeper (excludes what's shown) instead of repeating. Change any control and
  // it's a fresh search from the top.
  const willAppend = !!(matches && matches.length && scanKey === lastKey)

  // Seed the Save-button state from the shelf so already-saved picks show "Saved".
  useEffect(() => {
    fetch('/api/levanta/saved').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.saved)) setSaved(new Set(d.saved.map((s: { asin: string }) => s.asin)))
    }).catch(() => {})
  }, [])

  async function toggleSave(m: Match) {
    const isSaved = saved.has(m.asin)
    setSaved((prev) => { const n = new Set(prev); if (isSaved) n.delete(m.asin); else n.add(m.asin); return n }) // optimistic
    try {
      if (isSaved) {
        await fetch(`/api/levanta/saved?asin=${encodeURIComponent(m.asin)}`, { method: 'DELETE' })
      } else {
        await fetch('/api/levanta/saved', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asin: m.asin, title: m.title, brand: m.brandName, imageUrl: m.image,
            commissionPct: m.commission, price: m.price, rating: m.rating, marketplace: m.marketplace,
          }),
        })
      }
      onSavedChange?.()
    } catch {
      setSaved((prev) => { const n = new Set(prev); if (isSaved) n.add(m.asin); else n.delete(m.asin); return n }) // revert
    }
  }

  async function runScan() {
    const append = willAppend
    setRunning(true); setError(''); setNote('')
    try {
      // On a repeat of the same search, exclude everything already shown so the
      // sweep returns the NEXT-best batch. A fresh search only skips picks the
      // user already turned into a post (done).
      const exclude = Array.from(new Set(append ? [...done, ...seen] : done))
      const res = await fetch('/api/levanta/finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, focus, limit: count, exclude }),
      })
      const j = await res.json()
      if (j.needsToken) { setError('Connect your Levanta API key at the top of this page first.'); if (!append) setMatches([]); return }
      if (!j.ok) { setError(j.error || 'Scan failed.'); if (!append) setMatches([]); return }
      const fresh: Match[] = j.matches || []
      setMatches((prev) => (append ? [...(prev || []), ...fresh] : fresh))
      setSeen((prev) => { const n = new Set(append ? prev : []); fresh.forEach((m) => n.add(m.asin)); return n })
      setLastKey(scanKey)
      if (append && fresh.length === 0) {
        setNote("That's every matching pick across your partnered brands. Switch to Wide or change the focus keyword to widen the net.")
      } else if (j.note) {
        setNote(j.note)
      } else {
        const total = (append ? (matches?.length || 0) : 0) + fresh.length
        const brandCov = j.totalBrands && j.totalBrands > j.scannedBrands
          ? `${j.scannedBrands} of your ${j.totalBrands}`
          : `${j.scannedBrands}`
        setNote(`${total} MVP-approved pick${total === 1 ? '' : 's'}${append ? ` (+${fresh.length} new)` : ''} · swept ${j.scannedProducts} products across ${brandCov} partnered brand${j.scannedBrands === 1 ? '' : 's'}.`)
      }
    } catch {
      setError('Network error during scan.'); if (!append) setMatches([])
    } finally {
      setRunning(false)
    }
  }

  async function generate(m: Match) {
    setGen((g) => ({ ...g, [m.asin]: { loading: true } }))
    try {
      const res = await fetch('/api/levanta/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            asin: m.asin, title: m.title, image: m.image, price: m.price,
            category: m.category, brandName: m.brandName, marketplace: m.marketplace,
          },
          draft: !publishLive,
        }),
      })
      const j = await res.json()
      if (!j.ok) { setGen((g) => ({ ...g, [m.asin]: { error: j.error || 'Generation failed' } })); return }
      setGen((g) => ({ ...g, [m.asin]: { url: j.wordpressUrl } }))
      setDone((d) => (d.includes(m.asin) ? d : [...d, m.asin]))
    } catch {
      setGen((g) => ({ ...g, [m.asin]: { error: 'Network error during generation.' } }))
    }
  }

  const chip = (active: boolean) =>
    ({
      background: active ? CYAN : 'transparent',
      color: active ? '#fff' : 'var(--text-soft)',
    })

  return (
    <div
      className="rounded-2xl overflow-hidden mb-5"
      style={{ border: '2px solid rgba(14,116,144,0.45)', boxShadow: '0 14px 36px -16px rgba(14,116,144,0.45)', background: 'var(--surface)' }}>
      <div className="px-4 py-3" style={{ background: 'linear-gradient(180deg, rgba(34,211,238,0.12), transparent 85%)' }}>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="grid place-items-center w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" style={{ background: 'rgba(14,116,144,0.14)' }}>
            <Sparkles size={14} style={{ color: CYAN }} />
          </span>
          <div className="flex-1 min-w-[240px]">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              MVP Finder <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· powered by MVP&apos;s proprietary criteria</span>
            </p>
            <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
              One scan sweeps every brand you&rsquo;re partnered with on Levanta and keeps only the products worth a review — vetted for real commission, price, demand, rating and Levanta&rsquo;s own earnings-per-click, ranked best-first. Products you&rsquo;ve already generated are skipped.
            </p>
            <a href="/collaborations" className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline mt-1.5" style={{ color: CYAN }}>
              <SlidersHorizontal size={11} /> Customize how your brand messages are written
            </a>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {/* Focus / Wide */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(14,116,144,0.06)' }}>
            <button onClick={() => setMode('focus')} disabled={running}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(mode === 'focus')}>
              MVP Focus
            </button>
            <button onClick={() => setMode('wide')} disabled={running}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(mode === 'wide')}>
              Wide
            </button>
          </div>

          {/* Result count */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(14,116,144,0.06)' }}>
            {[10, 20, 50].map((n) => (
              <button key={n} onClick={() => setCount(n as 10 | 20 | 50)} disabled={running}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(count === n)}>
                {n}
              </button>
            ))}
          </div>

          <input
            value={focus} onChange={(e) => setFocus(e.target.value)} disabled={running}
            placeholder="Focus (optional) — e.g. kitchen"
            className="text-[12px] px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:outline-none w-[190px] disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) runScan() }}
          />

          <button onClick={runScan} disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70"
            style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Scanning…' : (willAppend ? 'Scan again — more' : (matches && matches.length ? 'Scan again' : 'Smart Scan'))}
          </button>

          {/* Draft / live */}
          <button onClick={() => setPublishLive((v) => !v)} disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-60"
            style={{
              background: publishLive ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)',
              color: publishLive ? '#10B981' : '#f59e0b', border: '1px solid var(--border)',
            }}
            title="Draft = saves to WordPress as a draft to review first. Live = publishes immediately.">
            {publishLive ? <><CheckCircle2 size={13} /> Publishing live</> : <><Clock size={13} /> Saving as draft</>}
          </button>
        </div>
      </div>

      {error && <div className="px-4 pb-3 text-[12px]" style={{ color: '#ef4444' }}>{error}</div>}
      {note && !error && <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>{note}</div>}

      {/* Results */}
      {matches && matches.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10">
          {matches.map((m) => {
            const g = gen[m.asin] || {}
            return (
              <div key={m.asin} className="px-4 py-3 flex gap-3 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.image
                  ? <img src={m.image} alt="" className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(14,116,144,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>
                    {m.title || m.asin}
                    {m.brandName ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {m.brandName}</span> : null}
                  </p>
                  <p className="text-[11px] mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center" style={{ color: 'var(--text-soft)' }}>
                    {m.commission != null && <span style={{ color: '#10B981', fontWeight: 600 }}>{m.commission}% commission</span>}
                    {m.price != null && <span>${m.price}</span>}
                    {m.platformEpc != null && <span title="Levanta's modeled earnings per click" style={{ color: CYAN, fontWeight: 600 }}>~${m.platformEpc.toFixed(2)}/click</span>}
                    {m.perSale != null && <span>≈ ${m.perSale}/sale</span>}
                    {m.rating != null && <span className="inline-flex items-center gap-0.5"><Star size={10} className="fill-current" style={{ color: '#f59e0b' }} /> {m.rating}{m.ratingsTotal ? ` · ${m.ratingsTotal.toLocaleString()}` : ''}</span>}
                    <a href={`https://www.${m.marketplace}/dp/${m.asin}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 hover:underline" style={{ color: CYAN }}>
                      {m.asin} <ExternalLink size={9} />
                    </a>
                  </p>
                  {g.error && <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{g.error}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button onClick={() => setMsg({ product: m.title || m.asin, brand: m.brandName || '', asin: m.asin, commissionPct: m.commission, network: 'Levanta', networkUrl: `https://app.levanta.io/creator/partners?filters=${encodeURIComponent(JSON.stringify({ search: m.brandName || '', marketplaces: [], amazonCategoryIds: [] }))}` })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
                      <MessageCircle size={11} /> Message brand
                    </button>
                    <a href={`https://www.${m.marketplace}/dp/${m.asin}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white" style={{ background: '#34c759' }}>
                      <ShoppingCart size={11} /> Buy to review
                    </a>
                    <button onClick={() => toggleSave(m)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors"
                      style={saved.has(m.asin)
                        ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.10)', color: '#b26a00' }
                        : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                      <Bookmark size={11} className={saved.has(m.asin) ? 'fill-current' : ''} /> {saved.has(m.asin) ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {g.url ? (
                    <a href={g.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#10B981' }}>
                      <CheckCircle2 size={13} /> View post <ExternalLink size={11} />
                    </a>
                  ) : (
                    <button onClick={() => generate(m)} disabled={g.loading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
                      {g.loading ? <><Loader2 size={12} className="animate-spin" /> Generating…</> : <><Sparkles size={12} /> Generate post</>}
                    </button>
                  )}
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
