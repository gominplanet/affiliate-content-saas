'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Live follow-up (Labs). Paste the replay link, SCOUT reads the page,
// MVP transcribes it, finds each product's moment and cuts a clip per product.
// Every clip opens in Clip Factory as a draft; nothing posts from here.
// Each step shows what actually happened, failure included (lib/live-followup).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Radio, Scissors, Copy, Trash2, Download, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { requestLiveReplay } from '@/lib/extension-frame'
import { fmtClock, shortTitle, type LiveMoment } from '@/lib/live-followup'

type Followup = {
  audio_url?: string | null
  id: string; plan_id: string | null; replay_url: string; title: string | null; stream_url: string | null
  page_asins: string[]; duration_sec: number | null; moments: LiveMoment[]; missing: Array<{ asin: string; title: string }>
  state: 'read' | 'transcribed' | 'matched'; error: string | null; created_at: string
}
type ListRow = { id: string; title: string | null; state: string; error: string | null; moments: LiveMoment[]; created_at: string }
type Plan = { id: string; title: string; updated_at: string }

const SCOUT_ERRORS: Record<string, string> = {
  'not-installed': 'SCOUT is not installed in this browser.',
  'needs-update': 'SCOUT needs updating to read Live replays. Chrome updates it on its own; restart Chrome if it has not.',
  'signed-out': 'Amazon asked SCOUT to sign in. Sign in to Amazon in this browser and try again.',
  'no-stream': 'SCOUT opened the replay but the video never started. Open the link yourself to check it plays, then try again.',
  'not-a-live-page': 'That is not an amazon.com/live link.',
  'bad-url': 'That link could not be read.',
  timeout: 'SCOUT did not answer in time.',
}

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/live/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, j }
}

