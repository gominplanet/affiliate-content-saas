'use client'

/**
 * Admin: Creator Connections catalog manager.
 *
 * Upload the weekly Amazon Creator Connections export .zip. Server-side
 * parser populates the shared catalog table. All users then see the
 * imported campaigns on their /campaigns page without having to upload
 * the zip themselves.
 *
 * Admin-only — the route gates on integrations.tier === 'admin'. This
 * page just throws up a friendly error if a non-admin lands here.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import PageHero from '@/components/layout/PageHero'
import { Upload, Loader2, CheckCircle2, AlertCircle, Database, Clock } from 'lucide-react'

interface Stats {
  total: number
  actionable: number
  most_recent_import: string | null
}

/** Coerce ANY thrown value or server-returned error shape into a readable
 *  string. Plain `String(x)` on `{message: "..."}` gives "[object Object]",
 *  which was leaking into the UI when the API returned a structured error
 *  payload that the client then passed straight into `new Error(...)`. This
 *  walks the common shapes (string, Error, {message}, {error}, nested) and
 *  falls back to JSON.stringify for truly weird values so the user always
 *  sees actual text, never "[object Object]". */
function toErrorString(x: unknown): string {
  if (x == null) return 'Unknown error'
  if (typeof x === 'string') return x
  if (x instanceof Error) return x.message || x.name || 'Error'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = x as any
  if (typeof o.message === 'string') return o.message
  if (typeof o.error === 'string') return o.error
  if (o.error && typeof o.error === 'object') return toErrorString(o.error)
  if (typeof o.statusText === 'string') return o.statusText
  try { return JSON.stringify(o).slice(0, 300) } catch { return 'Unrecognized error shape' }
}

