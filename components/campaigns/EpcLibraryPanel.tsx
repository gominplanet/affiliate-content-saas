'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EPC / Sponsored Products research library. Amazon's "Creator Connections Check
// → Sponsored Products" view lists per-creator EPC opportunities (product, price,
// rating, "Estimated EPC: Up to $X", "Budget availability score") with no export.
// SCOUT scrapes the open tab; the app saves each row into a GROWING per-user
// library the creator can search + sort. Scan again anytime to refresh + add.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Radar, Loader2, Search, ExternalLink, Star, Trash2, RefreshCw } from 'lucide-react'
import { scoutCreatorConnections, type ScoutError } from '@/lib/extension-frame'

interface EpcProduct {
  asin: string
  title: string | null
  brand: string | null
  image_url: string | null
  price_cents: number | null
  epc_value: number | null
  epc_display: string | null
  budget: string | null
  rating: number | null
  ends_at: string | null
  details_url: string | null
  scanned_at: string
}

const SORTS: { key: string; label: string }[] = [
  { key: 'recent', label: 'Recently scanned' },
  { key: 'epc', label: 'Highest EPC' },
  { key: 'rating', label: 'Highest rated' },
  { key: 'price_low', label: 'Lowest price' },
]

const SCAN_ERROR: Record<ScoutError, string> = {
  'not-installed': 'SCOUT isn’t connected. Install the extension, then open your Creator Connections → Sponsored Products tab and scan again.',
  'no-cc-tab': 'Open your Amazon “Creator Connections Check → Sponsored Products” tab in another tab, then scan again.',
  'content-script-unreachable': 'Your Creator Connections tab needs a reload — refresh it once, then scan again.',
  'scan-failed': 'Couldn’t read the opportunities grid. Make sure you’re on the Sponsored Products view, then scan again.',
  'timeout': 'The scan ran long and timed out — a shorter opportunities list scans faster. Try again.',
}

function budgetStyle(b: string | null): { bg: string; color: string } {
  if (b === 'High') return { bg: 'rgba(52,199,89,0.14)', color: '#1f7a4d' }
  if (b === 'Medium') return { bg: 'rgba(255,204,0,0.16)', color: '#8a6d00' }
  if (b === 'Low') return { bg: 'rgba(255,59,48,0.12)', color: '#b3261e' }
  return { bg: 'var(--surface-2)', color: 'var(--text-faint)' }
}

