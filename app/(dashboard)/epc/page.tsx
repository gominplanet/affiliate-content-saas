'use client'

/**
 * EPC Scout — token-based cockpit for Amazon Creator Connections.
 *
 * Flow (Option A — works for every user, no fixed-extension-ID dependency):
 *   1. Install the Scout extension (download + Load-unpacked, it's not in the
 *      Web Store).
 *   2. Copy your ingest token from here.
 *   3. On a Creator Connections page, open the extension popup, paste the
 *      token, and "Scan & push" — it scrapes the page and pushes the campaigns
 *      into your queue via the token (no MVP login needed on Amazon's side).
 *   4. Back here: filter the queue by EPC / keyword / end date, pick winners,
 *      and generate posts.
 *
 * The extension only scrapes + pushes; all review/filtering/generation lives
 * here. Nav-gated to admin while testing.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, ExternalLink, CheckCircle2, Sparkles, Search, Puzzle, Download, Copy, RefreshCw, KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const CC_URL = 'https://www.amazon.com/creatorconnections/'

interface CampaignRow {
  id: string
  asin: string
  product_title: string | null
  campaign_name: string | null
  epc: string | null
  ends_at: string | null
  status: string
  blog_post_id: string | null
  wordpress_url: string | null
  product_price: string | number | null
  error_message: string | null
  created_at: string
}

// "$24.99" / "Up to $0.38" → 24.99 / 0.38
function parseDollar(s?: string | number | null): number | null {
  if (s == null) return null
  if (typeof s === 'number') return s
  const m = s.match(/\$?\s?([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  const v = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(v) ? null : v
}

function daysLeft(endsAt?: string | null): number {
  if (!endsAt || /no end date/i.test(endsAt)) return Infinity
  const t = Date.parse(endsAt)
  if (isNaN(t)) return Infinity
  return Math.ceil((t - Date.now()) / 86400_000)
}

const PENDING_STATUSES = new Set(['pending', 'queued', 'ready', 'new'])
// A row only counts as "done" when there's an actual published post. Anything
// else (pending, failed, or a stuck 'researching'/'generating' from an aborted
// run) is (re)generatable — so interrupted runs aren't orphaned.
function isLiveRow(c: { status: string; blog_post_id: string | null; wordpress_url: string | null }) {
  return c.status === 'published' || !!c.blog_post_id || !!c.wordpress_url
}

export default function EpcScoutPage() {
  const [token, setToken] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInstall, setShowInstall] = useState(false)

  // Filters (over the pushed queue)
  const [minEpc, setMinEpc] = useState(0.2)
  const [endsWithin, setEndsWithin] = useState('')
  const [keyword, setKeyword] = useState('')
  const [onlyPending, setOnlyPending] = useState(true)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [gen, setGen] = useState<Record<string, 'running' | 'done' | 'error'>>({})
  const [genErr, setGenErr] = useState<Record<string, string>>({})
  // Per-row "Fix image" state for already-published rows (repairs the CTA hero).
  const [fixing, setFixing] = useState<Record<string, boolean>>({})
  // Per-row "Remove" state (delete a campaign row + its WP post if any).
  const [removing, setRemoving] = useState<Record<string, boolean>>({})

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list')
      const d = await res.json()
      if (res.ok) setCampaigns(d.campaigns ?? [])
    } catch { /* best-effort */ }
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([
        loadList(),
        fetch('/api/campaigns/ingest-token').then(r => r.json()).then(d => setToken(d.token ?? null)).catch(() => {}),
      ])
      setLoading(false)
    })()
  }, [loadList])

  const copyToken = useCallback(() => {
    if (!token) return
    navigator.clipboard.writeText(token).then(() => toast.success('Token copied')).catch(() => toast.error('Copy failed'))
  }, [token])

  const regenToken = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/ingest-token', { method: 'POST' })
      const d = await res.json()
      if (res.ok) { setToken(d.token); toast.success('New token minted — re-paste it into the extension.') }
    } catch { toast.error('Could not regenerate token') }
  }, [])

  const filtered = useMemo(() => {
    const terms = keyword.toLowerCase().split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    const within = parseFloat(endsWithin)
    return campaigns
      .map(c => ({ ...c, epcValue: parseDollar(c.epc) }))
      .filter(c => {
        // "Not published yet" = anything without a live post — pending AND
        // failed AND stuck (so money-spent failures stay visible + retryable).
        if (onlyPending && isLiveRow(c)) return false
        // Failed/stuck rows already COST money — always surface them for retry,
        // never hide behind the EPC / end-date browse filters (the row's stored
        // EPC may be null). Keyword still applies so search stays useful.
        const needsAttention = !isLiveRow(c) && !PENDING_STATUSES.has(c.status)
        if (!needsAttention) {
          if (minEpc > 0) {
            if (c.epcValue == null) return false
            if (c.epcValue < minEpc) return false
          }
          if (!isNaN(within) && daysLeft(c.ends_at) > within) return false
        }
        if (terms.length) {
          const hay = `${c.campaign_name || ''} ${c.product_title || ''} ${c.asin}`.toLowerCase()
          if (!terms.some(t => hay.includes(t))) return false
        }
        return true
      })
      .sort((a, b) => (b.epcValue ?? -1) - (a.epcValue ?? -1))
  }, [campaigns, minEpc, endsWithin, keyword, onlyPending])

  const selectableShown = filtered.filter(c => !isLiveRow(c))
  const allShownSelected = selectableShown.length > 0 && selectableShown.every(c => selected.has(c.asin))
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allShownSelected) selectableShown.forEach(c => next.delete(c.asin))
      else selectableShown.forEach(c => next.add(c.asin))
      return next
    })
  }
  function toggle(asin: string) {
    setSelected(prev => { const n = new Set(prev); n.has(asin) ? n.delete(asin) : n.add(asin); return n })
  }

  const anyRunning = Object.values(gen).some(s => s === 'running')
  const selectedCount = selectableShown.filter(c => selected.has(c.asin)).length

  // Generate posts for a set of campaign rows, sequentially. Passes campaignId
  // so the route REUSES the pushed pending row (no duplicate insert), and keeps
  // the real failure reason per-row so a "failed" is actually diagnosable.
  const runGenerate = useCallback(async (picks: CampaignRow[]) => {
    if (!picks.length) return
    let ok = 0
    for (const c of picks) {
      setGen(g => ({ ...g, [c.asin]: 'running' }))
      setGenErr(e => { const n = { ...e }; delete n[c.asin]; return n })
      try {
        const res = await fetch('/api/campaigns/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: c.id, asin: c.asin, campaignName: c.campaign_name, epc: c.epc, endsAt: c.ends_at }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
        setGen(g => ({ ...g, [c.asin]: 'done' }))
        ok++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'generation failed'
        setGen(g => ({ ...g, [c.asin]: 'error' }))
        setGenErr(er => ({ ...er, [c.asin]: msg }))
      }
    }
    if (ok > 0) toast.success(`${ok} generated — check the Blog Post Generator.`)
    loadList()
  }, [loadList])

  // Fix the hero image on an already-published post (no Opus spend — just
  // re-builds the product hero and rewrites the CTA card image on the same post).
  const fixImage = useCallback(async (c: CampaignRow) => {
    setFixing(f => ({ ...f, [c.asin]: true }))
    try {
      const res = await fetch('/api/campaigns/refresh-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: c.id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      toast.success('Image fixed — refresh the live post to see it.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn\'t fix the image')
    } finally {
      setFixing(f => { const n = { ...f }; delete n[c.asin]; return n })
    }
  }, [])

  // Remove a campaign row (and its WP post, if one exists). Used to clean up
  // duplicate ASIN rows the scout ingested twice.
  const removeRow = useCallback(async (c: CampaignRow) => {
    const isLive = !!(c.wordpress_url || c.blog_post_id)
    const msg = isLive
      ? `Delete this campaign AND its published WordPress post?\n\n${c.product_title || c.asin}`
      : `Remove this row?\n\n${c.product_title || c.asin}`
    if (!window.confirm(msg)) return
    setRemoving(r => ({ ...r, [c.asin]: true }))
    try {
      const res = await fetch('/api/campaigns/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: c.id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      toast.success('Removed.')
      loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn\'t remove the row')
    } finally {
      setRemoving(r => { const n = { ...r }; delete n[c.asin]; return n })
    }
  }, [loadList])

  // Hard cap on a single bulk run — each generation is a full ~$0.50 AI job, so
  // "Select all → Generate" must NOT fire dozens at once (that caused a runaway
  // spend). Cap the batch and confirm the cost first.
  const MAX_BATCH = 5
  const generateSelected = useCallback(() => {
    const picks = filtered.filter(c => selected.has(c.asin) && !isLiveRow(c))
    if (!picks.length) return
    const batch = picks.slice(0, MAX_BATCH)
    const overflow = picks.length - batch.length
    const ok = window.confirm(
      `Generate ${batch.length} blog post${batch.length === 1 ? '' : 's'} now?\n\n` +
      `Each is a full AI generation (research + write + image, ~$0.50 each).` +
      (overflow > 0 ? `\n\nOnly the first ${MAX_BATCH} of ${picks.length} selected will run — repeat for the rest.` : ''),
    )
    if (ok) runGenerate(batch)
  }, [filtered, selected, runGenerate])

  return (
    <>
      <PageHero
        title="EPC Scout"
        subtitle="Scout Amazon Creator Connections with the extension, then filter by EPC, price and end date and generate posts for the winners."
      />

      {/* ── Setup: token + how to feed the queue ─────────────────────────── */}
      <div className="card p-5 mb-5">
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>Connect the Scout extension</p>
        <ol className="text-[12px] leading-relaxed list-decimal pl-5 mb-4 space-y-1" style={{ color: 'var(--text-soft)' }}>
          <li><button onClick={() => setShowInstall(s => !s)} className="text-[#7C3AED] font-medium hover:underline">Install the Scout extension</button> (it’s not in the Chrome Web Store).</li>
          <li>Copy your ingest token below.</li>
          <li>On an Amazon <a href={CC_URL} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] font-medium hover:underline inline-flex items-center gap-0.5">Creator Connections <ExternalLink size={10} /></a> opportunities page, open the extension, paste the token, and hit <span className="font-medium">Scan &amp; push</span>.</li>
          <li>Your campaigns land in the queue below — filter, pick, generate.</li>
        </ol>

        {/* Token */}
        <label className="block text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>
          <KeyRound size={11} className="inline mr-1" /> Your ingest token
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-2 rounded-lg border text-[12px] font-mono break-all flex-1 min-w-[240px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            {token ?? (loading ? 'loading…' : '—')}
          </code>
          <button onClick={copyToken} disabled={!token}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
            <Copy size={13} /> Copy
          </button>
          <button onClick={regenToken}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }} title="Mint a new token (invalidates the old one)">
            <RefreshCw size={12} /> Regenerate
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
          This token lets the extension push into <span className="font-medium">your</span> account. Keep it private; regenerate if it leaks.
        </p>

        {/* Install instructions (collapsible) */}
        {showInstall && (
          <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <p className="text-[13px] font-semibold inline-flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <Puzzle size={14} className="text-[#7C3AED]" /> Install the Scout extension
              </p>
              <a href="/mvp-cc-scout.zip" download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
                style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                <Download size={13} /> Download (.zip)
              </a>
            </div>
            <ol className="text-[12px] space-y-1.5 leading-relaxed list-decimal pl-5" style={{ color: 'var(--text-soft)' }}>
              <li><span className="font-medium">Download</span> + <span className="font-medium">unzip</span> (you’ll get an <code className="text-[11px]">mvp-cc-scout</code> folder).</li>
              <li>Open <code className="text-[11px]">chrome://extensions</code>.</li>
              <li>Turn on <span className="font-medium">Developer mode</span> (top-right).</li>
              <li>Click <span className="font-medium">Load unpacked</span> → select the <code className="text-[11px]">mvp-cc-scout</code> folder.</li>
            </ol>
            <p className="text-[11px] mt-3" style={{ color: 'var(--text-faint)' }}>
              Chrome’s “developer mode extensions” startup notice is normal for a sideloaded extension and safe to keep enabled.
            </p>
          </div>
        )}
      </div>

      {/* ── Queue: filter + generate ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Campaign queue {campaigns.length > 0 && <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· {campaigns.length} pushed</span>}
        </p>
        <button onClick={loadList} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#7C3AED] hover:underline">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {!loading && campaigns.length === 0 ? (
        <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          Nothing pushed yet. Install the extension, paste your token, and run <span className="font-medium">Scan &amp; push</span> on a Creator Connections page.
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Min EPC ($)">
                <input type="number" step="0.05" min="0" value={minEpc}
                  onChange={e => setMinEpc(parseFloat(e.target.value) || 0)}
                  className="w-24 px-2 py-1.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)' }} />
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
                <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} className="accent-[#7C3AED] w-4 h-4" />
                Not published yet
              </label>
              <span className="ml-auto text-[12px] pb-1.5" style={{ color: 'var(--text-faint)' }}>{filtered.length} match</span>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3 mb-3">
            <button onClick={toggleAll} className="text-[12px] font-semibold text-[#7C3AED] hover:underline">
              {allShownSelected ? 'Deselect all' : 'Select all shown'}
            </button>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{selectedCount} selected</span>
            <button onClick={generateSelected} disabled={selectedCount === 0 || anyRunning}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#34c759' }}>
              {anyRunning ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><Sparkles size={15} /> Generate {selectedCount || ''} selected</>}
            </button>
          </div>

          {/* Table */}
          <div className="card divide-y divide-gray-100 dark:divide-white/10">
            <div className="px-3 py-2 grid grid-cols-[28px_1fr_64px_60px_140px] gap-2 text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>
              <span /><span>Product</span><span className="text-right">EPC</span><span className="text-right">Ends</span><span className="text-center">Generate</span>
            </div>
            {filtered.map(c => {
              const dl = daysLeft(c.ends_at)
              const g = gen[c.asin]
              const live = isLiveRow(c)
              const isFail = g === 'error' || c.status === 'failed'
              const isPending = PENDING_STATUSES.has(c.status)
              // Not live, not pending, not failed = a 'researching'/'generating'
              // row from an aborted run — stuck, money spent, no post. Retryable.
              const isStuck = !live && !isPending && !isFail
              const err = genErr[c.asin] || c.error_message || (isStuck ? 'Stopped before it finished — no post was published.' : '')
              return (
                <div key={c.id} className={`px-3 py-2.5 grid grid-cols-[28px_1fr_64px_60px_140px] gap-2 items-center ${live ? 'opacity-80' : ''}`}>
                  <input type="checkbox" disabled={live} checked={selected.has(c.asin)} onChange={() => toggle(c.asin)} className="accent-[#7C3AED] w-4 h-4" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{c.campaign_name || c.product_title || c.asin}</p>
                    <a href={`https://www.amazon.com/dp/${c.asin}`} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline">
                      {c.asin} <ExternalLink size={9} />
                    </a>
                    {(isFail || isStuck) && err && (
                      <p className="text-[11px] text-[#ff3b30] mt-0.5 truncate" title={err}>⚠ {err}</p>
                    )}
                  </div>
                  <span className="text-right text-[13px] font-semibold tabular-nums" style={{ color: parseDollar(c.epc) != null ? '#34c759' : 'var(--text-faint)' }}>
                    {parseDollar(c.epc) != null ? `$${parseDollar(c.epc)!.toFixed(2)}` : '—'}
                  </span>
                  <span className="text-right text-[12px] tabular-nums" style={{ color: dl <= 7 ? '#FF9500' : 'var(--text-faint)' }}>
                    {dl === Infinity ? 'open' : `${dl}d`}
                  </span>
                  <div className="flex justify-center">
                    {g === 'running' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED]"><Loader2 size={13} className="animate-spin" /> writing…</span>
                    ) : live ? (
                      <div className="flex items-center gap-2">
                        <a href={c.wordpress_url || '/content'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#34c759] hover:underline">
                          <CheckCircle2 size={13} /> View post
                        </a>
                        <button onClick={() => fixImage(c)} disabled={!!fixing[c.asin]}
                          title="Rebuild the product image in the post's CTA card (no AI text spend)"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7C3AED] hover:underline disabled:opacity-50">
                          {fixing[c.asin] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />} Fix image
                        </button>
                        <button onClick={() => removeRow(c)} disabled={!!removing[c.asin]}
                          title="Delete this campaign + its WordPress post" aria-label="Delete this campaign"
                          className="text-[var(--text-faint)] hover:text-[#ff3b30] disabled:opacity-50">
                          {removing[c.asin] ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button onClick={() => runGenerate([c])}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-white"
                          style={{ background: (isFail || isStuck) ? '#ff3b30' : 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                          <Sparkles size={12} /> {(isFail || isStuck) ? 'Retry' : 'Generate'}
                        </button>
                        <button onClick={() => removeRow(c)} disabled={!!removing[c.asin]}
                          title="Remove this row" aria-label="Remove this row"
                          className="text-[var(--text-faint)] hover:text-[#ff3b30] disabled:opacity-50">
                          {removing[c.asin] ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                No campaigns match these filters. Loosen them — e.g. lower Min EPC or untick “Not published yet”.
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