export default function CreatorCampaignsAdminPage() {
  const supabase = createBrowserClient()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  // Live progress so the admin sees the import isn't hung. Updated as
  // we walk the zip + each upsert batch lands. Re-set to null between
  // runs and on completion.
  const [progress, setProgress] = useState<string | null>(null)
  // Last successful batchStart — set when an import upserts all rows but
  // the finalize step (stale-delete + canonical RPC) fails. Used by the
  // "Retry cleanup" button so the admin doesn't re-upload the zip just
  // to rerun the cleanup. Cleared on next fresh upload.
  const [lastBatchStart, setLastBatchStart] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // ── Import filters ────────────────────────────────────────────────────
  // The Amazon Creator Connections weekly export ships ~600k rows, most
  // of them not worth a blog post (low commission, short runway, dying
  // budget). Filtering at PARSE TIME (in the browser, before anything
  // hits the server) keeps the catalog small + the DB IO low. Defaults
  // are the "aggressive" preset — admins can loosen them per upload.
  //
  // Last-used values are saved to localStorage so the admin doesn't
  // re-type them every week.
  const [minCommission, setMinCommission] = useState(15)
  const [minDaysLeft, setMinDaysLeft] = useState(90)
  const [minBudget, setMinBudget] = useState(1000)
  // What thresholds the CURRENT catalog was actually imported with.
  // Distinct from the input state above — those are what the user is
  // about to type for the NEXT upload. Persisted on successful import
  // so the stats card can say "this catalog used 120% / 120d / $1000"
  // instead of leaving the admin guessing.
  const [lastAppliedFilters, setLastAppliedFilters] = useState<{
    minCommission: number
    minDaysLeft: number
    minBudget: number
    importedAt: string
  } | null>(null)
  // Load saved filter values once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = window.localStorage.getItem('mvp-cc-import-filters')
      if (!saved) return
      const v = JSON.parse(saved) as { minCommission?: number; minDaysLeft?: number; minBudget?: number }
      if (typeof v.minCommission === 'number') setMinCommission(v.minCommission)
      if (typeof v.minDaysLeft === 'number') setMinDaysLeft(v.minDaysLeft)
      if (typeof v.minBudget === 'number') setMinBudget(v.minBudget)
    } catch { /* corrupt JSON / no storage — ignore */ }
    try {
      const last = window.localStorage.getItem('mvp-cc-last-applied')
      if (last) setLastAppliedFilters(JSON.parse(last))
    } catch { /* corrupt JSON / no storage — ignore */ }
  }, [])
  // Persist on each change. Cheap, no debounce needed (3 number inputs).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem('mvp-cc-import-filters', JSON.stringify({
        minCommission, minDaysLeft, minBudget,
      }))
    } catch { /* quota / disabled — non-fatal */ }
  }, [minCommission, minDaysLeft, minBudget])

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/creator-campaigns/status')
      const d = await r.json()
      if (r.ok) setStats(d as Stats)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setIsAdmin(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
        setIsAdmin(data?.tier === 'admin')
        if (data?.tier === 'admin') loadStats()
      } catch { setIsAdmin(false) }
    })()
  }, [supabase, loadStats])

  // ── Finalize helper: stale-delete + canonical recompute ────────────────
  // Called automatically at the end of upload(), or manually via the
  // "Retry cleanup" button when the previous finalize step timed out
  // (typically with 600K+ catalogs).
  async function runFinalize(batchStart: string): Promise<{
    ok?: boolean
    error?: string
    stale_deleted?: number | null
    stale_cleanup_error?: string | null
    canonical_count?: number | null
    canonical_error?: string | null
    timings_ms?: { stale_delete: number; canonical_rpc: number; total: number }
  }> {
    try {
      const r = await fetch('/api/admin/creator-campaigns/import-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchStart }),
      })
      const raw = await r.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let d: any
      try { d = JSON.parse(raw) } catch {
        const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
        return { error: r.ok ? `Server returned non-JSON: ${snippet}` : `Server error ${r.status}: ${snippet || 'no body'}` }
      }
      return d
    } catch (e) {
      return { error: toErrorString(e) }
    }
  }

  // "Retry cleanup" — admin clicks this when the finalize step failed
  // (504 timeout on the previous attempt). Reruns just the stale-delete
  // + canonical RPC. Idempotent — safe even if some cleanup already ran.
  async function retryFinalize() {
    if (!lastBatchStart) return
    setFinalizing(true)
    setProgress('Pruning stale rows + refreshing search index (up to ~5 min)…')
    try {
      const f = await runFinalize(lastBatchStart)
      const staleNote = typeof f.stale_deleted === 'number'
        ? `${f.stale_deleted.toLocaleString()} stale rows pruned`
        : (f.stale_cleanup_error ? `cleanup error: ${f.stale_cleanup_error}` : '')
      const canonicalNote = typeof f.canonical_count === 'number'
        ? `${f.canonical_count.toLocaleString()} unique products searchable`
        : (f.canonical_error ? `canonical refresh error: ${f.canonical_error}` : '')
      const failed = !!(f.stale_cleanup_error || f.canonical_error || f.error)
      setResult({
        ok: !failed,
        message: failed
          ? `Cleanup failed: ${f.error || f.stale_cleanup_error || f.canonical_error}`
          : `Cleanup done — ${[staleNote, canonicalNote].filter(Boolean).join(' · ')}.`,
      })
      if (!failed) setLastBatchStart(null) // clear so the Retry button disappears
      await loadStats()
    } finally {
      setFinalizing(false)
      setProgress(null)
    }
  }

  async function upload(file: File) {
    setUploading(true); setResult(null); setProgress(null); setLastBatchStart(null)
    try {
      // Architecture (2026-06-05 rewrite):
      //   - PARSE happens in the BROWSER. We dynamic-import jszip +
      //     lib/parse-csv only when the admin clicks the button, so the
      //     page bundle stays small.
      //   - UPSERT happens server-side, in BATCHES of ~2k rows. Each
      //     batch is its own HTTP call to /import-batch, well under
      //     Vercel's per-function ceiling.
      //
      // This replaces the legacy single-call /import route, which
      // parsed + upserted everything server-side and was hitting
      // FUNCTION_INVOCATION_TIMEOUT on the 436K-row weekly export
      // (~870 sequential 500-row upsert chunks > 5 min).
      setProgress('Loading parser…')
      const [{ default: JSZip }, { streamCsv }] = await Promise.all([
        import('jszip'),
        import('@/lib/parse-csv'),
      ])

      setProgress('Reading zip…')
      const zip = await JSZip.loadAsync(file)
      const csvs = Object.values(zip.files).filter(f => !f.dir && /\.csv$/i.test(f.name))
      if (csvs.length === 0) throw new Error('No .csv files found inside the zip')

      // ── Parse every CSV into a Row[] ──────────────────────────────────
      // Same shape the server's upsert expects. Filtering happens here
      // (commission > 0, days_left valid, budget+slots remaining) so we
      // don't waste bytes shipping unactionable rows to the server.
      type Row = {
        asin: string
        campaign_id: string
        campaign_name: string | null
        brand: string | null
        commission: number | null
        ends_at: string | null
        days_left: number | null
        budget_remain: number
        slots_available: number
        has_budget_and_slots: boolean
        price: number | null
      }
      const now = Date.now()
      const rows: Row[] = []
      let scannedTotal = 0
      for (let c = 0; c < csvs.length; c++) {
        const entry = csvs[c]
        setProgress(`Parsing ${c + 1}/${csvs.length} (${entry.name})…`)
        const text = await entry.async('string')
        let idx: Record<string, number> | null = null
        await streamCsv(text, (cols, i) => {
          if (i === 0) {
            idx = {}
            cols.forEach((h, k) => {
              const x = h.toLowerCase()
              if (x.includes('asin')) idx!.asin = k
              else if (x.includes('campaign name')) idx!.name = k
              else if (x.includes('campaign id')) idx!.cid = k
              else if (x.includes('brand')) idx!.brand = k
              else if (x.includes('campaign end') || x.includes('end date')) idx!.end = k
              else if (x.includes('commission')) idx!.comm = k
              else if (x.includes('remain')) idx!.budget = k
              else if (x.includes('available')) idx!.slots = k
              // Amazon's export labels the price column variously
              // ("Price", "Product Price", "Price (USD)") — settle for
              // any header that contains "price". Last-write-wins is
              // fine because the export only has one such column.
              else if (x.includes('price')) idx!.price = k
            })
            return true
          }
          if (!idx) return true
          scannedTotal++
          const asinRaw = cols[idx.asin] ?? ''
          const asin = (asinRaw.match(/[A-Z0-9]{10}/) || [])[0] || ''
          if (!asin) return true
          const campaignId = idx.cid != null ? (cols[idx.cid] ?? '').trim() : ''
          if (!campaignId) return true
          const name = (cols[idx.name] ?? '').trim() || null
          const brand = (cols[idx.brand] ?? '').trim() || null
          const comm = parseFloat((cols[idx.comm] ?? '').replace(/[^\d.]/g, ''))
          const commission = isNaN(comm) ? null : comm
          const endCell = (cols[idx.end] ?? '').trim()
          const dm = endCell.match(/(\d{4})-(\d{2})-(\d{2})/)
          let endsAt: string | null = null
          let daysLeft: number | null = null
          if (dm) {
            endsAt = `${dm[1]}-${dm[2]}-${dm[3]}`
            const endMs = Date.UTC(+dm[1], +dm[2] - 1, +dm[3])
            daysLeft = Math.floor((endMs - now) / 86400000)
          }
          const budgetRemain = parseFloat((cols[idx.budget] ?? '').replace(/[^\d.]/g, '')) || 0
          const slots = parseFloat((cols[idx.slots] ?? '').replace(/[^\d.]/g, '')) || 0
          // Price: Amazon ships either a single number ($24.99), a
          // range ("$19.99 - $29.99"), or blank. Strip currency + take
          // the first number we see — that's the lower bound when
          // it's a range, which is the conservative read (a user
          // filtering "max $25" should still see a $19.99–$29.99
          // product because it starts under $25).
          const priceCell = idx.price != null ? (cols[idx.price] ?? '') : ''
          const priceMatch = priceCell.match(/[\d]+\.?\d*/)
          const priceNum = priceMatch ? parseFloat(priceMatch[0]) : NaN
          const price = isNaN(priceNum) || priceNum <= 0 ? null : priceNum
          // Same actionable-only filter as the legacy server-side parse.
          // Apply the admin's configured filters. Each one drops the
          // row entirely (doesn't even send it to the server), so the
          // catalog stays as small as possible. Defaults (15% / 90d /
          // $1000) shrink Amazon's ~600k-row weekly export to roughly
          // 30-50k actionable rows, which is what the search RPC + the
          // canonical recompute can chew through without breaking a
          // sweat on Supabase's per-tier IO budget.
          if ((commission ?? 0) < minCommission) return true
          if (daysLeft !== null && daysLeft < minDaysLeft) return true
          // Days-left null means Amazon didn't ship an end date — keep
          // those rows (the boost might just be open-ended).
          if (budgetRemain < minBudget) return true
          if (slots <= 0) return true
          rows.push({
            asin,
            campaign_id: campaignId,
            campaign_name: name,
            brand,
            commission,
            ends_at: endsAt,
            days_left: daysLeft,
            budget_remain: budgetRemain,
            slots_available: slots,
            has_budget_and_slots: budgetRemain > 0 && slots > 0,
            price,
          })
          return true
        })
      }

      // ── Dedupe on (campaign_id, asin) so the server's onConflict
      //    upsert doesn't choke on intra-batch duplicates. Amazon's
      //    export does include them. ───────────────────────────────────
      const seen = new Set<string>()
      const deduped = rows.filter(r => {
        const key = `${r.campaign_id} ${r.asin}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      if (deduped.length === 0) {
        throw new Error(`Parsed ${scannedTotal.toLocaleString()} rows but found 0 actionable ones (commission > 0, budget + slots remaining, not expired). Check the column headers.`)
      }

      // ── Stream to the server in 2k-row batches ────────────────────────
      // 2026-06-09: stripped the `isFinal` cleanup-trigger out of the
      // batch loop. Cleanup (stale-delete + canonical RPC) now runs in
      // a dedicated /import-finalize call AFTER all batches succeed —
      // gives it its own 300s budget instead of competing with the
      // last 2k-row batch's 120s ceiling. The previous flow timed out
      // on 631K-row catalogs (FUNCTION_INVOCATION_TIMEOUT).
      const batchStart = new Date().toISOString()
      // Stash batchStart for the "Retry cleanup" button — if the
      // finalize step fails, the admin can rerun JUST that step
      // without re-uploading the whole zip.
      setLastBatchStart(batchStart)
      const BATCH = 2000
      let totalUpserted = 0
      const totalFailures: Array<{ start: number; end: number; error: string }> = []
      for (let i = 0; i < deduped.length; i += BATCH) {
        const slice = deduped.slice(i, i + BATCH)
        setProgress(
          `Sending batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(deduped.length / BATCH)} ` +
          `(${i.toLocaleString()}/${deduped.length.toLocaleString()} rows)…`,
        )
        let r: Response
        try {
          r = await fetch('/api/admin/creator-campaigns/import-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // isFinal: false on EVERY batch now — cleanup is its own call.
            body: JSON.stringify({ rows: slice, batchStart, isFinal: false }),
          })
        } catch (e) {
          throw new Error(`Network error sending batch ${i}-${i + slice.length}: ${toErrorString(e)}`)
        }
        const raw = await r.text()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let d: any
        try { d = JSON.parse(raw) } catch {
          const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
          throw new Error(r.ok ? `Server returned non-JSON: ${snippet}` : `Server error ${r.status}: ${snippet || 'no body'}`)
        }
        if (!r.ok) throw new Error(d.error ? toErrorString(d.error) : `Batch failed (${r.status})`)
        totalUpserted += d.upserted ?? 0
        if (Array.isArray(d.failed_chunks)) totalFailures.push(...d.failed_chunks)
      }

      // ── Finalize: stale-row delete + canonical recompute ──────────────
      setProgress(`Upserted ${totalUpserted.toLocaleString()} rows · Now pruning stale rows + refreshing search index (up to ~2 min)…`)
      const finalizeResult = await runFinalize(batchStart)

      const staleNote = typeof finalizeResult.stale_deleted === 'number'
        ? ` · ${finalizeResult.stale_deleted.toLocaleString()} stale rows pruned`
        : (finalizeResult.stale_cleanup_error ? ` · cleanup error: ${finalizeResult.stale_cleanup_error}` : '')
      const canonicalNote = typeof finalizeResult.canonical_count === 'number'
        ? ` · ${finalizeResult.canonical_count.toLocaleString()} unique products searchable`
        : (finalizeResult.canonical_error ? ` · canonical refresh error: ${finalizeResult.canonical_error}` : '')
      const finalizeFailed = !!(finalizeResult.stale_cleanup_error || finalizeResult.canonical_error || finalizeResult.error)
      setResult({
        ok: !finalizeFailed,
        message:
          `Imported ${totalUpserted.toLocaleString()} of ${deduped.length.toLocaleString()} ` +
          `unique rows from ${scannedTotal.toLocaleString()} scanned${staleNote}${canonicalNote}` +
          (totalFailures.length ? ` · ${totalFailures.length} chunk(s) failed (retry to fill in)` : '') +
          (finalizeFailed ? ' — click "Retry cleanup" below to finish the post-import steps.' : ''),
      })

      // Persist what filters this catalog used so the stats card can
      // show "this catalog was filtered to 120% / 120d / $1000" and the
      // admin doesn't have to guess from the input boxes (which may
      // hold values they typed AFTER the upload).
      if (!finalizeFailed) {
        const last = {
          minCommission, minDaysLeft, minBudget,
          importedAt: batchStart,
        }
        setLastAppliedFilters(last)
        try {
          window.localStorage.setItem('mvp-cc-last-applied', JSON.stringify(last))
        } catch { /* quota / disabled — non-fatal */ }
      }

      await loadStats()
    } catch (e) {
      setResult({ ok: false, message: toErrorString(e) })
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (isAdmin === null) {
    return <PageHero title="Creator Campaigns" subtitle="Loading…" />
  }
  if (!isAdmin) {
    return (
      <>
        <PageHero title="Creator Campaigns" subtitle="Admin only." />
        <div className="card p-6 text-sm text-[#6e6e73]">
          This page is restricted to admin accounts.
        </div>
      </>
    )
  }

  const lastImport = stats?.most_recent_import
    ? new Date(stats.most_recent_import).toLocaleString()
    : 'Never'

  return (
    <>
      <PageHero
        title="Creator Campaigns catalog"
        subtitle="Upload the weekly Amazon Creator Connections export here. Every user instantly searches the result on their /campaigns page — no per-user upload."
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <Database size={14} /> Total in catalog
          </div>
          <div className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {stats?.total?.toLocaleString() ?? '—'}
          </div>
          <div className="text-xs text-[#86868b] mt-1">All imported rows</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <CheckCircle2 size={14} /> Actionable
          </div>
          <div className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {stats?.actionable?.toLocaleString() ?? '—'}
          </div>
          <div className="text-xs text-[#86868b] mt-1">Budget + slots remaining</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <Clock size={14} /> Last refresh
          </div>
          <div className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
            {lastImport}
          </div>
          {lastAppliedFilters ? (
            <div className="text-xs text-[#7C3AED] mt-1 font-medium">
              Filters applied: ≥{lastAppliedFilters.minCommission}% · ≥{lastAppliedFilters.minDaysLeft}d · ≥${lastAppliedFilters.minBudget.toLocaleString()}
            </div>
          ) : (
            <div className="text-xs text-[#86868b] mt-1">Most recent import_at</div>
          )}
        </div>
      </div>

      {/* Upload card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          Upload weekly export
        </h2>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex flex-col gap-1 list-decimal list-inside mb-4">
          <li>Go to Amazon Creator Connections → click <strong>Download all available campaigns</strong></li>
          <li>Drop the resulting .zip below — the browser parses every .csv inside and replaces the catalog</li>
          <li>Rows from your previous upload that aren&apos;t in this one get cleaned up automatically</li>
        </ol>

        {/* ── Filters block ─────────────────────────────────────────
            Pre-filter at PARSE time before anything hits the DB. Three
            knobs are enough — commission floor, days-left runway, and
            budget-remaining health. The "Aggressive" preset is the
            recommended weekly default; it shrinks Amazon's ~600k-row
            export to ~30-50k actionable rows. Last-used values persist
            via localStorage so it's set-once-and-forget.

            Why filter at parse time vs server-side: every row that
            survives the filter writes to 7 indexes on the catalog
            table — IO that Supabase's per-tier budget cares about.
            Cutting 90% at the browser keeps the DB happy. */}
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/[0.02] p-4 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Filters</p>
            <div className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => { setMinCommission(15); setMinDaysLeft(90); setMinBudget(1000) }}
                className="px-2 py-1 rounded border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-100 dark:hover:bg-white/5"
                title="Aggressive: 15% / 90d / $1000 — recommended"
              >
                Aggressive
              </button>
              <button
                type="button"
                onClick={() => { setMinCommission(10); setMinDaysLeft(60); setMinBudget(0) }}
                className="px-2 py-1 rounded border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-100 dark:hover:bg-white/5"
                title="Moderate: 10% / 60d / $0"
              >
                Moderate
              </button>
              <button
                type="button"
                onClick={() => { setMinCommission(5); setMinDaysLeft(30); setMinBudget(0) }}
                className="px-2 py-1 rounded border border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:bg-gray-100 dark:hover:bg-white/5"
                title="Light: 5% / 30d / $0"
              >
                Light
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
              Min commission %
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={Number.isFinite(minCommission) ? minCommission : ''}
                onChange={e => setMinCommission(parseFloat(e.target.value) || 0)}
                disabled={uploading}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
              Min days left
              <input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(minDaysLeft) ? minDaysLeft : ''}
                onChange={e => setMinDaysLeft(parseFloat(e.target.value) || 0)}
                disabled={uploading}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
              Min budget remaining ($)
              <input
                type="number"
                min={0}
                step={100}
                value={Number.isFinite(minBudget) ? minBudget : ''}
                onChange={e => setMinBudget(parseFloat(e.target.value) || 0)}
                disabled={uploading}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </label>
          </div>
          <p className="mt-3 text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
            Current filters: <strong>≥{minCommission}% commission · ≥{minDaysLeft} days runway · ≥${minBudget.toLocaleString()} budget remaining</strong>. Amazon&apos;s weekly export ships ~600k rows; these cut it to ~30-50k high-quality ones, which keeps the catalog fast + Supabase IO healthy. Settings persist between uploads.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          disabled={uploading}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) upload(f)
          }}
          className="hidden"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || finalizing}
            className="btn-primary text-sm"
          >
            {uploading
              ? <><Loader2 size={14} className="animate-spin" /> Parsing &amp; importing…</>
              : <><Upload size={14} /> Choose .zip</>}
          </button>

          {/* "Retry cleanup" — visible only when the previous import upserted
              all rows but the finalize step (stale-delete + canonical RPC)
              failed. Lets the admin rerun JUST that step without re-uploading
              the zip. Idempotent on the server side. */}
          {lastBatchStart && !uploading && (
            <button
              type="button"
              onClick={retryFinalize}
              disabled={finalizing}
              className="text-sm font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FF9500]/40 bg-[#FF9500]/10 text-[#FF9500] hover:bg-[#FF9500]/20 disabled:opacity-60 transition-colors"
              title="Re-run the post-import cleanup (stale rows + canonical refresh) without re-uploading the zip"
            >
              {finalizing
                ? <><Loader2 size={14} className="animate-spin" /> Running cleanup…</>
                : <>↻ Retry cleanup</>}
            </button>
          )}
        </div>

        {progress && uploading && (
          <div className="mt-4 flex items-start gap-2 text-sm text-[#86868b]">
            <Loader2 size={14} className="flex-shrink-0 mt-0.5 animate-spin" />
            <span>{progress}</span>
          </div>
        )}
        {result && (
          <div className={`mt-4 flex items-start gap-2 text-sm ${result.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
            {result.ok
              ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              : <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </>
  )
}
