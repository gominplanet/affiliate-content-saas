'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// IMPORT YOUR DEALS HUB FILE (Seb, 2026-10-19). The member opens the deals
// list they downloaded from the Deals Hub in their own Amazon Associates
// account. This browser reads it a piece at a time (lib/deals-hub-file), so a
// 500 MB file never leaves the computer: MVP keeps the best deals in each
// category, the member picks a few, and each one becomes a deal post through
// /api/deals, scheduled for the moment its deal starts on Amazon, with the
// deal's own prices and end time from the file.
//
// What happened is what is shown: how much of the file was read, how many
// deals could not be, the columns it found when it could not read one, and
// for each picked deal the time it was scheduled for, or why it was not.

import { useMemo, useRef, useState } from 'react'
import { FileUp, Loader2, X, Check, AlertTriangle, CalendarClock } from 'lucide-react'
import {
  CsvStream, mapColumns, readDeal, DealPool, filterDeals, MAX_PER_BATCH, FIELD_WORDS,
  type ColumnMap, type HubDeal, type HubFilter, type HubSort,
} from '@/lib/deals-hub-file'

const PURPLE = '#7C3AED'
const RED = '#DC2626'
const AMBER = '#B45309'
const GREEN = '#047857'
const PAGE = 60

type Phase = 'idle' | 'reading' | 'ready' | 'error'
interface Progress { bytes: number; total: number; rows: number; kept: number; noAsin: number; noStart: number; ended: number }
type RowState = { state: 'waiting' | 'writing' | 'scheduled' | 'published' | 'duplicate' | 'failed' | 'stopped'; text: string; url?: string | null }

const mb = (n: number) => `${(n / 1_048_576).toFixed(n < 10_485_760 ? 1 : 0)} MB`
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

