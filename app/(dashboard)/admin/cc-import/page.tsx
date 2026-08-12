'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Admin: weekly Creator Connections catalog import. The heavy CSV is loaded into
// the STAGING table by your existing process (or SQL COPY / dashboard import),
// then this page MERGES it into the live catalog — upserting campaign economics
// while PRESERVING the enriched product signals, and purging fallen-out
// campaigns. No CSV bytes pass through this page, so file size is irrelevant here.

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, Database, ArrowRight, CheckCircle2, AlertTriangle, Tag } from 'lucide-react'
import { toast } from 'sonner'
import CcCatalogUploader from '@/components/admin/CcCatalogUploader'

interface KeepaStatus { tokensLeft: number | null; refillRate: number | null; refillIn: number | null }
interface Counts { staged: number | null; live: number | null; enriched: number | null; enrichable: number | null; hasStaged: boolean | null; keepa: KeepaStatus | null }

export default function AdminCcImportPage() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [result, setResult] = useState<{ upserted: number; purged: number; staged: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [probeQ, setProbeQ] = useState('solar')
  const [probing, setProbing] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [probeRows, setProbeRows] = useState<any[] | null>(null)
  const [covQ, setCovQ] = useState('humidifier')
  const [covLoading, setCovLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [covData, setCovData] = useState<any | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillFilled, setBackfillFilled] = useState<number | null>(null)
  const [backfillDone, setBackfillDone] = useState(false)
  // Server-side background drain (cron): status + start/stop.
  const [drain, setDrain] = useState<{ active: boolean; phase?: string; upserted?: number; purged?: number } | null>(null)
  const [bgStarting, setBgStarting] = useState(false)

  const loadCounts = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/admin/import-cc-catalog')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to load')
      setCounts({ staged: d.staged, live: d.live, enriched: d.enriched, enrichable: d.enrichable ?? null, hasStaged: d.hasStaged ?? null, keepa: d.keepa ?? null })
      setDrain(d.drain ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadCounts() }, [loadCounts])

  // While a background drain is running, poll the counts so the page reflects
  // progress live (the cron does the actual work — the tab can be closed).
  useEffect(() => {
    if (!drain?.active) return
    const t = setInterval(loadCounts, 5000)
    return () => clearInterval(t)
  }, [drain?.active, loadCounts])

  // Kick off (or stop) the server-side drain. Same partial-upload confirm guard
  // as the foreground merge.
  const startBackground = useCallback(async () => {
    if (bgStarting) return
    setBgStarting(true); setErr(null)
    try {
      let confirm = false
      for (let i = 0; i < 2; i++) {
        const r = await fetch('/api/admin/import-cc-catalog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'background', confirm }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.status === 409 && d?.needsConfirm) {
          const ok = window.confirm(`${d.error}\n\nMerge anyway and remove ~${Number(d.wouldPurgeApprox).toLocaleString()} campaigns?`)
          if (!ok) break
          confirm = true; continue
        }
        if (!r.ok) throw new Error(d.error || 'Could not start the background merge.')
        break
      }
      await loadCounts()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the background merge.')
    } finally { setBgStarting(false) }
  }, [bgStarting, loadCounts])

  const stopBackground = useCallback(async () => {
    try {
      await fetch('/api/admin/import-cc-catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stop-background' }) })
    } catch { /* best-effort */ }
    await loadCounts()
  }, [loadCounts])

  const merge = useCallback(async () => {
    if (merging) return
    setMerging(true); setResult(null); setErr(null); setRemaining(null)
    let confirm = false
    let totalUpserted = 0
    // Cursor for the single-pass purge (migration 220). Starts '' and the server
    // hands back the next position each resume; we send it straight back so the
    // purge walks the catalog once instead of re-scanning from the top.
    let purgeAfter = ''
    // Self-driving loop: the endpoint does a bounded, RESUMABLE chunk per call
    // and reports done:false + remaining while work is left. We keep calling
    // until done — and on a transient hiccup (a network blip, a chunk that timed
    // out, a no-progress cycle) we wait and retry the SAME resumable call instead
    // of stopping. So the admin clicks Merge ONCE and it grinds a full import to
    // completion, on this page, no matter how large — no re-clicking, no SQL.
    // Only a real, non-resumable error (auth, empty staging, a missing DB
    // function) or many stalls in a row surfaces as a failure.
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
    let stalls = 0
    const MAX_STALLS = 40 // ~consecutive no-progress calls before giving up
    try {
      // 100k is a runaway backstop, not a real limit — a normal import ends via
      // done:true long before this.
      for (let guard = 0; guard < 100_000; guard++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let d: any = {}
        try {
          const r = await fetch('/api/admin/import-cc-catalog', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm, purgeAfter }),
          })
          d = await r.json().catch(() => ({}))
          // Safety prompt: staging far smaller than live — likely a partial upload.
          if (r.status === 409 && d?.needsConfirm) {
            const ok = window.confirm(`${d.error}\n\nMerge anyway and remove ~${Number(d.wouldPurgeApprox).toLocaleString()} campaigns?`)
            if (!ok) { setMerging(false); return }
            confirm = true
            continue
          }
          // 4xx (not 409) = a real, non-resumable problem: auth, empty staging, or
          // a missing migration. Surface it and stop.
          if (r.status >= 400 && r.status < 500) {
            throw new Error(d.detail ? `${d.error || 'Merge failed'} — ${d.detail}` : (d.error || 'Merge failed'))
          }
          // 5xx now only happens for a missing DB function (non-resumable). Everything
          // else the endpoint reports as done:false so we just resume.
          if (!r.ok) {
            throw new Error(d.detail ? `${d.error || 'Merge failed'} — ${d.detail}` : (d.error || 'Merge failed'))
          }
        } catch (netErr) {
          // Network blip (fetch threw) — back off and retry the resumable call.
          stalls++
          if (stalls > MAX_STALLS) throw netErr instanceof Error ? netErr : new Error('Merge failed')
          await sleep(Math.min(8000, 1500 * stalls))
          continue
        }
        confirm = true
        // Carry the purge cursor forward so the next call resumes the single-pass
        // walk instead of restarting it.
        if (typeof d.purgeAfter === 'string') purgeAfter = d.purgeAfter
        const did = Number(d.upserted ?? 0)
        totalUpserted += did
        if (d.done) {
          setRemaining(null)
          setResult({ upserted: totalUpserted, purged: Number(d.purged ?? 0), staged: Number(d.staged ?? 0) })
          toast.success(`Merged ${totalUpserted.toLocaleString()} campaigns · purged ${Number(d.purged ?? 0).toLocaleString()}`)
          if (d.warning) toast.warning(String(d.warning), { duration: 12_000 })
          void loadCounts()
          return
        }
        // Progress? Merging rows, or purging (upsert phase already drained), both count.
        const madeProgress = did > 0 || Number(d.purged ?? 0) > 0 || d.purging === true
        stalls = madeProgress ? 0 : stalls + 1
        if (stalls > MAX_STALLS) throw new Error('Merge isn’t making progress — check the database, then click Merge again.')
        setRemaining(d.remaining == null ? null : Number(d.remaining)) // null → "Merging…"
        if (!madeProgress) await sleep(2000) // a no-progress cycle: back off before retrying
      }
      throw new Error('Merge hit the safety cap — click Merge again to continue.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Merge failed'
      setErr(msg); toast.error(msg)
    } finally { setMerging(false) }
  }, [merging, loadCounts])

  const probe = useCallback(async () => {
    if (probing) return
    setProbing(true); setProbeRows(null); setErr(null)
    try {
      const r = await fetch(`/api/admin/keepa-price-probe?q=${encodeURIComponent(probeQ.trim())}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Probe failed')
      setProbeRows(d.results || [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Probe failed'
      setErr(msg); toast.error(msg)
    } finally { setProbing(false) }
  }, [probing, probeQ])

  const backfillAsins = useCallback(async () => {
    if (backfilling) return
    if (!window.confirm('Backfill ASINs from campaign names for every catalog row that has none?\n\nThis fills asins (and rep_asin) from the B0-ASIN in the campaign name, so those campaigns show in Browse and can be enriched. Paced in small batches; no Keepa tokens spent.')) return
    setBackfilling(true); setBackfillDone(false); setBackfillFilled(null); setErr(null)
    let after: string | undefined
    let total = 0
    try {
      for (let guard = 0; guard < 800; guard++) {
        const r = await fetch('/api/admin/backfill-cc-asins', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ after }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.detail ? `${d.error || 'Backfill failed'} — ${d.detail}` : (d.error || 'Backfill failed'))
        after = d.after
        total += Number(d.filled ?? 0)
        setBackfillFilled(total)
        if (d.done) {
          setBackfillDone(true)
          toast.success(`Backfilled ${total.toLocaleString()} ASINs`)
          void loadCounts()
          return
        }
      }
      throw new Error('Backfill is taking unusually long — click again to continue.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Backfill failed'
      setErr(msg); toast.error(msg)
    } finally { setBackfilling(false) }
  }, [backfilling, loadCounts])

  const runCoverage = useCallback(async () => {
    if (covLoading) return
    setCovLoading(true); setCovData(null); setErr(null)
    try {
      const r = await fetch(`/api/admin/catalog-coverage?q=${encodeURIComponent(covQ.trim())}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Coverage check failed')
      setCovData(d)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Coverage check failed'
      setErr(msg); toast.error(msg)
    } finally { setCovLoading(false) }
  }, [covLoading, covQ])

  // While counts are still loading, show a dash, never a bare "0" — a transient
  // zero on the Live Catalog card reads like the whole shared catalog was wiped
  // and is genuinely alarming. Only show a real number once loaded.
  // The card numbers are Postgres ESTIMATES (exact COUNTs over ~800k rows time
  // out), kept fresh by frequent autovacuum ANALYZE (migration 229). Prefix with
  // "≈" so a small lag never reads as "stuck".
  const approx = (n: number | null | undefined) => (loading || n == null ? '—' : `≈ ${n.toLocaleString()}`)
  // "Can I merge?" and "is staging empty?" come from the cheap existence check
  // (hasStaged), NOT the exact staged count — that count can time out on a huge
  // table and come back null, which must NOT read as empty. Only a definitive
  // hasStaged === false disables merge / shows the empty warning; null (unknown)
  // stays enabled (the merge endpoint re-checks existence before doing anything).
  const stagingEmpty = counts?.hasStaged === false
  const canMerge = !loading && !stagingEmpty
  // Honest coverage = enriched / ENRICHABLE (live + has a rep ASIN), not
  // enriched / all rows: ended + ASIN-less campaigns are never enriched by
  // design, so dividing by the whole catalog understates real coverage. Falls
  // back to /live only if the enrichable count is unavailable.
  const enrichDenom = counts?.enrichable ?? counts?.live ?? null
  const enrichedPct = enrichDenom && counts?.enriched != null && enrichDenom > 0
    ? Math.round((counts.enriched / enrichDenom) * 100) : null

  return (
    <>
      <PageHero
        title="CC Catalog Import"
        subtitle="Merge the weekly Creator Connections CSV into the live catalog, safely : campaign economics update, enriched product signals are preserved, and campaigns that fell out of the CSV are purged."
      />

      {/* Steps */}
      <div className="card p-5 mb-5">
        <p className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text)' }}>Weekly steps</p>
        <ol className="text-[13px] leading-relaxed list-decimal pl-5 space-y-1.5" style={{ color: 'var(--text-soft)' }}>
          <li><b>Drag your CSV file(s)</b> into the upload box below and click <b>Upload to staging</b>. Multiple files are fine : they combine automatically.</li>
          <li>Confirm the <b>Staged</b> count looks right (tens of thousands).</li>
          <li>Click <b>Merge into live catalog</b>. Enriched images/sales/ratings survive; campaigns that fell out are purged.</li>
        </ol>
        <div className="mt-3 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: 'var(--text)' }}>
          <b>Upload the COMPLETE current catalog every week, not just the new opportunities.</b> The merge replaces the catalog: whatever is in your CSV is kept, and every campaign <i>not</i> in it is purged. Uploading only this week&rsquo;s new ones would delete last week&rsquo;s. Re-uploading ones that already exist is safe : their enrichment is preserved.
        </div>
      </div>

      {/* Uploader — parses the CSV in the browser and streams it to staging. */}
      <CcCatalogUploader onDone={loadCounts} />

      {/* Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard label="Staged (ready to merge)" value={approx(counts?.staged)} icon={<Database size={16} />} accent="#7C3AED" />
        <StatCard label="Live catalog" value={approx(counts?.live)} icon={<CheckCircle2 size={16} />} accent="#34c759" />
        <StatCard
          label="Enriched (of enrichable)"
          value={counts?.enriched == null ? '—' : `${approx(counts.enriched)}${enrichedPct != null ? ` · ${enrichedPct}%` : ''}`}
          icon={<RefreshCw size={16} />} accent="#0a84ff"
        />
      </div>

      {/* Keepa token headroom — the shared budget that enrichment, Deal Radar,
          and the AMZ Product Finder all draw from. The enrichment cron backs off
          below ~60 so the others are never starved; this is the live readout. */}
      {counts?.keepa && counts.keepa.tokensLeft != null && (
        <div className="card p-4 mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ color: '#0a84ff' }}>
            <RefreshCw size={16} />
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Keepa tokens (shared budget)</span>
          </div>
          <div className="text-right">
            <span className="text-[18px] font-extrabold" style={{ color: counts.keepa.tokensLeft < 200 ? '#f59e0b' : 'var(--text)' }}>
              {counts.keepa.tokensLeft.toLocaleString()}
            </span>
            {counts.keepa.refillRate != null && (
              <span className="text-[12px] ml-2" style={{ color: 'var(--text-soft)' }}>+{counts.keepa.refillRate}/min</span>
            )}
          </div>
        </div>
      )}

      {stagingEmpty && !loading && (
        <div className="card p-4 mb-5 flex items-start gap-2.5" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Staging is empty : load your CSV into <code>cc_campaign_catalog_import</code> first. Merge is disabled so it can&rsquo;t purge the live catalog against an empty import.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <button
          onClick={() => merge()}
          disabled={!canMerge || merging || !!drain?.active}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#7C3AED' }}>
          {merging
            ? <><Loader2 size={16} className="animate-spin" /> Merging{remaining != null ? ` — ${remaining.toLocaleString()} left` : '…'}</>
            : <>Merge into live catalog <ArrowRight size={16} /></>}
        </button>
        {/* Background drain: kick it off and close the tab — a cron finishes it
            server-side (no throttled-tab crawl). */}
        <button
          onClick={() => startBackground()}
          disabled={!canMerge || merging || bgStarting || !!drain?.active}
          title="Kick off the merge on the server and close the tab — a cron drains it to completion, no need to keep this open."
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border disabled:opacity-50"
          style={{ borderColor: '#7C3AED', color: '#7C3AED' }}>
          {bgStarting ? <><Loader2 size={16} className="animate-spin" /> Starting…</> : <>Merge in background</>}
        </button>
        <button onClick={loadCounts} disabled={loading || merging}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-medium border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Background-drain status — the cron owns the work; the tab can be closed. */}
      {drain?.active && (
        <div className="card p-4 mb-5 flex items-start gap-2.5" style={{ borderColor: 'rgba(124,58,237,0.4)' }}>
          <Loader2 size={16} className="flex-shrink-0 mt-0.5 animate-spin" style={{ color: '#7C3AED' }} />
          <div className="flex-1">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Merging in the background{drain.phase === 'purge' ? ' — purging fall-outs' : ''}. You can close this tab.
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
              Merged <b>{Number(drain.upserted ?? 0).toLocaleString()}</b>{typeof drain.purged === 'number' && drain.purged > 0 ? ` · purged ${drain.purged.toLocaleString()}` : ''} so far. A cron continues every minute until done. Staged / Live counts above update live.
            </p>
          </div>
          <button onClick={stopBackground}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            Stop
          </button>
        </div>
      )}

      {result && (
        <div className="card p-4 mb-5" style={{ borderColor: 'rgba(52,199,89,0.4)' }}>
          <p className="text-[13px] font-semibold mb-1" style={{ color: '#1f8a3a' }}>
            <CheckCircle2 size={14} className="inline -mt-0.5 mr-1" /> Import merged
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Staged <b>{result.staged.toLocaleString()}</b> · upserted <b>{result.upserted.toLocaleString()}</b> · purged (fell out) <b>{result.purged.toLocaleString()}</b>.
            New campaigns will enrich over the next runs of the background cron; survivors kept their signals.
          </p>
        </div>
      )}

      {/* Prices self-heal to the Buy Box model — no manual requeue. On-demand
          enrichment refreshes visible rows the moment they show in a scan, and
          the paced cron works through the rest. A mass update isn't used: nulling
          the indexed verified stamp churns the GIN indexes and hit the DB
          statement timeout, so the flag-driven refresh replaces it. */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5" style={{ color: '#0a84ff' }}>
          <Tag size={16} />
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Price model (Buy Box)</span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          Prices now use the Buy Box amount (what a shopper actually pays), not the cheapest 3rd-party offer. Rows refresh to it automatically : a product self-heals the moment it appears in a scan (on-demand enrichment), and the background cron works through the rest on its paced budget. Use the probe below to check any row&rsquo;s stored price against the live Keepa fields.
        </p>
      </div>

      {/* Price probe — read-only diagnostic: stored price vs live raw Keepa
          fields (Amazon / New / Buy Box) for a keyword's top catalog rows. */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5" style={{ color: '#f59e0b' }}>
          <AlertTriangle size={16} />
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Price probe (diagnostic)</span>
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
          Type a keyword to see, for the top catalog rows, what price is <b>stored</b> vs what Keepa returns live for Amazon / New / Buy Box. It also <b>fixes those rows in place</b> to the Buy Box price (bounded to a handful, no timeout), so the stored price matches right away. The <b>Fixed</b> column shows what it wrote.
        </p>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input value={probeQ} onChange={e => setProbeQ(e.target.value)} placeholder="e.g. solar"
            className="h-9 text-[13px] rounded-lg border bg-white dark:bg-[#1c1c1e] px-3 min-w-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          <button onClick={() => probe()} disabled={probing || !probeQ.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#f59e0b' }}>
            {probing ? <><Loader2 size={15} className="animate-spin" /> Probing…</> : 'Probe & fix prices'}
          </button>
        </div>
        {probeRows && probeRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ color: 'var(--text-soft)' }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)' }} className="text-left">
                  <th className="py-1.5 pr-3 font-semibold">Campaign</th>
                  <th className="py-1.5 pr-3 font-semibold">rep ASIN</th>
                  <th className="py-1.5 pr-3 font-semibold">Stored</th>
                  <th className="py-1.5 pr-3 font-semibold">Amazon</th>
                  <th className="py-1.5 pr-3 font-semibold">New</th>
                  <th className="py-1.5 pr-3 font-semibold">Buy Box</th>
                  <th className="py-1.5 pr-3 font-semibold">BB field</th>
                  <th className="py-1.5 pr-3 font-semibold">Fixed</th>
                  <th className="py-1.5 pr-3 font-semibold">Verified</th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {probeRows.map((r: any, i: number) => {
                  const usd = (c: number | null | undefined) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`)
                  const k = r.keepa || {}
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-1.5 pr-3" style={{ color: 'var(--text)' }}>{r.campaignName}{r.brand ? ` · ${r.brand}` : ''}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.asinPriced || '—'}</td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: 'var(--text)' }}>{usd(r.storedCents)}</td>
                      <td className="py-1.5 pr-3">{usd(k.amazonCents)}</td>
                      <td className="py-1.5 pr-3">{usd(k.newCents)}</td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: '#0a84ff' }}>{usd(k.buyBoxCurrentCents)}</td>
                      <td className="py-1.5 pr-3">{usd(k.buyBoxPriceField)}</td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: r.fixedToCents != null ? '#1f8a3a' : 'var(--text-faint)' }}>{r.fixedToCents != null ? usd(r.fixedToCents) : '—'}</td>
                      <td className="py-1.5 pr-3">{r.verifiedAt ? String(r.verifiedAt).slice(0, 10) : '—'}{r.error ? ` · ${r.error}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {probeRows && probeRows.length === 0 && (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>No catalog rows matched that keyword.</p>
        )}
      </div>

      {/* Backfill ASINs — fill asins/rep_asin from the campaign name for rows
          that imported with an empty asins[] (so they show + can be enriched). */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5" style={{ color: '#7C3AED' }}>
          <Database size={16} />
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Backfill ASINs</span>
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
          Many campaigns import with an empty ASIN column even though the ASIN is right in the campaign name (e.g. <code>B0FHK9DYTC 6L Cool Mist Humidifier</code>). This pulls it out and fills <code>asins</code> / <code>rep_asin</code> so those rows show in Browse and the enrich cron can reach them. Paced, no Keepa tokens. Future imports do this automatically (migration 211).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => backfillAsins()} disabled={backfilling || loading || merging}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#7C3AED' }}>
            {backfilling
              ? <><Loader2 size={15} className="animate-spin" /> Backfilling{backfillFilled != null ? ` — ${backfillFilled.toLocaleString()}` : '…'}</>
              : <><Database size={15} /> Backfill ASINs from names</>}
          </button>
          {backfillDone && backfillFilled != null && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#1f8a3a' }}>
              <CheckCircle2 size={15} /> Filled {backfillFilled.toLocaleString()} ASINs. The enrich cron will now reach them.
            </span>
          )}
        </div>
      </div>

      {/* Catalog coverage — why does Amazon CC show 1000+ for a keyword but
          Browse shows a handful? Data gap vs search-scope gap. */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5" style={{ color: '#0a84ff' }}>
          <Database size={16} />
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Catalog coverage (diagnostic)</span>
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
          For a keyword, how many catalog rows match our name+brand search (what Browse uses) vs a plain name contains-match, plus when they were imported. Tells us if a low count is a <b>stale/partial import</b> or a <b>search-scope</b> gap (Amazon matches the product; we match the campaign name).
        </p>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input value={covQ} onChange={e => setCovQ(e.target.value)} placeholder="e.g. humidifier"
            className="h-9 text-[13px] rounded-lg border bg-white dark:bg-[#1c1c1e] px-3 min-w-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          <button onClick={() => runCoverage()} disabled={covLoading || !covQ.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#0a84ff' }}>
            {covLoading ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : 'Check coverage'}
          </button>
        </div>
        {covData && (
          <div className="text-[13px] space-y-2" style={{ color: 'var(--text-soft)' }}>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>Catalog total: <b style={{ color: 'var(--text)' }}>{covData.total?.toLocaleString?.() ?? '—'}</b></span>
              <span>Matches (Browse search): <b style={{ color: '#0a84ff' }}>{covData.ftsCount?.toLocaleString?.() ?? '—'}</b></span>
              <span>…live only: <b style={{ color: 'var(--text)' }}>{covData.ftsLiveCount?.toLocaleString?.() ?? '—'}</b></span>
              <span>Name contains &ldquo;{covData.q}&rdquo;: <b style={{ color: 'var(--text)' }}>{covData.nameIlikeCount?.toLocaleString?.() ?? '—'}</b></span>
              <span>…with a populated ASIN: <b style={{ color: covData.withAsins === 0 ? '#e11d48' : 'var(--text)' }}>{covData.withAsins?.toLocaleString?.() ?? '—'}</b></span>
              <span>Newest import: <b style={{ color: 'var(--text)' }}>{covData.latestImportedAt ? String(covData.latestImportedAt).slice(0, 10) : '—'}</b></span>
            </div>
            {Array.isArray(covData.sample) && covData.sample.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]" style={{ color: 'var(--text-soft)' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }} className="text-left">
                      <th className="py-1 pr-3 font-semibold">Campaign</th>
                      <th className="py-1 pr-3 font-semibold">Brand</th>
                      <th className="py-1 pr-3 font-semibold">Imported</th>
                      <th className="py-1 pr-3 font-semibold">Ends</th>
                      <th className="py-1 pr-3 font-semibold">ASINs</th>
                      <th className="py-1 pr-3 font-semibold">Enriched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {covData.sample.map((r: any, i: number) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="py-1 pr-3" style={{ color: 'var(--text)' }}>{r.name}</td>
                        <td className="py-1 pr-3">{r.brand || '—'}</td>
                        <td className="py-1 pr-3">{r.importedAt ? String(r.importedAt).slice(0, 10) : '—'}</td>
                        <td className="py-1 pr-3">{r.endsAt ? String(r.endsAt).slice(0, 10) : '—'}</td>
                        <td className="py-1 pr-3" style={{ color: r.asinCount === 0 ? '#e11d48' : 'var(--text-soft)' }}>{r.asinCount}</td>
                        <td className="py-1 pr-3">{r.enriched ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {err && <div className="text-[13px] mb-5" style={{ color: '#ff3b30' }}>{err}</div>}
    </>
  )
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1.5" style={{ color: accent }}>{icon}<span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>{label}</span></div>
      <p className="text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>{value}</p>
    </div>
  )
}
