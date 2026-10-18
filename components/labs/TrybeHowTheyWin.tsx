'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE > Create > How they win (Seb, 2026-10-18, after TrybeDaily shipped
// The Race): every Top 100 video MVP has seen for a brand, what was actually
// said in it, and one press to turn a winner into a script in your voice.
//
// WHY THESE VIDEOS ARE WORTH ANYTHING. A brand that keeps landing new videos
// in TRYBE's Top 100 is spending on ads and paying creators, and the videos
// it picked are the shape of video it approves. Copying that shape is the
// fast way to be approved by it. Copying its sentences is the fast way to be
// dropped by it, which is why the rewrite refuses to hand the original back
// (lib/trybe-scripts tooAlike).
//
// IT LEADS WITH WHAT IT HAS, NOT WITH AN EMPTY LIST. The page opens on one
// sentence of its own state and four counts, so a board holding nothing says
// so before a creator clicks a brand and finds out.
//
// AND IT SAYS WHY A COLLECTION GOT NOTHING. "TRYBE shared 0, MVP listened to
// 0" with no reason is the failure this codebase keeps producing: a screen
// reporting the plan rather than the result. Every zero here carries its
// cause.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Search, Play, Copy, Wand2, AlertTriangle, ChevronDown, ChevronRight,
  Download, Trophy, FileText, Ear, Check,
} from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readScript } from '@/lib/trybe-mybrands'
import { readTopEntries, topEntryFields } from '@/lib/trybe-working'
import { CLOSENESS, rewriteMissing, type Closeness, type TopScript } from '@/lib/trybe-scripts'

const PURPLE = '#7C3AED'
const GREEN = '#15803D'
const AMBER = '#B45309'
const RED = '#B91C1C'
const card = 'rounded-2xl border'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const soft = { color: 'var(--text-soft)' }
const field = 'w-full rounded-xl border px-3 py-2.5 text-[13px] bg-transparent'
const fieldStyle = { borderColor: 'var(--border)', color: 'var(--text)' }

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const r = await fetch('/api/labs/trybe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    })
    const json = await r.json().catch(() => ({}))
    return { ok: r.ok, json: (json && typeof json === 'object' ? json : {}) as Record<string, unknown> }
  } catch (e) {
    return { ok: false, json: { error: e instanceof Error ? e.message : 'No answer.' } }
  }
}

interface Written { hooks: string[]; script: string }
interface BrandRow { id: string | null; name: string; videos: number; words: number }
interface Stats { videos: number; words: number; heard: number; shared: number; brands: BrandRow[]; collectedAt: string | null }

const ago = (iso: string | null): string => {
  if (!iso) return 'never collected'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never collected'
  const mins = Math.round(ms / 60_000)
  if (mins < 2) return 'collected just now'
  if (mins < 60) return `collected ${mins} minutes ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `collected ${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hrs / 24)
  return `collected ${days} ${days === 1 ? 'day' : 'days'} ago`
}

function Stat({ n, label, note, tone }: { n: number | string; label: string; note?: string; tone?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[26px] font-bold leading-none" style={{ color: tone || 'var(--text)' }}>{n}</p>
      <p className="text-[12.5px] font-semibold mt-1.5">{label}</p>
      {note && <p className="text-[11.5px] mt-0.5" style={soft}>{note}</p>}
    </div>
  )
}