export default function DealsHubImport({ onPosted }: { onPosted?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<{ text: string; columns?: string[] } | null>(null)
  const [deals, setDeals] = useState<HubDeal[]>([])
  const [counts, setCounts] = useState<Array<[string, number]>>([])
  const [badStarts, setBadStarts] = useState<string[]>([])
  const [filter, setFilter] = useState<HubFilter>({ when: 'any' })
  const [sort, setSort] = useState<HubSort>('best')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [running, setRunning] = useState(false)
  const [batchNote, setBatchNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const cancelRead = useRef(false)
  const stopBatch = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function readFile(file: File) {
    cancelRead.current = false
    setFileName(file.name); setPhase('reading'); setError(null); setDeals([]); setCounts([]); setPicked(new Set()); setRows({}); setBatchNote(null); setShown(PAGE); setBadStarts([])
    const p: Progress = { bytes: 0, total: file.size, rows: 0, kept: 0, noAsin: 0, noStart: 0, ended: 0 }
    setProgress({ ...p })
    const csv = new CsvStream()
    const pool = new DealPool(250)
    const state: { map: ColumnMap | null; headers: string[] } = { map: null, headers: [] }
    const samples: string[] = []
    const now = Date.now()
    const take = (batch: string[][]) => {
      for (const cells of batch) {
        if (!state.map) {
          state.headers = cells
          state.map = mapColumns(cells)
          if (state.map.missing.length) throw Object.assign(new Error('columns'), { columns: cells })
          continue
        }
        p.rows++
        const r = readDeal(cells, state.map)
        if ('skip' in r) {
          if (r.skip === 'no-asin') p.noAsin++
          else { p.noStart++; const i = state.map.at.startsAt; if (i !== undefined && samples.length < 3 && cells[i]) samples.push(cells[i]) }
          continue
        }
        if (r.deal.endsAt != null && r.deal.endsAt <= now) { p.ended++; continue }
        pool.add(r.deal)
      }
    }
    try {
      const reader = file.stream().getReader()
      const decoder = new TextDecoder()
      let painted = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        p.bytes += value.byteLength
        take(csv.push(decoder.decode(value, { stream: true })))
        if (cancelRead.current) { await reader.cancel().catch(() => {}); setPhase('idle'); setProgress(null); return }
        if (performance.now() - painted > 250) {
          painted = performance.now()
          setProgress({ ...p, kept: Array.from(pool.counts.values()).reduce((a, b) => a + b, 0) })
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      take(csv.push(decoder.decode()))
      take(csv.end())
      if (!state.map) throw new Error('The file is empty.')
      const kept = pool.deals()
      p.kept = Array.from(pool.counts.values()).reduce((a, b) => a + b, 0)
      setProgress({ ...p })
      setDeals(kept)
      setCounts(Array.from(pool.counts.entries()).sort((a, b) => b[1] - a[1]))
      setBadStarts(samples)
      setPhase('ready')
      if (!kept.length) setError({ text: p.rows ? `MVP read ${p.rows.toLocaleString()} rows but found no deal that has not ended yet.` : 'The file has a header row and no deals.' })
    } catch (e) {
      const cols = (e as { columns?: string[] }).columns
      if (cols) {
        const missing = mapColumns(cols).missing.map((f) => FIELD_WORDS[f]).join(' and ')
        setError({ text: `MVP could not find the ${missing} in this file, so it cannot schedule its deals. Send this list to the team and it will be added.`, columns: cols })
      } else {
        setError({ text: e instanceof Error ? e.message : 'The file could not be read.' })
      }
      setPhase('error')
    }
  }

  const visible = useMemo(() => filterDeals(deals, filter, sort), [deals, filter, sort])
  const pickedDeals = useMemo(() => deals.filter((d) => picked.has(d.asin)), [deals, picked])

  function toggle(asin: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(asin)) n.delete(asin)
      else if (n.size < MAX_PER_BATCH) n.add(asin)
      return n
    })
  }

  async function writePosts() {
    if (!pickedDeals.length || running) return
    stopBatch.current = false
    setRunning(true); setBatchNote(null)
    setRows((r) => { const n = { ...r }; for (const d of pickedDeals) n[d.asin] = { state: 'waiting', text: 'Waiting' }; return n })
    let done = 0, scheduled = 0
    for (const d of pickedDeals) {
      if (stopBatch.current) { setRows((r) => ({ ...r, [d.asin]: { state: 'stopped', text: 'Not written: you stopped the batch.' } })); continue }
      setRows((r) => ({ ...r, [d.asin]: { state: 'writing', text: 'Writing the post...' } }))
      // Scheduled for the deal's own start. One that has already started is
      // published now; the server holds anything Amazon has not started yet.
      const startsLater = d.startsAt != null && d.startsAt > Date.now() + 2 * 60_000
      const body = {
        asin: d.asin,
        occasion: 'auto',
        dealStartsAt: new Date(d.startsAt as number).toISOString(),
        ...(startsLater ? { scheduledAt: new Date(d.startsAt as number).toISOString() } : {}),
        ...(d.endsAt ? { manualDealEnd: new Date(d.endsAt).toISOString() } : {}),
        dealPrices: { sale: d.dealPrice ?? undefined, was: d.listPrice ?? undefined, pct: d.discountPct ?? undefined },
      }
      try {
        const res = await fetch('/api/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(320_000) })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; scheduledAt?: string | null; duplicate?: boolean; existingUrl?: string | null; error?: string; limitReached?: boolean }
        if (j.duplicate) {
          setRows((r) => ({ ...r, [d.asin]: { state: 'duplicate', text: 'You already have a deal post for this product, so it was not written again.', url: j.existingUrl } }))
        } else if (j.limitReached || res.status === 429) {
          setRows((r) => ({ ...r, [d.asin]: { state: 'failed', text: j.error || 'Your monthly posts are used up.' } }))
          stopBatch.current = true
          setBatchNote({ tone: 'warn', text: 'The batch stopped: your monthly posts are used up (limit_reached). The deals after this one were not written.' })
        } else if (res.ok && j.ok) {
          done++
          if (j.scheduledAt) scheduled++
          setRows((r) => ({ ...r, [d.asin]: j.scheduledAt
            ? { state: 'scheduled', text: `Scheduled for ${when(Date.parse(j.scheduledAt))}, when the deal starts.`, url: j.url }
            : { state: 'published', text: 'Published now: the deal has already started.', url: j.url } }))
        } else {
          setRows((r) => ({ ...r, [d.asin]: { state: 'failed', text: j.error || `MVP answered ${res.status}.` } }))
        }
      } catch (e) {
        setRows((r) => ({ ...r, [d.asin]: { state: 'failed', text: e instanceof Error && e.name === 'TimeoutError' ? 'It took more than five minutes. Check Recent deals before trying it again.' : 'The request did not finish. Check Recent deals before trying it again.' } }))
      }
    }
    setRunning(false)
    if (done) onPosted?.()
    setBatchNote((n) => n ?? (done
      ? { tone: 'ok', text: `${done} deal post${done === 1 ? '' : 's'} written${scheduled ? `, ${scheduled} scheduled for when the deal starts` : ''}.` }
      : { tone: 'bad', text: 'No deal post was written. Each deal above says why.' }))
  }

  const soft = { color: 'var(--text-soft)' }
  const faint = { color: 'var(--text-faint)' }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Import your Deals Hub file</h2>
          <p className="text-[13px] mt-1 max-w-2xl leading-relaxed" style={soft}>
            Download the deals list from the Deals Hub in your Amazon Associates account, then open it here.
            It is read on this computer and never uploaded, however big it is. Pick the deals you want and MVP writes a post for each, scheduled for the moment the deal starts on Amazon.
          </p>
        </div>
        {phase !== 'reading' && (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={running}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: PURPLE }}>
            <FileUp size={14} /> {phase === 'idle' ? 'Open the file' : 'Open another file'}
          </button>
        )}
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f) }} />
      </div>

      {phase === 'reading' && progress && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[12.5px]" style={soft}>
            <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Reading {fileName}: {mb(progress.bytes)} of {mb(progress.total)}, {progress.rows.toLocaleString()} deals so far</span>
            <button type="button" onClick={() => { cancelRead.current = true }} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: RED }}><X size={12} /> Stop</button>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full" style={{ width: `${Math.min(100, (progress.bytes / Math.max(1, progress.total)) * 100)}%`, background: PURPLE }} />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border px-3 py-2.5 text-[12.5px]" style={{ borderColor: 'rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.05)' }}>
          <p className="flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {error.text}</p>
          {error.columns && <p className="mt-1.5 break-words" style={soft}>Columns in your file: {error.columns.slice(0, 40).join(', ')}</p>}
        </div>
      )}

      {phase === 'ready' && progress && (
        <>
          <p className="mt-4 text-[12.5px] leading-relaxed" style={soft}>
            Read all {mb(progress.total)} of {fileName}: {progress.rows.toLocaleString()} deals, {progress.kept.toLocaleString()} still to come or live
            {progress.ended ? `, ${progress.ended.toLocaleString()} already ended` : ''}.
            {progress.noAsin + progress.noStart > 0 && <span style={{ color: AMBER }}> {(progress.noAsin + progress.noStart).toLocaleString()} could not be read{progress.noStart ? ` (${progress.noStart.toLocaleString()} with a start time MVP could not read${badStarts.length ? `, like "${badStarts[0]}"` : ''})` : ''}.</span>}
            {' '}Showing the best 250 in each of {counts.length} categories.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <select value={filter.category || ''} onChange={(e) => { setFilter((f) => ({ ...f, category: e.target.value || null })); setShown(PAGE) }} className="input-field !py-1.5 !text-[12.5px] max-w-[14rem]">
              <option value="">Every category</option>
              {counts.map(([c, n]) => <option key={c} value={c}>{c} ({n.toLocaleString()})</option>)}
            </select>
            <select value={filter.when || 'any'} onChange={(e) => setFilter((f) => ({ ...f, when: e.target.value as HubFilter['when'] }))} className="input-field !py-1.5 !text-[12.5px] max-w-[10rem]">
              <option value="any">Live or upcoming</option>
              <option value="upcoming">Upcoming only</option>
              <option value="live">Live now</option>
            </select>
            <select value={String(filter.minDiscount || 0)} onChange={(e) => setFilter((f) => ({ ...f, minDiscount: Number(e.target.value) }))} className="input-field !py-1.5 !text-[12.5px] max-w-[9rem]">
              {[0, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n ? `${n}% off or more` : 'Any discount'}</option>)}
            </select>
            <select value={String(filter.minCommission || 0)} onChange={(e) => setFilter((f) => ({ ...f, minCommission: Number(e.target.value) }))} className="input-field !py-1.5 !text-[12.5px] max-w-[10rem]">
              {[0, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${n}% commission or more` : 'Any commission'}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5" style={soft}>
              <input type="checkbox" checked={!!filter.belowYtdOnly} onChange={(e) => setFilter((f) => ({ ...f, belowYtdOnly: e.target.checked }))} /> Below this year&apos;s low
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as HubSort)} className="input-field !py-1.5 !text-[12.5px] max-w-[10rem]">
              <option value="best">Best deals first</option>
              <option value="discount">Biggest discount</option>
              <option value="commission">Highest commission</option>
              <option value="reviews">Most reviews</option>
              <option value="soonest">Starting soonest</option>
            </select>
            <input value={filter.search || ''} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} placeholder="Search name, brand or ASIN" className="input-field !py-1.5 !text-[12.5px] max-w-[14rem]" />
          </div>

          <p className="mt-2 text-[12px]" style={faint}>{visible.length.toLocaleString()} deals match. Pick up to {MAX_PER_BATCH} at a time.</p>

          <ul className="mt-2 flex flex-col divide-y rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {visible.slice(0, shown).map((d) => {
              const on = picked.has(d.asin)
              const st = rows[d.asin]
              const upcoming = d.startsAt != null && d.startsAt > Date.now()
              return (
                <li key={`${d.asin}-${d.startsAt}`} className="flex items-start gap-3 px-3 py-2.5" style={{ borderColor: 'var(--border)', background: on ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
                  <input type="checkbox" checked={on} disabled={running || (!on && picked.size >= MAX_PER_BATCH)} onChange={() => toggle(d.asin)} className="mt-1" aria-label={`Pick ${d.title}`} />
                  {d.image && <img src={d.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-11 h-11 rounded-md object-contain bg-white flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <a href={`https://www.amazon.com/dp/${d.asin}`} target="_blank" rel="noopener noreferrer" className="block text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--text)' }}>{d.title}</a>
                    <p className="text-[12px] mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 tabular-nums" style={soft}>
                      <span>{d.category}{d.subcategory ? ` · ${d.subcategory}` : ''}</span>
                      {d.dealPrice != null && <span><strong style={{ color: 'var(--text)' }}>{money(d.dealPrice)}</strong>{d.listPrice ? <span className="line-through ml-1" style={faint}>{money(d.listPrice)}</span> : null}</span>}
                      {d.discountPct != null && <span style={{ color: RED }}>{Math.round(d.discountPct)}% off</span>}
                      {d.commissionPct != null && <span>{d.commissionPct}% commission</span>}
                      {d.belowYtd && <span style={{ color: GREEN }}>Below this year&apos;s low</span>}
                    </p>
                    <p className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={faint}>
                      <CalendarClock size={11} />
                      {upcoming ? `Starts ${when(d.startsAt as number)}` : 'Live now'}{d.endsAt ? `, ends ${when(d.endsAt)}` : ''}
                    </p>
                    {st && (
                      <p className="text-[12px] mt-1 inline-flex items-start gap-1" style={{ color: st.state === 'failed' ? RED : st.state === 'duplicate' || st.state === 'stopped' ? AMBER : st.state === 'waiting' || st.state === 'writing' ? 'var(--text-soft)' : GREEN }}>
                        {st.state === 'writing' ? <Loader2 size={12} className="animate-spin mt-0.5" /> : st.state === 'scheduled' || st.state === 'published' ? <Check size={12} className="mt-0.5" /> : null}
                        <span>{st.text}{st.url ? <> <a href={st.url} target="_blank" rel="noopener noreferrer" className="underline">Open</a></> : null}</span>
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
            {!visible.length && <li className="px-3 py-4 text-[12.5px]" style={soft}>No deal matches these filters.</li>}
          </ul>
          {visible.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 text-[12.5px] font-semibold" style={{ color: PURPLE }}>Show {Math.min(PAGE, visible.length - shown)} more</button>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void writePosts()} disabled={!picked.size || running}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
              {running ? 'Writing...' : `Write ${picked.size || ''} deal post${picked.size === 1 ? '' : 's'}`}
            </button>
            {running && <button type="button" onClick={() => { stopBatch.current = true }} className="text-[12.5px] font-semibold" style={{ color: RED }}>Stop after this one</button>}
            <p className="text-[12px] max-w-xl" style={faint}>
              Each post uses one from your monthly allowance and takes a minute or two. Keep this page open until they are done.
            </p>
          </div>
          {batchNote && (
            <p className="mt-2 text-[12.5px]" style={{ color: batchNote.tone === 'ok' ? GREEN : batchNote.tone === 'warn' ? AMBER : RED }}>{batchNote.text}</p>
          )}
        </>
      )}
    </div>
  )
}
