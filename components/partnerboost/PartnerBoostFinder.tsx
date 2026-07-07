// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The MVP Finder for PartnerBoost — the cyan-framed hero of /partnerboost. One
// scan sweeps the brands you've JOINED across Walmart · Amazon · DTC, applies
// MVP's hidden rulebook (lib/partnerboost-rules.ts) via /api/partnerboost/finder,
// and lists the vetted, ranked picks. Each row: Generate post · Buy to review ·
// Save. The brand-by-brand browse below stays as the manual fallback.
//
// PartnerBoost exposes only price + brand commission (no rating/EPC/reviews), so
// results rank by estimated $/sale — honest to what the network provides.

'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Play, Loader2, ExternalLink, CheckCircle2, Clock, ShoppingCart, Bookmark, RefreshCw, MessageCircle, SlidersHorizontal } from 'lucide-react'
import MessageBrandFlow, { type MessageBrandTarget } from '@/components/campaigns/MessageBrandFlow'

const CYAN = '#0E7490'

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface Match {
  key: string
  name: string
  priceNum: number | null
  price: string | null
  commissionPct: number | null
  perSale: number | null
  image: string | null
  url: string
  category: string | null
  brandName: string | null
  brandId?: string | null
  brandMcid?: string | null
  network: string
  sku: string | null
  trackingUrl: string
  brandTrackingUrl: string
}
type GenState = { loading?: boolean; url?: string; editUrl?: string; draft?: boolean; error?: string }