export default function EpcLibraryPanel() {
  const [products, setProducts] = useState<EpcProduct[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recent')
  const [debug, setDebug] = useState<string | null>(null)

  const load = useCallback(async (query: string, sortKey: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      params.set('sort', sortKey)
      const res = await fetch(`/api/epc/list?${params.toString()}`)
      const data = await res.json()
      setProducts(Array.isArray(data.products) ? data.products : [])
      setTotal(data.total ?? 0)
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial + sort change: load immediately. Search: debounce.
  useEffect(() => { void load(q, sort) }, [sort, load]) // eslint-disable-line react-hooks/exhaustive-deps
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(q, sort), 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function scan() {
    setScanning(true)
    try {
      const res = await scoutCreatorConnections()
      if (!res.ok) { toast.error(SCAN_ERROR[res.error] || 'Scan failed. Try again.'); setDebug(null); return }
      // Only Sponsored Products / EPC rows carry an epcValue — Affiliate+ campaign
      // rows don't. Keeping only EPC rows means an accidental scan on the wrong CC
      // tab saves nothing to the library instead of polluting it.
      const all = res.campaigns ?? []
      const rows = all.filter((r) => r.epcValue != null)
      // Diagnostic line — what SCOUT actually saw, so a 0 result explains itself
      // (SCOUT is invisible on Amazon now; this replaces the old on-page debug).
      const d = res.diag
      if (d) {
        setDebug(d.sponsored === false
          ? `SCOUT wasn’t on the Sponsored Products grid. It was on: ${d.url || 'unknown'}. Accept your campaigns and open the Accepted tab, then scan again.`
          : `SCOUT saw ${d.asinNodes ?? '?'} product ASINs on the page and read ${d.parsed ?? all.length} cards; ${rows.length} had an EPC value.`)
      } else {
        setDebug(null)
      }
      if (!rows.length) {
        toast.error(all.length
          ? 'That tab isn’t the Sponsored Products view (no EPC found). Switch to your Sponsored Products for Creators tab, then scan again.'
          : 'No opportunities found. On Amazon, accept your Sponsored Products campaigns (“Accept all”), open the Accepted tab so the products show, then scan again.')
        return
      }
      const save = await fetch('/api/epc/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: rows }),
      })
      const saved = await save.json()
      if (!save.ok || !saved.ok) { toast.error(saved.error || 'Could not save the scan.'); return }
      toast.success(`Saved ${saved.saved} EPC opportunit${saved.saved === 1 ? 'y' : 'ies'} to your library.`)
      await load(q, sort)
    } catch {
      toast.error('Scan failed unexpectedly. Reload and try again.')
    } finally {
      setScanning(false)
    }
  }

  async function remove(asin: string) {
    setProducts((prev) => prev.filter((p) => p.asin !== asin))
    setTotal((t) => Math.max(0, t - 1))
    try { await fetch(`/api/epc/list?asin=${asin}`, { method: 'DELETE' }) } catch { /* optimistic */ }
  }

  return (
    <div>
      {/* Header / scan */}
      <div className="card mb-5 overflow-hidden" style={{ borderWidth: 2, borderColor: 'rgba(124,58,237,0.45)', boxShadow: '0 14px 36px -16px rgba(124,58,237,0.45)' }}>
        <div className="px-4 py-3" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.10), transparent 85%)' }}>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="grid place-items-center w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" style={{ background: 'rgba(124,58,237,0.12)' }}>
              <Radar size={14} className="text-[#7C3AED]" />
            </span>
            <div className="flex-1 min-w-[240px]">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>EPC library <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· Sponsored Products opportunities</span></p>
              <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                Amazon shows your Sponsored Products EPC opportunities on the Creator Connections page but gives no export, so MVP reads them for you into a searchable library (estimated EPC, budget score, price, rating) that you build up over time.
              </p>
              <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'rgba(255,204,0,0.10)', border: '1px solid rgba(255,204,0,0.35)' }}>
                <p className="text-[12px] font-semibold" style={{ color: '#8a6d00' }}>Do this first: Accept your campaigns</p>
                <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  Amazon only lists products you&apos;ve opted into. On your <b>Sponsored Products for Creators</b> tab, use Amazon&apos;s <b>&ldquo;Accept all&rdquo;</b> (the &ldquo;Discover More Campaigns, Faster&rdquo; banner) to opt into your recommendations, then open the <b>Accepted</b> tab so the products are on screen. Only then can SCOUT read them. Come back here and hit Scan.
                </p>
              </div>
            </div>
            <button onClick={scan} disabled={scanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70 self-start" style={{ background: '#7C3AED' }}>
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {scanning ? 'Scanning…' : 'Scan my EPC opportunities'}
            </button>
          </div>
        </div>
      </div>

      {/* Scan diagnostic — what SCOUT actually saw on the last scan. */}
      {debug && (
        <div className="mb-4 rounded-lg px-3 py-2 text-[11px] flex items-start gap-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-soft)' }}>
          <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text)' }}>Scan check:</span>
          <span>{debug}</span>
        </div>
      )}

      {/* Search + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or brand…" className="input-field w-full pl-9 text-sm" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-field text-sm w-auto">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="text-[12px] ml-auto" style={{ color: 'var(--text-faint)' }}>
          {total} in library{q.trim() ? ' (filtered)' : ''}
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-faint)]"><Loader2 size={20} className="animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 px-6">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{q.trim() ? 'No matches in your library.' : 'Your EPC library is empty.'}</p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
            {q.trim() ? 'Try a different search.' : 'On Amazon, accept your Sponsored Products campaigns (“Accept all”), open the Accepted tab, then hit “Scan my EPC opportunities” to build it up.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => {
            const bs = budgetStyle(p.budget)
            return (
              <div key={p.asin} className="rounded-xl border overflow-hidden flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex gap-3 p-3">
                  {p.image_url
                    ? <img loading="lazy" decoding="async" src={p.image_url} alt="" className="w-16 h-16 rounded-lg object-contain flex-shrink-0 bg-white" />
                    : <div className="w-16 h-16 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
                  <div className="flex-1 min-w-0">
                    {p.brand && <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: '#7C3AED' }}>{p.brand}</div>}
                    <p className="text-[12.5px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{p.title || p.asin}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                      {p.price_cents != null ? `$${(p.price_cents / 100).toFixed(2)}` : ''}
                      {p.rating != null ? <> · <Star size={9} className="inline -mt-0.5" style={{ color: '#ff9500' }} /> {p.rating}</> : null}
                    </p>
                  </div>
                </div>
                <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-baseline gap-1 px-2 py-1 rounded-md text-[12px] font-bold" style={{ background: 'rgba(52,199,89,0.12)', color: '#1f7a4d' }}>
                    {p.epc_display || (p.epc_value != null ? `Up to $${p.epc_value.toFixed(2)}` : 'EPC n/a')}
                  </span>
                  {p.budget && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: bs.bg, color: bs.color }} title="Budget availability score">
                      {p.budget} budget
                    </span>
                  )}
                </div>
                <div className="mt-auto px-3 py-2 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
                  <a href={`https://www.amazon.com/dp/${p.asin}`} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--text-soft)' }} title="View on Amazon (direct)">
                    View on Amazon <ExternalLink size={11} />
                  </a>
                  <button onClick={() => remove(p.asin)} title="Remove from library"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] hover:text-[#b3261e]">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
