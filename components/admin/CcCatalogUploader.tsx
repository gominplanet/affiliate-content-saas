'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drag-and-drop CSV uploader for the weekly CC campaign catalog. Parses the
// (large, multi-file) CSVs entirely in the browser with a streaming parser and
// sends them to the staging table in small batches — so a 350MB import never
// travels as one giant request. Auto-maps columns from the header (with manual
// override), then the admin clicks Merge (separate button) to go live.

import { useCallback, useRef, useState } from 'react'
import Papa from 'papaparse'
import { UploadCloud, FileSpreadsheet, Loader2, CheckCircle2, X } from 'lucide-react'
import { toast } from 'sonner'

// Staging columns we can fill. Required ones can't be left unmapped.
const FIELDS = [
  { key: 'campaign_id', label: 'Campaign ID', required: true },
  { key: 'campaign_name', label: 'Campaign name', required: true },
  { key: 'ends_at', label: 'End date', required: true },
  { key: 'commission_pct', label: 'Commission %', required: true },
  { key: 'asins', label: 'ASIN(s)', required: false },
  { key: 'brand_name', label: 'Brand', required: false },
  { key: 'starts_at', label: 'Start date', required: false },
  { key: 'budget', label: 'Budget', required: false },
  { key: 'budget_remaining', label: 'Budget remaining', required: false },
  { key: 'available_slot', label: 'Open slots', required: false },
  { key: 'total_slot', label: 'Total slots', required: false },
] as const
type FieldKey = typeof FIELDS[number]['key']

// Guess which CSV header feeds each field.
const GUESS: Record<FieldKey, RegExp> = {
  campaign_id: /campaign.?id|^id$|opportunity.?id/i,
  campaign_name: /campaign.?name|opportunity.?name|^name$|title/i,
  ends_at: /end.?date|end$|expir|to.?date/i,
  commission_pct: /commission|payout|rate|percent/i,
  asins: /asin|product.?id/i,
  brand_name: /brand|advertiser|seller|vendor/i,
  starts_at: /start.?date|start$|from.?date|begin/i,
  budget: /^budget$|total.?budget|budget.?amount/i,
  budget_remaining: /remain|budget.?left/i,
  available_slot: /avail|open.?slot|slots.?open|remaining.?slot/i,
  total_slot: /total.?slot|slot.?total|max.?slot|^slots$/i,
}