export default function PartnerBoostFinder({ onSavedChange }: { onSavedChange?: () => void }) {
  const [mode, setMode] = useState<'focus' | 'wide'>('focus')
  const [focus, setFocus] = useState('')
  const [count, setCount] = useState<10 | 20 | 50>(20)
  const [publishLive, setPublishLive] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [gen, setGen] = useState<Record<string, GenState>>({})
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<MessageBrandTarget | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [lastKey, setLastKey] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncInfo, setSyncInfo] = useState<{ count: number; syncedAt: string | null } | null>(null)

  const scanKey = `${mode}|${focus.trim().toLowerCase()}|${count}`
  const willAppend = !!(matches && matches.length && scanKey === lastKey)

  useEffect(() => {
    fetch('/api/partnerboost/saved').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.saved)) setSaved(new Set(d.saved.map((s: { asin: string }) => s.asin)))
    }).catch(() => {})
    fetch('/api/partnerboost/sync').then(r => r.json()).then(d => {
      if (d?.ok) setSyncInfo({ count: d.count, syncedAt: d.syncedAt })
    }).catch(() => {})
  }, [])

  async function runSync() {
    setSyncing(true); setError(''); setNote('Syncing your PartnerBoost catalog — this can take a couple of minutes…')
    try {
      const res = await fetch('/api/partnerboost/sync', { method: 'POST' })
      const j = await res.json()
      if (j.needsToken) { setError('Connect your PartnerBoost API key at the top of this page first.'); return }
      if (!j.ok) { setError(j.error || 'Sync failed.'); return }
      setSyncInfo({ count: j.products, syncedAt: j.syncedAt })
      setNote(`Catalog synced — ${(j.products || 0).toLocaleString()} products across ${j.brandsSwept} of your ${j.joinedBrands} joined brands${j.timedOut ? ' (partial — re-sync to finish the rest)' : ''}. Scans are now instant.`)
      setMatches(null); setSeen(new Set()); setLastKey('') // next scan reads the fresh cache
    } catch { setError('Network error during sync.') }
    finally { setSyncing(false) }
  }

  async function runScan() {
    const append = willAppend
    setRunning(true); setError(''); setNote('')
    try {
      const exclude = Array.from(new Set(append ? Array.from(seen) : []))
      const res = await fetch('/api/partnerboost/finder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, focus, limit: count, exclude }),
      })
      const j = await res.json()
      if (j.needsToken) { setError('Connect your PartnerBoost API key at the top of this page first.'); if (!append) setMatches([]); return }
      if (!j.ok) { setError(j.error || 'Scan failed.'); if (!append) setMatches([]); return }
      const fresh: Match[] = j.matches || []
      setMatches((prev) => (append ? [...(prev || []), ...fresh] : fresh))
      setSeen((prev) => { const n = new Set(append ? prev : []); fresh.forEach((m) => n.add(m.key)); return n })
      setLastKey(scanKey)
      if (append && fresh.length === 0) {
        setNote("That's every matching pick across the brands swept. Switch to Wide or change the focus keyword to widen the net.")
      } else if (j.note) {
        setNote(j.note)
      } else if (j.source === 'cache') {
        const total = (append ? (matches?.length || 0) : 0) + fresh.length
        setNote(`${total} MVP-approved pick${total === 1 ? '' : 's'}${append ? ` (+${fresh.length} new)` : ''} · from your synced catalog (${(j.scannedProducts || 0).toLocaleString()} products${j.syncedAt ? `, synced ${timeAgo(j.syncedAt)}` : ''}).`)
      } else {
        const total = (append ? (matches?.length || 0) : 0) + fresh.length
        const brandCov = j.joinedBrands && j.joinedBrands > j.brandsSwept
          ? `${j.brandsSwept} of your ${j.joinedBrands}`
          : `${j.brandsSwept}`
        setNote(`${total} MVP-approved pick${total === 1 ? '' : 's'}${append ? ` (+${fresh.length} new)` : ''} · swept ${j.scannedProducts} products across ${brandCov} joined brand${j.brandsSwept === 1 ? '' : 's'}.`)
      }
    } catch {
      setError('Network error during scan.'); if (!append) setMatches([])
    } finally {
      setRunning(false)
    }
  }

  async function generate(m: Match) {
    setGen((g) => ({ ...g, [m.key]: { loading: true } }))
    try {
      const res = await fetch('/api/walmart/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            name: m.name, price: m.price, oldPrice: null, currency: null, description: '',
            image: m.image, url: m.url, category: m.category, brand: m.brandName,
            merchantName: m.brandName, sku: m.sku, trackingUrl: m.trackingUrl,
          },
          brandTrackingUrl: m.brandTrackingUrl, network: m.network, draft: !publishLive,
        }),
      })
      const j = await res.json()
      if (!j.ok) { setGen((g) => ({ ...g, [m.key]: { error: j.error || 'Generation failed' } })); return }
      setGen((g) => ({ ...g, [m.key]: { url: j.wordpressUrl, editUrl: j.editUrl, draft: !!j.draft } }))
    } catch {
      setGen((g) => ({ ...g, [m.key]: { error: 'Network error during generation.' } }))
    }
  }

  async function toggleSave(m: Match) {
    const isSaved = saved.has(m.key)
    setSaved((prev) => { const n = new Set(prev); if (isSaved) n.delete(m.key); else n.add(m.key); return n })
    try {
      if (isSaved) {
        await fetch(`/api/partnerboost/saved?key=${encodeURIComponent(m.key)}`, { method: 'DELETE' })
      } else {
        await fetch('/api/partnerboost/saved', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: m.key, title: m.name, brand: m.brandName, imageUrl: m.image,
            commissionPct: m.commissionPct, price: m.priceNum, network: m.network, url: m.url,
            brandTrackingUrl: m.brandTrackingUrl, trackingUrl: m.trackingUrl,
          }),
        })
      }
      onSavedChange?.()
    } catch {
      setSaved((prev) => { const n = new Set(prev); if (isSaved) n.add(m.key); else n.delete(m.key); return n })
    }
  }

  const chip = (active: boolean) => ({ background: active ? CYAN : 'transparent', color: active ? '#fff' : 'var(--text-soft)' })

  return (
    <div className="rounded-2xl overflow-hidden mb-5"
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
              One scan sweeps every brand you&rsquo;ve joined across Walmart, Amazon &amp; DTC and keeps only the products worth a review — vetted for commission, price and category, ranked by estimated earnings per sale. Products you&rsquo;ve already generated are skipped.
            </p>
            <a href="/collaborations" className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline mt-1.5" style={{ color: CYAN }}>
              <SlidersHorizontal size={11} /> Customize how your brand messages are written
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-3">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(14,116,144,0.06)' }}>
            <button onClick={() => setMode('focus')} disabled={running}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(mode === 'focus')}>MVP Focus</button>
            <button onClick={() => setMode('wide')} disabled={running}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(mode === 'wide')}>Wide</button>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(14,116,144,0.06)' }}>
            {[10, 20, 50].map((n) => (
              <button key={n} onClick={() => setCount(n as 10 | 20 | 50)} disabled={running}
                className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60" style={chip(count === n)}>{n}</button>
            ))}
          </div>
          <input value={focus} onChange={(e) => setFocus(e.target.value)} disabled={running}
            placeholder="Focus (optional) — e.g. kitchen"
            className="text-[12px] px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border focus:outline-none w-[190px] disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !running) runScan() }} />
          <button onClick={runScan} disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70"
            style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Scanning…' : (willAppend ? 'Scan again — more' : (matches && matches.length ? 'Scan again' : 'Smart Scan'))}
          </button>
          <button onClick={runSync} disabled={syncing || running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border disabled:opacity-60"
            style={{ borderColor: 'rgba(14,116,144,0.5)', color: CYAN }}
            title="Pull your whole joined-brand catalog into MVP so scans return instantly. Takes a couple of minutes.">
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {syncing ? 'Syncing…' : 'Sync catalog'}
          </button>
          <button onClick={() => setPublishLive((v) => !v)} disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-60"
            style={{ background: publishLive ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)', color: publishLive ? '#10B981' : '#f59e0b', border: '1px solid var(--border)' }}
            title="Draft = saves to WordPress as a draft to review first. Live = publishes immediately.">
            {publishLive ? <><CheckCircle2 size={13} /> Publishing live</> : <><Clock size={13} /> Saving as draft</>}
          </button>
        </div>

        {/* Catalog sync status — the button lives in the controls row above. */}
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {syncInfo && syncInfo.count > 0
            ? <>{syncInfo.count.toLocaleString()} products cached{syncInfo.syncedAt ? ` · synced ${timeAgo(syncInfo.syncedAt)}` : ''} — scans are instant</>
            : 'Not synced yet — your first scan runs live (slower). Sync once for instant scans.'}
        </div>
      </div>

      {error && <div className="px-4 pb-3 text-[12px]" style={{ color: '#ef4444' }}>{error}</div>}
      {note && !error && <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>{note}</div>}

      {matches && matches.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10">
          {matches.map((m) => {
            const g = gen[m.key] || {}
            return (
              <div key={m.key} className="px-4 py-3 flex gap-3 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.image
                  ? <img src={m.image} alt="" className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(14,116,144,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>
                    {m.name}
                    {m.brandName ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {m.brandName}</span> : null}
                  </p>
                  <p className="text-[11px] mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center" style={{ color: 'var(--text-soft)' }}>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold" style={{ background: 'rgba(14,116,144,0.12)', color: CYAN }}>{m.network}</span>
                    {m.commissionPct != null && <span style={{ color: '#10B981', fontWeight: 600 }}>{m.commissionPct}% commission</span>}
                    {m.priceNum != null && <span>${m.priceNum}</span>}
                    {m.perSale != null && <span>≈ ${m.perSale}/sale</span>}
                    {m.url && (
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline" style={{ color: CYAN }}>
                        See product <ExternalLink size={9} />
                      </a>
                    )}
                  </p>
                  {g.error && <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{g.error}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button onClick={() => setMsg({ product: m.name, brand: m.brandName || '', asin: m.sku, commissionPct: m.commissionPct, network: 'PartnerBoost', networkUrl: m.brandId ? `https://app.partnerboost.com/partner/brands/detail?id=${m.brandId}` : 'https://app.partnerboost.com/partner/brands/all' })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
                      <MessageCircle size={11} /> Message brand
                    </button>
                    <a href={m.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white" style={{ background: '#34c759' }}>
                      <ShoppingCart size={11} /> Buy to review
                    </a>
                    <button onClick={() => toggleSave(m)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors"
                      style={saved.has(m.key) ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.10)', color: '#b26a00' } : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                      <Bookmark size={11} className={saved.has(m.key) ? 'fill-current' : ''} /> {saved.has(m.key) ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {g.url ? (
                    <a href={g.draft ? (g.editUrl || g.url) : g.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#10B981' }}>
                      <CheckCircle2 size={13} /> {g.draft ? 'View draft' : 'View post'} <ExternalLink size={11} />
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
