'use client'

/**
 * EPC Scout — the in-app cockpit for Amazon Creator Connections.
 *
 * The Scout extension (v1.6.0+) is a PURE SCRAPER: it reads the user's
 * already-open Creator Connections opportunities tab and hands back the raw
 * campaign rows. EVERYTHING else lives here — filtering by EPC / price / end
 * date / budget / keyword, review, selection, and kicking off generation.
 *
 * Flow: user opens CC (their own logged-in Amazon session) → clicks Scout →
 * we pull the raw list via the extension → they filter + pick winners → we
 * generate a post per selected campaign (existing /api/campaigns/generate).
 *
 * Currently nav-gated to admin while testing (see DashboardShellV2). No Pro
 * paywall yet — that's a one-line flip when it launches.
 */

import { useState, useMemo, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { scoutCreatorConnections, type ScoutedCampaign, type ScoutError } from '@/lib/extension-frame'
import { Loader2, Radar, ExternalLink, CheckCircle2, AlertCircle, Sparkles, Search } from 'lucide-react'
import { toast } from 'sonner'

const BUD_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }

// Structured-error → guidance copy. The extension returns one of these; we map
// each to a clear next step instead of a generic "failed".
const ERROR_COPY: Record<ScoutError, { title: string; body: string }> = {
  'not-installed': {
    title: 'Co-Pilot extension not detected',
    body: 'Install (or enable) the MVP Affiliate Co-Pilot Helper extension, then reload this page and try again.',
  },
  'no-cc-tab': {
    title: 'Open Creator Connections first',
    body: 'In another tab, sign in to Amazon and open the Creator Connections “New Opportunities” view. Leave it open, come back here, and Scout again.',
  },
  'content-script-unreachable': {
    title: 'Reload your Creator Connections tab',
    body: 'That tab was open before the latest extension update. Refresh the Creator Connections tab, then Scout again.',
  },
  'scan-failed': {
    title: 'Couldn’t read the opportunities grid',
    body: 'Make sure you’re on the Creator Connections “New Opportunities” list (not a campaign detail page), then Scout again.',
  },
  'timeout': {
    title: 'Scan timed out',
    body: 'The opportunities list was slow to load. Give it a moment to finish rendering, then Scout again.',
  },
}

// "$24.99" / "Up to $0.38" → 24.99 / 0.38
function parseDollar(s?: string | null): number | null {
  if (!s) return null
  const m = s.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  const v = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(v) ? null : v
}

// Days until a campaign ends. "No end date" / missing → Infinity (never expires).
function daysLeft(endsAt?: string | null): number {
  if (!endsAt || /no end date/i.test(endsAt)) return Infinity
  const t = Date.parse(endsAt)
  if (isNaN(t)) return Infinity
  return Math.ceil((t - Date.now()) / 86400_000)
}

