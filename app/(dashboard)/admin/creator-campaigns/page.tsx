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
  const fileRef = useRef<HTMLInputElement>(null)

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

  async function upload(file: File) {
    setUploading(true); setResult(null); setProgress(null)
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
          if ((commission ?? 0) <= 0) return true
          if (daysLeft !== null && daysLeft <= 0) return true
          if (!(budgetRemain > 0 && slots > 0)) return true
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
      // Single shared batchStart so the FINAL call can prune anything
      // older than this import as stale.
      const batchStart = new Date().toISOString()
      const BATCH = 2000
      let totalUpserted = 0
      const totalFailures: Array<{ start: number; end: number; error: string }> = []
      for (let i = 0; i < deduped.length; i += BATCH) {
        const slice = deduped.slice(i, i + BATCH)
        const isFinal = i + BATCH >= deduped.length
        setProgress(
          `Sending batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(deduped.length / BATCH)} ` +
          `(${i.toLocaleString()}/${deduped.length.toLocaleString()} rows)…`,
        )
        let r: Response
        try {
          r = await fetch('/api/admin/creator-campaigns/import-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: slice, batchStart, isFinal }),
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
        if (isFinal) {
          const staleNote = typeof d.stale_deleted === 'number'
            ? ` · ${d.stale_deleted.toLocaleString()} stale rows pruned`
            : (d.stale_cleanup_error ? ` · cleanup error: ${d.stale_cleanup_error}` : '')
          // canonical_count = unique products users actually search.
          // Surface it so the admin can sanity-check (e.g. 631K rows →
          // ~40K canonical = 16x dedup, sounds right).
          const canonicalNote = typeof d.canonical_count === 'number'
            ? ` · ${d.canonical_count.toLocaleString()} unique products searchable`
            : (d.canonical_error ? ` · canonical refresh error: ${d.canonical_error}` : '')
          setResult({
            ok: true,
            message:
              `Imported ${totalUpserted.toLocaleString()} of ${deduped.length.toLocaleString()} ` +
              `unique rows from ${scannedTotal.toLocaleString()} scanned${staleNote}${canonicalNote}` +
              (totalFailures.length ? ` · ${totalFailures.length} chunk(s) failed (retry to fill in)` : ''),
          })
        }
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
          <div className="text-xs text-[#86868b] mt-1">Most recent import_at</div>
        </div>
      </div>

      {/* Upload card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          Upload weekly export
        </h2>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex flex-col gap-1 list-decimal list-inside mb-4">
          <li>Go to Amazon Creator Connections → click <strong>Download all available campaigns</strong></li>
          <li>Drop the resulting .zip below — server parses every .csv inside and replaces the catalog</li>
          <li>Rows from your previous upload that aren&apos;t in this one get cleaned up automatically</li>
        </ol>

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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-primary text-sm"
        >
          {uploading
            ? <><Loader2 size={14} className="animate-spin" /> Parsing &amp; importing…</>
            : <><Upload size={14} /> Choose .zip</>}
        </button>

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