const BATCH = 1000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export default function CcCatalogUploader({ onDone }: { onDone?: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({})
  const [phase, setPhase] = useState<'idle' | 'ready' | 'uploading' | 'done' | 'error'>('idle')
  const [pct, setPct] = useState(0)
  const [inserted, setInserted] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // ON (default): this upload clears staging first (a fresh weekly import).
  // OFF: append these files to what's already staged (add more files one batch
  // at a time without wiping the earlier ones).
  const [clearFirst, setClearFirst] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  const readHeader = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, preview: 1, skipEmptyLines: true,
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(Boolean)
        setHeaders(hdrs)
        const auto: Partial<Record<FieldKey, string>> = {}
        for (const f of FIELDS) {
          const hit = hdrs.find(h => GUESS[f.key].test(h))
          if (hit) auto[f.key] = hit
        }
        setMapping(auto)
        setPhase('ready')
      },
      error: () => { setErr('Could not read that file&rsquo;s header.'); setPhase('error') },
    })
  }, [])

  const pick = useCallback((list: FileList | null) => {
    const arr = Array.from(list ?? []).filter(f => /\.csv$/i.test(f.name) || f.type.includes('csv'))
    if (!arr.length) { toast.error('Please choose CSV files.'); return }
    setFiles(arr); setErr(null); setPhase('idle'); setPct(0); setInserted(0)
    readHeader(arr[0]) // all files are assumed to share one header layout
  }, [readHeader])

  const missingReq = FIELDS.filter(f => f.required && !mapping[f.key]).map(f => f.label)

  const start = useCallback(async () => {
    if (missingReq.length) { toast.error(`Map the required columns: ${missingReq.join(', ')}`); return }
    setPhase('uploading'); setErr(null); setPct(0); setInserted(0)
    let totalInserted = 0
    let bytesBase = 0 // bytes fully processed in prior files
    const buffer: Record<string, unknown>[] = []

    // Clearing (a fresh import) is done ONCE up front, on its own, so it can
    // never race with — or be re-sent by — the adaptive batch splitting below.
    if (clearFirst) {
      const r = await fetch('/api/admin/import-cc-catalog/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [], reset: true }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.detail || d?.error || `Could not clear staging (HTTP ${r.status})`)
      }
    }

    // Send one batch. Resilient by design:
    //  · transient network / 5xx / 429 → retry with backoff (up to 4 tries);
    //  · body-too-large (413) or a persistent gateway error on a big batch →
    //    split in half and send each half, down to a small floor. That way a
    //    few fat rows (long names, big ASIN lists) can't fail the whole run.
    // Only when a SMALL batch still fails do we surface the real HTTP status.
    const flush = async (rows: Record<string, unknown>[], depth = 0): Promise<void> => {
      if (!rows.length) return
      let res: Response
      try {
        res = await fetch('/api/admin/import-cc-catalog/stage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        })
      } catch {
        // Network drop: back off and retry the same rows a few times.
        if (depth < 4) { await sleep(1000 * (depth + 1)); return flush(rows, depth + 1) }
        throw new Error('Upload failed: the connection dropped. Check your network and try again.')
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        totalInserted += data.inserted ?? 0
        setInserted(totalInserted)
        return
      }
      const data = await res.json().catch(() => null)
      // A big batch the edge rejects (413) or a gateway error: halve and retry.
      if ((res.status === 413 || res.status === 429 || res.status >= 500) && rows.length > 250) {
        const mid = Math.floor(rows.length / 2)
        await flush(rows.slice(0, mid), 0)
        await flush(rows.slice(mid), 0)
        return
      }
      // Small batch, transient status: back off and retry a few times.
      if ((res.status === 429 || res.status >= 500) && depth < 4) {
        await sleep(1000 * (depth + 1)); return flush(rows, depth + 1)
      }
      throw new Error(data?.detail || data?.error || `Upload failed (HTTP ${res.status})`)
    }

    const mapRow = (row: Record<string, string>) => {
      const g = (k: FieldKey) => (mapping[k] ? row[mapping[k] as string] : undefined)
      const asinRaw = g('asins')
      return {
        campaign_id: g('campaign_id'), campaign_name: g('campaign_name'),
        brand_name: g('brand_name'),
        // CC exports the ASIN list as a bracketed string: "[B0DYP43XH2, B0DYP3SVQ8,
        // B0FZ...]". A plain split on spaces/commas left the brackets attached to the
        // first and last ASIN ("[B0DYP43XH2", "B0FZ...]"), so those weren't valid
        // ASINs — rep_asin came back null, the campaign counted as "no ASIN", and every
        // product-card view hid it or couldn't enrich it. Regex-extract the real B0
        // ASINs instead (brackets/quotes/spaces ignored), order-preserved and deduped.
        asins: asinRaw ? Array.from(new Set(String(asinRaw).toUpperCase().match(/B0[A-Z0-9]{8}/g) ?? [])) : [],
        commission_pct: g('commission_pct'),
        starts_at: g('starts_at'), ends_at: g('ends_at'),
        budget: g('budget'), budget_remaining: g('budget_remaining'),
        available_slot: g('available_slot'), total_slot: g('total_slot'),
      }
    }

    try {
      for (const file of files) {
        await new Promise<void>((resolve, reject) => {
          Papa.parse<Record<string, string>>(file, {
            header: true, skipEmptyLines: 'greedy',
            chunk: (results, parser) => {
              parser.pause()
              ;(async () => {
                for (const row of results.data) buffer.push(mapRow(row))
                while (buffer.length >= BATCH) await flush(buffer.splice(0, BATCH))
                const cursor = results.meta.cursor || 0
                setPct(Math.min(99, Math.round(((bytesBase + cursor) / Math.max(1, totalBytes)) * 100)))
                parser.resume()
              })().catch(reject)
            },
            complete: () => { flush(buffer.splice(0)).then(resolve).catch(reject) },
            error: reject,
          })
        })
        bytesBase += file.size
      }
      setPct(100); setPhase('done')
      toast.success(`Uploaded ${totalInserted.toLocaleString()} rows to staging`)
      onDone?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed'
      setErr(msg); setPhase('error'); toast.error(msg)
    }
  }, [files, mapping, missingReq, totalBytes, onDone, clearFirst])

  const reset = () => { setFiles([]); setHeaders([]); setMapping({}); setPhase('idle'); setPct(0); setInserted(0); setErr(null) }

  return (
    <div className="card p-5 mb-5">
      <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Upload CSV files</p>
      <p className="text-[12px] mb-3" style={{ color: 'var(--text-soft)' }}>
        Drop your Creator Connections CSV(s) here. They&rsquo;re read in your browser and streamed into staging in small batches, so file size doesn&rsquo;t matter. Keep this tab open until it finishes.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
        onClick={() => phase !== 'uploading' && inputRef.current?.click()}
        className="rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors"
        style={{ borderColor: dragOver ? '#7C3AED' : 'var(--border)', background: dragOver ? 'rgba(124,58,237,0.05)' : 'transparent' }}>
        <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="hidden"
          onChange={e => pick(e.target.files)} />
        <UploadCloud size={26} className="mx-auto mb-2" style={{ color: '#7C3AED' }} />
        <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>Drag CSV files here, or click to choose</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Multiple files OK · they combine automatically</p>
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
              <FileSpreadsheet size={12} /> {f.name} · {(f.size / 1048576).toFixed(1)}MB
            </span>
          ))}
          {phase !== 'uploading' && (
            <button onClick={reset} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}><X size={12} /> clear</button>
          )}
        </div>
      )}

      {/* Column mapping */}
      {headers.length > 0 && phase !== 'done' && (
        <div className="mt-4">
          <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--text)' }}>Match your columns <span className="font-normal" style={{ color: 'var(--text-faint)' }}>(auto-guessed — fix any that look wrong)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {FIELDS.map(f => (
              <label key={f.key} className="flex items-center gap-2 text-[12px]">
                <span className="w-28 flex-shrink-0" style={{ color: 'var(--text-soft)' }}>
                  {f.label}{f.required && <span style={{ color: '#e11d48' }}> *</span>}
                </span>
                <select
                  value={mapping[f.key] ?? ''}
                  onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))}
                  disabled={phase === 'uploading'}
                  className="flex-1 h-8 text-[12px] rounded-md border bg-white dark:bg-[#1c1c1e] px-2 min-w-0"
                  style={{ borderColor: mapping[f.key] ? 'var(--border)' : (f.required ? 'rgba(225,29,72,0.5)' : 'var(--border)'), color: 'var(--text)' }}>
                  <option value="">— none —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Clear-vs-append choice */}
      {files.length > 0 && phase !== 'done' && (
        <label className="mt-3 flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--text-soft)' }}
          title="ON = fresh weekly import (clears staging first). OFF = add these files to what's already staged.">
          <input type="checkbox" checked={clearFirst} onChange={e => setClearFirst(e.target.checked)} disabled={phase === 'uploading'} className="accent-[#7C3AED]" />
          Clear staging first (start a fresh import). <span style={{ color: 'var(--text-faint)' }}>Uncheck to <b>add</b> these files to what&rsquo;s already staged.</span>
        </label>
      )}

      {/* Progress / actions */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {phase !== 'done' && (
          <button
            onClick={start}
            disabled={phase === 'uploading' || !files.length || !!missingReq.length}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#7C3AED' }}>
            {phase === 'uploading' ? <><Loader2 size={15} className="animate-spin" /> Uploading… {pct}%</> : <><UploadCloud size={15} /> Upload to staging</>}
          </button>
        )}
        {phase === 'done' && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#1f8a3a' }}>
            <CheckCircle2 size={15} /> Uploaded {inserted.toLocaleString()} rows. Now click &ldquo;Merge into live catalog&rdquo; below.
          </span>
        )}
        {(phase === 'uploading' || phase === 'done') && (
          <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{inserted.toLocaleString()} rows staged</span>
        )}
      </div>

      {phase === 'uploading' && (
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#7C3AED' }} />
        </div>
      )}
      {err && <p className="text-[12px] mt-3" style={{ color: '#ff3b30' }}>{err}</p>}
    </div>
  )
}
