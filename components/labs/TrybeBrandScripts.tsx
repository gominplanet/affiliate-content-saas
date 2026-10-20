'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TOP VIDEOS, WORD FOR WORD, for every brand the creator works with on TRYBE
// (Seb, 2026-10-20: "what if we also gave users the exact scripts of the top
// videos"). Once a day SCOUT reads each joined brand's page from the
// creator's own TRYBE tab, one request a brand, and MVP files its top videos
// in the shared copy (lib/trybe-brand-scripts). The words come from there:
// TRYBE's own when it had them, else written down by MVP from the video,
// once for everyone. A video still being written down says so, and one with
// no words says why, so a gap never reads as a video nobody made.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Copy, Check, ChevronDown, ChevronUp, Play, FileText, AlertTriangle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readTopVideos, type MyBrand } from '@/lib/trybe-mybrands'
import { wordsFrom, scriptCounts, BRAND_SCRIPTS_MAX_BRANDS, BRAND_SCRIPTS_PER_BRAND, type ScriptRow } from '@/lib/trybe-brand-scripts'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const DAY_KEY = 'mvp.trybe.brandScripts.readOn'

const today = () => new Date().toISOString().slice(0, 10)
function readOn(): string | null { try { return localStorage.getItem(DAY_KEY) } catch { return null } }
function markRead() { try { localStorage.setItem(DAY_KEY, today()) } catch { /* read again next visit */ } }

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