export default function EpcScoutPage() {
  const [scanning, setScanning] = useState(false)
  const [raw, setRaw] = useState<ScoutedCampaign[]>([])
  const [err, setErr] = useState<ScoutError | null>(null)
  const [scannedAt, setScannedAt] = useState<number | null>(null)

  // ── Filters (all in-app — re-filtering never re-scrapes Amazon) ──────────
  const [minEpc, setMinEpc] = useState(0.2)
  const [minPrice, setMinPrice] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<string>('')
  const [endsWithin, setEndsWithin] = useState<string>('') // days; '' = any
  const [reqBudget, setReqBudget] = useState(true)
  const [keyword, setKeyword] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [gen, setGen] = useState<Record<string, 'running' | 'done' | 'error'>>({})

  const scout = useCallback(async () => {
    setScanning(true)
    setErr(null)
    const res = await scoutCreatorConnections()
    setScanning(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    // Normalise priceValue/epcValue once so filtering is cheap.
    const rows = res.campaigns.map(c => ({
      ...c,
      epcValue: c.epcValue ?? parseDollar(c.epc),
      priceValue: c.priceValue ?? parseDollar(c.price),
    }))
    setRaw(rows)
    setScannedAt(Date.now())
    setSelected(new Set())
    setGen({})
    toast.success(`Scouted ${rows.length} campaign${rows.length === 1 ? '' : 's'} from Creator Connections.`)
  }, [])

  const filtered = useMemo(() => {
    const terms = keyword.toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    const minP = parseFloat(minPrice)
    const maxP = parseFloat(maxPrice)
    const within = parseFloat(endsWithin)
    return raw
      .filter(c => {
        if (minEpc > 0) {
          if (c.epcValue == null) return false
          if (c.epcValue < minEpc) return false
        }
        if (!isNaN(minP) && (c.priceValue == null || c.priceValue < minP)) return false
        if (!isNaN(maxP) && (c.priceValue == null || c.priceValue > maxP)) return false
        if (!isNaN(within) && daysLeft(c.endsAt) > within) return false
        if (reqBudget && (BUD_RANK[(c.budget || '').toLowerCase()] || 0) < 2) return false
        if (terms.length) {
          const hay = `${c.campaignName || ''} ${c.brand || ''} ${c.asin}`.toLowerCase()
          if (!terms.some(t => hay.includes(t))) return false
        }
        return true
      })
      .sort((a, b) => (b.epcValue ?? -1) - (a.epcValue ?? -1))
  }, [raw, minEpc, minPrice, maxPrice, endsWithin, reqBudget, keyword])

  const allShownSelected = filtered.length > 0 && filtered.every(c => selected.has(c.asin))
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allShownSelected) filtered.forEach(c => next.delete(c.asin))
      else filtered.forEach(c => next.add(c.asin))
      return next
    })
  }
  function toggle(asin: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(asin) ? next.delete(asin) : next.add(asin)
      return next
    })
  }

  // Generate a post per selected campaign, sequentially (each is a heavy Opus
  // run; sequential keeps us inside per-request limits and shows clear progress).
  const generateSelected = useCallback(async () => {
    const picks = filtered.filter(c => selected.has(c.asin))
    if (!picks.length) return
    for (const c of picks) {
      setGen(g => ({ ...g, [c.asin]: 'running' }))
      try {
        const res = await fetch('/api/campaigns/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin: c.asin, campaignName: c.campaignName, epc: c.epc, endsAt: c.endsAt }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `HTTP ${res.status}`)
        }
        setGen(g => ({ ...g, [c.asin]: 'done' }))
      } catch (e) {
        setGen(g => ({ ...g, [c.asin]: 'error' }))
        toast.error(`${c.asin}: ${e instanceof Error ? e.message : 'generation failed'}`)
      }
    }
    toast.success('Done — check the Blog Post Generator for the new drafts.')
  }, [filtered, selected])

  const anyRunning = Object.values(gen).some(s => s === 'running')
  const selectedCount = filtered.filter(c => selected.has(c.asin)).length

  return (
    <>
      <PageHero
        title="EPC Scout"
        subtitle="Pull every Amazon Creator Connections opportunity, filter by EPC, price and end date, then generate posts for the winners."
      />

      {/* Scout trigger + how-it-works */}
      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Scan Creator Connections</p>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              Open Amazon Creator Connections in another tab on the <span className="font-medium">New Opportunities</span> view,
              then hit Scout. The extension reads that page in your own session — nothing is posted or changed on Amazon.
            </p>
          </div>
          <button
            onClick={scout}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex-shrink-0"
            style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}
          >
            {scanning ? <><Loader2 size={15} className="animate-spin" /> Scanning…</> : <><Radar size={15} /> Scout campaigns</>}
          </button>
        </div>

        {err && (
          <div className="mt-4 rounded-xl border p-3 flex items-start gap-2" style={{ borderColor: 'rgba(255,149,0,0.3)', backgroundColor: 'rgba(255,149,0,0.06)' }}>
            <AlertCircle size={15} className="text-[#FF9500] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{ERROR_COPY[err].title}</p>
              <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>{ERROR_COPY[err].body}</p>
            </div>
          </div>
        )}
      </div>

      {raw.length > 0 && (
        <>
          {/* Filters */}
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Min EPC ($)">
                <input type="number" step="0.05" min="0" value={minEpc}
                  onChange={e => setMinEpc(parseFloat(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
              </Field>
              <Field label="Price $ min">
                <input type="number" min="0" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="any"
                  className="w-20 px-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
              </Field>
              <Field label="Price $ max">
                <input type="number" min="0" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="any"
                  className="w-20 px-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
              </Field>
              <Field label="Ends within (days)">
                <input type="number" min="1" value={endsWithin} onChange={e => setEndsWithin(e.target.value)} placeholder="any"
                  className="w-24 px-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
              </Field>
              <Field label="Keyword">
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#86868b]" />
                  <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="cooler, kitchen…"
                    className="w-44 pl-7 pr-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
                </div>
              </Field>
              <label className="flex items-center gap-2 text-[12px] font-medium pb-1.5 cursor-pointer" style={{ color: 'var(--text-soft)' }}>
                <input type="checkbox" checked={reqBudget} onChange={e => setReqBudget(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" />
                Budget ≥ Medium
              </label>
              <span className="ml-auto text-[12px] pb-1.5" style={{ color: 'var(--text-faint)' }}>
                {filtered.length} of {raw.length} match{scannedAt ? '' : ''}
              </span>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3 mb-3">
            <button onClick={toggleAll} className="text-[12px] font-semibold text-[#7C3AED] hover:underline">
              {allShownSelected ? 'Deselect all' : 'Select all shown'}
            </button>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{selectedCount} selected</span>
            <button
              onClick={generateSelected}
              disabled={selectedCount === 0 || anyRunning}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#34c759' }}
            >
              {anyRunning ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><Sparkles size={15} /> Generate {selectedCount || ''} selected</>}
            </button>
          </div>

          {/* Results table */}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            <div className="px-3 py-2 grid grid-cols-[28px_1fr_80px_80px_90px_90px_90px] gap-2 text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>
              <span />
              <span>Product</span>
              <span className="text-right">EPC</span>
              <span className="text-right">Price</span>
              <span className="text-right">Ends</span>
              <span className="text-center">Budget</span>
              <span className="text-center">Status</span>
            </div>
            {filtered.map(c => {
              const dl = daysLeft(c.endsAt)
              const g = gen[c.asin]
              return (
                <label key={c.asin} className="px-3 py-2.5 grid grid-cols-[28px_1fr_80px_80px_90px_90px_90px] gap-2 items-center cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <input type="checkbox" checked={selected.has(c.asin)} onChange={() => toggle(c.asin)} className="accent-[#7C3AED] w-4 h-4" />
                  <div className="min-w-0 flex items-center gap-2">
                    {c.image && <img src={c.image} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{c.campaignName || c.brand || c.asin}</p>
                      <a href={`https://www.amazon.com/dp/${c.asin}`} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline" onClick={e => e.stopPropagation()}>
                        {c.asin} <ExternalLink size={9} />
                      </a>
                    </div>
                  </div>
                  <span className="text-right text-[13px] font-semibold tabular-nums" style={{ color: c.epcValue != null ? '#34c759' : 'var(--text-faint)' }}>
                    {c.epcValue != null ? `$${c.epcValue.toFixed(2)}` : '—'}
                  </span>
                  <span className="text-right text-[12px] tabular-nums" style={{ color: 'var(--text-soft)' }}>{c.price || '—'}</span>
                  <span className="text-right text-[12px] tabular-nums" style={{ color: dl <= 7 ? '#FF9500' : 'var(--text-faint)' }}>
                    {dl === Infinity ? 'open' : `${dl}d`}
                  </span>
                  <span className="text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>{c.budget || '—'}</span>
                  <span className="text-center">
                    {g === 'running' && <Loader2 size={13} className="animate-spin inline text-[#7C3AED]" />}
                    {g === 'done' && <CheckCircle2 size={14} className="inline text-[#34c759]" />}
                    {g === 'error' && <AlertCircle size={14} className="inline text-[#ff3b30]" />}
                  </span>
                </label>
              )
            })}
            {filtered.length === 0 && (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                No campaigns match these filters. Loosen them — e.g. lower the Min EPC.
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>{label}</label>
      {children}
    </div>
  )
}