export default function LiveFollowup() {
  const [list, setList] = useState<ListRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [url, setUrl] = useState('')
  const [planId, setPlanId] = useState('')
  const [reading, setReading] = useState(false)
  const [usingScout, setUsingScout] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Followup | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [roundup, setRoundup] = useState<{ text: string; noLink: string[] } | null>(null)

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/live/followup', { cache: 'no-store' })
      const j = await r.json()
      if (j.error) setListError(j.error)
      setList(j.followups ?? [])
    } catch (e) { setListError(String(e)); setList([]) }
  }, [])
  useEffect(() => {
    loadList()
    fetch('/api/live/plans', { cache: 'no-store' }).then((r) => r.json()).then((j) => setPlans(j.plans ?? [])).catch(() => {})
  }, [loadList])

  const open = useCallback(async (id: string) => {
    setRoundup(null)
    const r = await fetch(`/api/live/followup?id=${id}`, { cache: 'no-store' })
    const j = await r.json()
    if (j.followup) setCurrent(j.followup)
    else toast.error(j.error || 'Could not open it.')
  }, [])

  async function readReplay() {
    setReading(true); setReadError(null)
    try {
      // MVP reads the replay page itself first. SCOUT only when that fails.
      let res = await post({ action: 'create', replayUrl: url.trim(), planId: planId || null })
      if (!res.ok && res.j.tryScout) {
        setUsingScout(true)
        const read = await requestLiveReplay(url.trim())
        if (!read.ok) { setReadError(`${res.j.error} SCOUT could not read it either: ${SCOUT_ERRORS[read.error || ''] || read.error || 'unknown'}`); return }
        res = await post({ action: 'create', replayUrl: url.trim(), planId: planId || null, read })
      }
      if (!res.ok) { setReadError(res.j.error || 'Could not save it.'); return }
      setCurrent(res.j.followup); setUrl(''); loadList()
      const n = res.j.followup?.page_asins?.length ?? 0
      toast.success(`Found the replay and ${n} product${n === 1 ? '' : 's'} you showed${res.j.captions === 'amazon' ? `, with Amazon's captions (${res.j.words} words), so no transcription is needed` : ''}`)
    } finally { setReading(false); setUsingScout(false) }
  }

  async function step(action: 'transcribe' | 'match', label: string) {
    if (!current) return
    setBusy(action)
    try {
      const { ok, j } = await post({ action, id: current.id })
      if (j.followup) setCurrent(j.followup)
      if (!ok) toast.error(j.error || `${label} failed`)
      else toast.success(action === 'transcribe' ? `Transcribed: ${j.words} words` : `Found ${j.followup?.moments?.length ?? 0} products in the replay`)
      loadList()
    } finally { setBusy(null) }
  }

  async function cut(asin: string) {
    if (!current) return
    setBusy(`clip:${asin}`)
    try {
      const { ok, j } = await post({ action: 'clip', id: current.id, asin })
      if (j.followup) setCurrent(j.followup)
      if (!ok) toast.error(j.error || 'The clip could not be cut')
    } finally { setBusy(null) }
  }

  async function writeRoundup() {
    if (!current) return
    setBusy('roundup')
    try {
      const { ok, j } = await post({ action: 'roundup', id: current.id })
      if (!ok) toast.error(j.error || 'Could not write it')
      else setRoundup({ text: j.text, noLink: j.noLink ?? [] })
    } finally { setBusy(null) }
  }

  async function remove(id: string) {
    await post({ action: 'delete', id })
    if (current?.id === id) setCurrent(null)
    loadList()
  }

  const card = 'rounded-2xl border p-5 flex flex-col gap-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Amazon Live</p>
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Live follow-up</h1>
        <p className="text-[13px] max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          After a Live, paste the replay link. MVP finds the moment you showed each product, cuts a vertical clip for each, and writes an &quot;everything I showed&quot; post. Nothing posts from here: each clip opens in Clip Factory as a draft.
        </p>
      </header>

      <section className={card} style={cardStyle}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>New follow-up</h2>
        <label className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Replay link (amazon.com/live/...)</span>
          <input id="live-replay-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.amazon.com/live/broadcast/..."
            className="rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Show plan from Amazon Live Prep (recommended: MVP looks for those products in that order)</span>
          <select id="live-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <option value="">No plan: use the products on the replay page</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={readReplay} disabled={reading || !/amazon\.com\/live\//i.test(url)} className={`${btn} text-white bg-[#7C3AED]`}>
            {reading ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} {reading ? (usingScout ? 'SCOUT is reading the replay…' : 'Reading the replay…') : 'Read the replay'}
          </button>
          {reading && usingScout && <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>A tab opens for a few seconds while the video starts, then closes.</span>}
        </div>
        {readError && <p className="text-[12.5px] text-[#ff3b30]">{readError}</p>}
      </section>

      {current && (
        <section className={card} style={cardStyle}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold truncate" style={{ color: 'var(--text)' }}>{current.title || 'Amazon Live replay'}</h2>
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {current.duration_sec ? `${fmtClock(current.duration_sec)} long · ` : ''}{current.page_asins.length} products on the page · <a href={current.replay_url} target="_blank" rel="noopener noreferrer" className="underline">open the replay</a>
              </p>
            </div>
            <button onClick={() => remove(current.id)} aria-label="Delete" title="Delete" className="p-1.5" style={{ color: 'var(--text-faint)' }}><Trash2 size={15} /></button>
          </div>
          {current.error && <p className="text-[12.5px] text-[#ff3b30]">Last step failed: {current.error}</p>}
          {current.state !== 'read' && !current.audio_url && (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Using Amazon&apos;s own captions for this replay, so no transcription was needed.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => step('transcribe', 'Transcribing')} disabled={!!busy} className={`${btn} border`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === 'transcribe' && <Loader2 size={13} className="animate-spin" />}
              {current.state === 'read' ? '1. Transcribe the replay' : current.audio_url ? 'Transcribe again' : 'Transcribe with Whisper instead'}
            </button>
            <button onClick={() => step('match', 'Finding the products')} disabled={!!busy || current.state === 'read'} className={`${btn} border`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === 'match' && <Loader2 size={13} className="animate-spin" />}
              {current.state === 'matched' ? 'Find the products again' : '2. Find each product'}
            </button>
            <button onClick={writeRoundup} disabled={!!busy} className={`${btn} border`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === 'roundup' && <Loader2 size={13} className="animate-spin" />} Write the roundup post
            </button>
          </div>
          {busy === 'transcribe' && <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Pulling the audio and transcribing. An hour long Live takes a few minutes.</p>}

          {current.state === 'matched' && current.moments.length === 0 && (
            <p className="text-[12.5px] text-[#ff9500]">No product could be placed in the replay. Check the plan matches this Live.</p>
          )}

          {current.moments.length > 0 && (
            <ul className="flex flex-col gap-3">
              {current.moments.map((m) => (
                <li key={m.asin} className="rounded-xl border p-3 flex flex-col sm:flex-row gap-3" style={{ borderColor: 'var(--border)' }}>
                  {m.clipUrl
                    ? <video src={m.clipUrl} controls playsInline className="w-full sm:w-36 aspect-[9/16] rounded-lg bg-black object-cover flex-shrink-0" />
                    : <div className="w-full sm:w-36 aspect-[9/16] rounded-lg flex-shrink-0 grid place-items-center text-[11px] text-center px-2" style={{ background: 'var(--border)', color: 'var(--text-faint)' }}>{busy === `clip:${m.asin}` ? 'Cutting…' : 'No clip yet'}</div>}
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{shortTitle(m.title)}</p>
                    <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{fmtClock(m.startSec)} to {fmtClock(m.endSec)} in the replay ({Math.round(m.endSec - m.startSec)}s)</p>
                    {m.hook && <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>&ldquo;{m.hook}&rdquo;</p>}
                    {m.clipError && <p className="text-[12px] text-[#ff3b30]">{m.clipError}</p>}
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button onClick={() => cut(m.asin)} disabled={!!busy} className={`${btn} border`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                        {busy === `clip:${m.asin}` ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />} {m.clipUrl ? 'Cut again' : 'Cut the clip'}
                      </button>
                      {m.clipUrl && (<>
                        <Link href={`/clip-factory?liveClip=${encodeURIComponent(m.clipUrl)}&product=${m.asin}&name=${encodeURIComponent(shortTitle(m.title))}`} className={`${btn} text-white bg-[#7C3AED]`}>
                          Open in Clip Factory <ArrowRight size={12} />
                        </Link>
                        <a href={m.clipUrl} target="_blank" rel="noopener noreferrer" className={`${btn}`} style={{ color: 'var(--text-soft)' }}><Download size={13} /> Download</a>
                      </>)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {current.missing.length > 0 && (
            <p className="text-[12px] text-[#ff9500]">Not found in the replay: {current.missing.map((x) => shortTitle(x.title)).join(', ')}.</p>
          )}

          {roundup && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>Roundup post</span>
              <textarea id="live-roundup" value={roundup.text} onChange={(e) => setRoundup({ ...roundup, text: e.target.value })} rows={10}
                className="rounded-lg border p-2 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              {roundup.noLink.length > 0 && <p className="text-[12px] text-[#ff9500]">No link could be made for: {roundup.noLink.map(shortTitle).join(', ')}. They are left out.</p>}
              <button onClick={() => { navigator.clipboard.writeText(roundup.text).then(() => toast.success('Copied'), () => toast.error('Copy failed: select the text instead')) }} className={`${btn} border self-start`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                <Copy size={13} /> Copy
              </button>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Earlier follow-ups</h2>
        {listError && <p className="text-[12.5px] text-[#ff3b30]">{listError}</p>}
        {list === null && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="inline animate-spin" /> Loading…</p>}
        {list && list.length === 0 && !listError && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>None yet.</p>}
        {list && list.length > 0 && (
          <ul className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
            {list.map((f) => (
              <li key={f.id}>
                <button onClick={() => open(f.id)} className="w-full text-left px-4 py-2.5 text-[13px] flex items-center justify-between gap-3" style={{ color: 'var(--text)' }}>
                  <span className="truncate">{f.title || 'Amazon Live replay'}</span>
                  <span className="text-[11.5px] flex-shrink-0" style={{ color: f.error ? '#ff3b30' : 'var(--text-faint)' }}>
                    {f.error ? 'needs a retry' : f.state === 'matched' ? `${(f.moments ?? []).length} products` : f.state}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