export default function TrybeBrandScripts({ brands, isAdmin }: { brands: MyBrand[]; isAdmin: boolean }) {
  const [rows, setRows] = useState<ScriptRow[] | null>(null)
  const [reading, setReading] = useState<{ done: number; of: number } | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // One read at a time: My brands may hand over its list more than once.
  const busy = useRef(false)
  const list = useMemo(() => brands.slice(0, BRAND_SCRIPTS_MAX_BRANDS), [brands])
  const ids = useMemo(() => list.map((b) => b.id), [list])

  const show = useCallback(async () => {
    try { const d = await api({ action: 'brand_scripts', brandIds: ids }); setRows(d.videos || []) }
    catch (e) { setNote({ tone: 'bad', text: `MVP could not show the scripts: ${e instanceof Error ? e.message : 'no answer'}` }) }
  }, [ids])

  /** Each brand's page on TRYBE, read through SCOUT, its top videos filed. */
  const read = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setNote(null); setReading({ done: 0, of: list.length })
    const filed: Array<{ brandId: string; brandName: string; videos: unknown[] }> = []
    let failed = 0, stop: string | null = null
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      const d = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(b.id)}/details`)
      if (d.ok) filed.push({ brandId: b.id, brandName: b.name, videos: readTopVideos(d.json).slice(0, BRAND_SCRIPTS_PER_BRAND) })
      else if (d.status === 401 || /not open/i.test(d.error || '')) { stop = d.error || 'TRYBE is signed out in this Chrome'; break }
      else failed++
      setReading({ done: i + 1, of: list.length })
    }
    let saved = 0
    try {
      for (let i = 0; i < filed.length; i += 10) { const d = await api({ action: 'brand_top_seen', brands: filed.slice(i, i + 10) }); saved += Number(d.saved || 0) }
    } catch (e) { setNote({ tone: 'bad', text: `MVP read your brands but could not file their videos: ${e instanceof Error ? e.message : 'no answer'}` }) }
    setReading(null)
    busy.current = false
    if (stop) setNote({ tone: 'bad', text: `Stopped after ${filed.length} of ${list.length} brands: ${stop}.` })
    else {
      const found = filed.reduce((n, b) => n + b.videos.length, 0)
      setNote({ tone: 'ok', text: `Read ${filed.length} of ${list.length} brands on TRYBE${failed ? ` (${failed} did not answer)` : ''}: ${found} top videos, ${saved} new to MVP.` })
      markRead()
    }
    await show()
  }, [list, show])

  useEffect(() => {
    if (!list.length) return
    if (readOn() === today()) void show()
    else void read()
  }, [list, read, show])

  const byBrand = useMemo(() => {
    const m = new Map<string, ScriptRow[]>()
    for (const r of rows || []) if (r.brand_id) m.set(r.brand_id, [...(m.get(r.brand_id) || []), r])
    return list.map((b) => ({ b, videos: m.get(b.id) || [] })).filter((x) => x.videos.length)
  }, [rows, list])
  const total = useMemo(() => scriptCounts(rows || []), [rows])

  async function copy(r: ScriptRow) {
    try { await navigator.clipboard.writeText(r.script || ''); setCopied(r.submission_id); setTimeout(() => setCopied(null), 1500) }
    catch { toast.error('Copy did not work in this browser. Select the words instead.') }
  }

  const soft = { color: 'var(--text-soft)' }
  return (
    <div className="rounded-xl border px-4 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[240px]">
          <p className="text-[15px] font-semibold inline-flex items-center gap-1.5"><FileText size={15} style={{ color: PURPLE }} /> Top videos, word for word</p>
          <p className="text-[12.5px] mt-1 max-w-3xl" style={soft}>
            The top videos of the brands you work with on TRYBE, with what is said in each. Study how they open and what they show, then make it yours: a brand may turn down a video that copies another creator&rsquo;s script.
          </p>
        </div>
        <button onClick={() => void read()} disabled={!!reading || !list.length} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ border: '1px solid var(--border)' }}>
          {reading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Read again
        </button>
      </div>

      {reading && <p className="mt-3 text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your brands&rsquo; top videos on TRYBE: {reading.done} of {reading.of}</p>}
      {note && <p className="mt-3 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: note.tone === 'ok' ? GREEN : '#D70015' }}>{note.tone === 'bad' && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}{note.text}</p>}

      {rows && (
        <p className="mt-3 text-[12.5px] tabular-nums" style={soft}>
          {total.videos ? <>{total.videos} videos from {byBrand.length} brands: <b style={{ color: GREEN }}>{total.ready} with their words</b>{total.waiting ? <>, <span style={{ color: AMBER }}>{total.waiting} being written down</span></> : ''}{total.none ? `, ${total.none} with no words` : ''}.</> : 'None of your brands lists top videos on TRYBE yet.'}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {byBrand.map(({ b, videos }) => {
          const c = scriptCounts(videos)
          const isOpen = open === b.id
          return (
            <div key={b.id} className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setOpen(isOpen ? null : b.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <span className="text-[13.5px] font-semibold flex-1 min-w-0 truncate">{b.name}</span>
                <span className="text-[12px] tabular-nums" style={soft}>{c.ready} of {c.videos} with words{c.waiting ? `, ${c.waiting} coming` : ''}</span>
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {isOpen && (
                <ul className="px-3 pb-3 space-y-3">
                  {videos.map((r) => {
                    const w = wordsFrom(r)
                    return (
                      <li key={r.submission_id} className="flex gap-3">
                        {r.thumbnail
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.thumbnail} alt="" width={64} height={112} className="rounded object-cover shrink-0" style={{ width: 64, height: 112 }} />
                          : <div className="rounded shrink-0" style={{ width: 64, height: 112, background: 'var(--surface-hover, rgba(0,0,0,0.05))' }} />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                            {r.best_rank != null && <span className="font-semibold" style={{ color: PURPLE }}>#{r.best_rank} in TRYBE&rsquo;s Top 100</span>}
                            <span style={{ color: w.tone === 'ok' ? GREEN : w.tone === 'wait' ? AMBER : 'var(--text-soft)' }}>{w.text}</span>
                            {r.video_url && <a href={r.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline" style={{ color: PURPLE }}><Play size={11} /> Watch the video</a>}
                            {r.script && (
                              <button onClick={() => void copy(r)} className="inline-flex items-center gap-0.5 underline" style={{ color: PURPLE }}>
                                {copied === r.submission_id ? <Check size={11} /> : <Copy size={11} />} {copied === r.submission_id ? 'Copied' : 'Copy the words'}
                              </button>
                            )}
                          </div>
                          {r.script && <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line max-h-56 overflow-y-auto pr-1">{r.script}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {isAdmin && rows && <p className="mt-2 text-[11px]" style={soft}>Admin: {list.length} brands asked about{brands.length > list.length ? ` (the first ${list.length} of ${brands.length})` : ''}; up to {BRAND_SCRIPTS_PER_BRAND} videos each are filed.</p>}
    </div>
  )
}