export default function TrybeHowTheyWin({ canRead, isAdmin }: { canRead: boolean; isAdmin: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [brand, setBrand] = useState<{ id: string | null; name: string } | null>(null)
  const [typed, setTyped] = useState('')
  const [videos, setVideos] = useState<TopScript[] | null>(null)
  const [coverage, setCoverage] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [writing, setWriting] = useState<string | null>(null)
  const [written, setWritten] = useState<Record<string, Written>>({})
  const [writeError, setWriteError] = useState<Record<string, string>>({})
  const [experience, setExperience] = useState('')
  const [product, setProduct] = useState('')
  const [closeness, setCloseness] = useState<Closeness>('similar')
  const [step, setStep] = useState<string | null>(null)
  const [report, setReport] = useState<{ tone: 'ok' | 'warn'; lines: string[]; filed: number } | null>(null)
  const stop = useRef(false)
  const productBox = useRef<HTMLInputElement>(null)

  const loadStats = useCallback(async () => {
    const r = await post({ action: 'top_scripts_stats' })
    if (!r.ok) { setStatsError(String(r.json.error || 'MVP could not read what it has saved.')); return }
    setStatsError(null)
    setStats(r.json as unknown as Stats)
  }, [])
  useEffect(() => { void loadStats() }, [loadStats])

  const load = useCallback(async (b: { id: string | null; name: string }) => {
    setBrand(b); setVideos(null); setLoadError(null); setWritten({}); setWriteError({}); setOpen({})
    const r = await post({ action: 'top_scripts', brandId: b.id || undefined, brandName: b.name })
    if (!r.ok) { setLoadError(String(r.json.error || 'MVP could not read that brand’s videos.')); return }
    setVideos((r.json.videos ?? []) as TopScript[])
    setCoverage(String(r.json.coverage || ''))
  }, [])

  const ready = useMemo(() => (videos ?? []).filter((v) => v.state === 'ready' && v.script), [videos])

  async function rewrite(v: TopScript) {
    if (!v.script) return
    // THE BOX IS ABOVE, THE BUTTON IS BELOW. Pressed with the product empty,
    // the refusal used to land under the video, a screen away from what it
    // asked for (Seb, 2026-10-18). Now it says where, and takes the creator
    // there. The other box is optional: a TRYBE video is an ad, not a review.
    const missing = rewriteMissing({ reference: v.script, experience, product })
    if (missing.length) {
      const box = productBox.current
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' }); box?.focus()
      setWriteError((e) => ({ ...e, [v.submission_id]: `Type which product this is for in the box above under ${brand?.name || 'the brand'}, then press Write mine from this again.` }))
      return
    }
    setWriting(v.submission_id)
    setWriteError((e) => { const n = { ...e }; delete n[v.submission_id]; return n })
    const r = await post({
      action: 'script_rewrite', reference: v.script, experience, product,
      closeness, brand: v.brand_name || brand?.name || '', avatar: '',
    })
    setWriting(null)
    if (!r.ok) { setWriteError((e) => ({ ...e, [v.submission_id]: String(r.json.error || 'MVP could not write it.') })); return }
    setWritten((w) => ({ ...w, [v.submission_id]: { hooks: (r.json.hooks ?? []) as string[], script: String(r.json.script || '') } }))
  }

  /**
   * The team's collection pass.
   *
   * Reads today's Top 100 through SCOUT, files every entry, then fills the
   * words: TRYBE's own script first because it is free, and only then a
   * transcription, which costs. Every count that comes back as zero is
   * reported with the reason it was zero.
   */
  async function collect() {
    stop.current = false
    setStep('Reading TRYBE’s Top 100'); setReport(null)
    try {
      const top = await requestTrybeApi('GET', '/backend/api/creator/v2/top-creatives')
      if (!top.ok) { toast.error(`MVP could not read the Top 100: ${top.error || 'SCOUT did not answer.'}`); return }
      const entries = readTopEntries(top.json)
      if (!entries.length) { toast.error('TRYBE answered, but MVP could not read the Top 100 from it.'); return }
      const withFile = entries.filter((e) => e.video).length

      // The entry's id goes as submissionId, the name the route files it under.
      const seen = await post({ action: 'top_scripts_seen', entries: entries.map((e) => ({ ...e, submissionId: e.id })) })
      if (!seen.ok) { toast.error(String(seen.json.error || 'MVP could not file the Top 100.')); return }
      // FILED IS WHAT THE ROUTE SAVED, not what the page sent. The page once
      // said it filed 100 while the route had dropped every one of them.
      const filed = Number(seen.json.saved) || 0
      const noId = Number(seen.json.noId) || 0
      const need = (seen.json.need ?? []) as Array<{ submissionId: string }>
      const hear = new Set((seen.json.hear ?? []) as string[])
      const noFile = Number(seen.json.noFile) || 0
      const waiting = Number(seen.json.waiting) || 0
      const hearLeft = Number(seen.json.hearLeft) || 0

      // FREE FIRST. TRYBE shares the words for some of them at no cost, and
      // readScript is what turns its answer into words.
      let shared = 0, refused = 0, empty = 0
      for (let i = 0; i < need.length && !stop.current; i++) {
        setStep(`Asking TRYBE for the words (${i + 1} of ${need.length})`)
        const id = need[i].submissionId
        const sr = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(id)}/script`).catch(() => null)
        if (!sr) { refused++; continue }
        if (!sr.ok) { refused++; continue }
        const text = readScript(sr.json)
        const saved = await post({ action: 'top_script_save', submissionId: id, script: text })
        if (saved.ok && Number(saved.json.saved) === 1) { shared++; hear.delete(id) } else empty++
      }

      // THEN THE ONES THAT COST, best placed first.
      const toHear = [...hear]
      let heard = 0, failed = 0
      let notConfigured = false
      // WHY EACH ONE DID NOT COME BACK, counted, so a line saying five did
      // not come back carries its reason instead of leaving the team to guess.
      const whyNot = new Map<string, number>()
      for (let i = 0; i < toHear.length && !stop.current; i++) {
        setStep(`Listening to the video (${i + 1} of ${toHear.length})`)
        const h = await post({ action: 'top_script_hear', submissionId: toHear[i] })
        if (h.ok && Number(h.json.heard) === 1) heard++
        else {
          failed++
          if (/not configured/i.test(String(h.json.error || ''))) { notConfigured = true; break }
          const why = String(h.json.error || (h.json.why ? `it heard ${h.json.why}` : 'no answer came back'))
            .replace(/^MVP could not listen to that video:\s*/i, '').slice(0, 140)
          whyNot.set(why, (whyNot.get(why) ?? 0) + 1)
        }
      }
      const reasons = [...whyNot].sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([why, n]) => (whyNot.size > 1 ? `${n}: ${why}` : why)).join('; ')

      // EVERY ZERO WITH ITS REASON.
      const lines: string[] = [filed
        ? `Filed ${filed} of the ${entries.length} videos in today’s Top 100.`
        : `MVP filed none of the ${entries.length} videos in today’s Top 100.`]
      if (noId) lines.push(`${noId} came without a video id in TRYBE’s answer, so MVP had nothing to file them under or ask TRYBE about.`)
      // HOW MANY WERE ASKED, and how many TRYBE turned down, whether or not
      // some came back. A line saying TRYBE shared 7 hid that 53 were refused.
      const turnedDown = refused ? `, and refused ${refused} of those outright` : ''
      if (need.length) lines.push(shared
        ? `TRYBE shared the words for ${shared} of the ${need.length} MVP asked about${turnedDown}.`
        : `TRYBE shared the words for none of the ${need.length} MVP asked about${turnedDown}.`)
      else if (filed) lines.push('Every one of them was already tried on an earlier collection, so MVP did not ask TRYBE again.')
      if (empty) lines.push(`${empty} came back with nothing MVP could read.`)
      if (noFile) lines.push(`${noFile} of them have no video file in TRYBE’s answer, so nothing can listen to those.`)
      if (notConfigured) lines.push('Transcription is not switched on for this deployment, so MVP could not listen to any of them.')
      else if (toHear.length) lines.push(heard
        ? `MVP listened to ${heard} of ${toHear.length}.${failed ? ` ${failed} did not come back${reasons ? ` (${reasons})` : ''}.` : ''}`
        : `MVP could not listen to any of the ${toHear.length} it tried${reasons ? ` (${reasons})` : ''}.`)
      // WHAT IS LEFT, so a board at 23 of 100 reads as a first pass rather
      // than the whole of it. Listening is capped per collection because it
      // costs, so the next press does the next ones.
      const stillWaiting = Math.max(0, waiting - shared - heard)
      if (stillWaiting) {
        lines.push(`${stillWaiting} still have no words.${hearLeft ? ` ${hearLeft} of them have a video file MVP has not listened to yet, and Collect again listens to the next ${Math.min(hearLeft, 25)}.` : ''}`)
      }
      else if (!notConfigured) lines.push(`Nothing was left with a video file to listen to, so nothing was paid for.${withFile === 0 ? ' TRYBE sent no video files at all in this answer.' : ''}`)
      // WHAT TRYBE DID SEND, when none of it was a video file, so the next
      // fix is a field name rather than a guess.
      if (withFile === 0) lines.push(`Each entry TRYBE sent has: ${topEntryFields(top.json)}.`)
      setReport({ tone: shared + heard > 0 ? 'ok' : 'warn', lines, filed })
      await loadStats()
      if (brand) void load(brand)
    } finally {
      setStep(null)
    }
  }

  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.success('Copied.'), () => toast.error('Could not copy.')) }

  if (!canRead) {
    return (
      <div className={`${card} p-5`} style={cardStyle}>
        <p className="text-[15px] font-semibold">How they win needs SCOUT on TRYBE</p>
        <p className="text-[13.5px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this Chrome. MVP then shows the brands you work with and the videos TRYBE picked for them.</p>
      </div>
    )
  }

  const empty = !!stats && stats.videos === 0
  const brands = stats?.brands ?? []

  return (
    <div className="space-y-4">
      {/* THE SENTENCE FIRST. What the board holds, before any list. */}
      <div className={card} style={{ ...cardStyle, borderTop: `4px solid ${PURPLE}` }}>
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${PURPLE}1F`, color: PURPLE }}>
              <Trophy size={19} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold leading-tight">
                {empty
                  ? 'Nothing collected yet'
                  : stats
                    ? `${stats.words} ${stats.words === 1 ? 'video' : 'videos'} you can read, across ${brands.filter((b) => b.words > 0).length} ${brands.filter((b) => b.words > 0).length === 1 ? 'brand' : 'brands'}`
                    : 'Reading what MVP has saved'}
              </h3>
              <p className="text-[13.5px] mt-1" style={soft}>
                A brand that keeps landing new videos in TRYBE&rsquo;s Top 100 is spending on ads and paying creators. These are the videos it approved, and what was said in them.
              </p>
            </div>
          </div>
        </div>
        {stats && !empty && (
          <div className="grid grid-cols-2 sm:grid-cols-4 border-t divide-x" style={{ borderColor: 'var(--border)' }}>
            <Stat n={stats.videos} label="Videos filed" note={ago(stats.collectedAt)} />
            <Stat n={stats.words} label="With the words" note={`of ${stats.videos}`} tone={stats.words ? GREEN : undefined} />
            <Stat n={stats.shared} label="TRYBE shared" note="free to read" />
            <Stat n={stats.heard} label="MVP listened" note="paid for once" />
          </div>
        )}
      </div>

      {statsError && <div className={`${card} p-4`} style={cardStyle}><p className="text-[13px]" style={{ color: RED }}>{statsError}</p></div>}

      {/* Pick a brand */}
      {!empty && (
        <div className={`${card} p-4`} style={cardStyle}>
          {brands.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brands.slice(0, 18).map((b) => {
                const on = brand?.name === b.name
                return (
                  <button key={b.id || b.name} type="button" onClick={() => void load({ id: b.id, name: b.name })}
                    className="rounded-full border px-3 py-1.5 text-[12.5px] font-semibold inline-flex items-center gap-1.5"
                    style={{ borderColor: on ? PURPLE : 'var(--border)', color: on ? PURPLE : 'var(--text)', background: on ? `${PURPLE}0F` : 'transparent' }}>
                    {b.name}
                    <span className="text-[11px] font-bold" style={{ color: b.words ? GREEN : 'var(--text-soft)' }}>{b.words || b.videos}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <input className={field} style={fieldStyle} placeholder="Or type any brand on TRYBE" value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) void load({ id: null, name: typed.trim() }) }} />
            <button type="button" onClick={() => typed.trim() && void load({ id: null, name: typed.trim() })}
              className="inline-flex items-center gap-1.5 rounded-xl border px-4 text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}>
              <Search size={14} /> Look
            </button>
          </div>
        </div>
      )}

      {/* The collection, and what it actually did */}
      {isAdmin && (
        <div className={`${card} p-4`} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void collect()} disabled={!!step}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
              {step ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {step || (empty ? 'Collect today’s Top 100' : 'Collect again')}
            </button>
            {step && <button type="button" onClick={() => { stop.current = true }} className="text-[12.5px] font-semibold" style={soft}>Stop</button>}
          </div>
          <p className="text-[11.5px] mt-2" style={soft}>
            Admin only. Files today&rsquo;s Top 100 for every member, asks TRYBE for the words first because that costs nothing, then pays to listen to the ones it had none for.
          </p>
          {report && (
            <ul className="mt-3 space-y-1">
              {report.lines.map((l, i) => (
                <li key={i} className="text-[12.5px] flex items-start gap-1.5" style={{ color: i === 0 && report.filed ? 'var(--text)' : report.tone === 'ok' ? GREEN : AMBER }}>
                  {i === 0 && report.filed ? <Check size={13} className="mt-0.5 flex-shrink-0" /> : <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'currentColor' }} />}
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {empty && !isAdmin && (
        <div className={`${card} p-5`} style={cardStyle}>
          <p className="text-[13.5px]" style={soft}>MVP has not collected TRYBE&rsquo;s Top 100 yet. It arrives for everybody at once, so there is nothing for you to do here.</p>
        </div>
      )}

      {/* The brand */}
      {brand && !videos && !loadError && (
        <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading {brand.name}&rsquo;s videos...</p>
      )}
      {loadError && <div className={`${card} p-4`} style={cardStyle}><p className="text-[13px]" style={{ color: RED }}>{loadError}</p></div>}

      {videos && (
        <div className={`${card} p-4`} style={cardStyle}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[15px] font-bold">{brand?.name}</p>
            {/* HOW THIN IT IS, SAID. Two scripts out of eleven videos is normal. */}
            <p className="text-[12.5px]" style={soft}>{coverage}</p>
          </div>
          {ready.length > 0 && (
            <div className="mt-3 pt-3 border-t grid gap-2 sm:grid-cols-2" style={{ borderColor: 'var(--border)' }}>
              <input ref={productBox} className={field} style={fieldStyle} placeholder="Which product do you have?" value={product} onChange={(e) => setProduct(e.target.value)} />
              <div className="flex gap-1.5">
                {(Object.keys(CLOSENESS) as Closeness[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCloseness(c)} title={CLOSENESS[c].says}
                    className="flex-1 rounded-xl border px-2 py-2 text-[12px] font-semibold"
                    style={{ borderColor: closeness === c ? PURPLE : 'var(--border)', color: closeness === c ? PURPLE : 'var(--text)', background: closeness === c ? `${PURPLE}0F` : 'transparent' }}>
                    {CLOSENESS[c].label}
                  </button>
                ))}
              </div>
              <textarea className={`${field} sm:col-span-2`} style={fieldStyle} rows={2}
                placeholder="Anything to work in? An angle, a moment with it, what the brand asked for. Optional."
                value={experience} onChange={(e) => setExperience(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {(videos ?? []).map((v) => {
        const isOpen = !!open[v.submission_id]
        const w = written[v.submission_id]
        return (
          <div key={v.submission_id} className={`${card} p-4`} style={cardStyle}>
            <div className="flex items-start gap-3">
              <a href={v.video_url || v.thumbnail || '#'} target="_blank" rel="noopener noreferrer" title="Watch it"
                className="relative shrink-0 w-[72px] rounded-xl overflow-hidden border" style={{ aspectRatio: '9 / 16', borderColor: 'var(--border)', background: 'rgba(0,0,0,0.05)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {v.thumbnail && <img src={v.thumbnail} alt="" className="w-full h-full object-cover" />}
                {v.best_rank && (
                  <span className="absolute top-1 left-1 rounded-lg px-1.5 py-0.5 text-[10.5px] font-bold text-white" style={{ background: 'rgba(0,0,0,0.65)' }}>#{v.best_rank}</span>
                )}
              </a>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px]" style={soft}>
                  {v.creator || 'A creator'}{v.seconds ? ` · ${v.seconds}s` : ''}{v.category ? ` · ${v.category}` : ''}
                </p>
                {v.hook
                  ? <p className="text-[14.5px] font-semibold mt-1 leading-snug">&ldquo;{v.hook}&rdquo;</p>
                  : <p className="text-[13.5px] mt-1" style={soft}>No opening line yet.</p>}
                <p className="text-[11.5px] mt-1.5 inline-flex items-center gap-1" style={{ color: v.state === 'ready' ? GREEN : AMBER }}>
                  {v.state === 'ready' ? <Check size={11} /> : <Ear size={11} />}
                  {v.state === 'ready'
                    ? (v.source === 'trybe' ? 'TRYBE shared these words' : 'MVP listened to the video for these words')
                    : v.detail || 'Nothing read from this one yet'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {v.video_url && <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}><Play size={12} /> Watch it</a>}
                  {v.script && (
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [v.submission_id]: !isOpen }))} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {isOpen ? 'Hide the script' : 'Read the script'}
                    </button>
                  )}
                  {v.script && <button type="button" onClick={() => copy(v.script as string)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={soft}><Copy size={12} /> Copy</button>}
                  {v.script && (
                    <button type="button" onClick={() => void rewrite(v)} disabled={writing === v.submission_id}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: PURPLE }}>
                      {writing === v.submission_id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Write mine from this
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isOpen && v.script && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[11.5px] font-semibold inline-flex items-center gap-1" style={soft}><FileText size={11} /> What was said</p>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">{v.script}</p>
              </div>
            )}

            {writeError[v.submission_id] && (
              <p className="mt-3 text-[12.5px] flex items-start gap-1.5" style={{ color: AMBER }}>
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> <span>{writeError[v.submission_id]}</span>
              </p>
            )}

            {w && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[11.5px] font-semibold" style={soft}>Three openings to pick from</p>
                <ul className="mt-1.5 space-y-1.5">
                  {w.hooks.map((h, i) => (
                    <li key={i} className="text-[13px] flex items-start gap-2">
                      <span className="font-bold" style={{ color: PURPLE }}>{i + 1}</span>
                      <button type="button" onClick={() => copy(h)} className="text-left hover:underline">{h}</button>
                    </li>
                  ))}
                  {!w.hooks.length && <li className="text-[12.5px]" style={soft}>MVP wrote the script but no openings came back with it.</li>}
                </ul>
                <p className="mt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">{w.script}</p>
                <button type="button" onClick={() => copy(`${w.hooks[0] ? `${w.hooks[0]}\n\n` : ''}${w.script}`)}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>
                  <Copy size={12} /> Copy the script
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
