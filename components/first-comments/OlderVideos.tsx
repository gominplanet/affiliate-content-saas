// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pinned Comments, for older videos. Every video uploaded through
// Co-Pilot or Liftoff now gets a pinned first comment; this gives the rest of
// the channel one. Tick the videos, and MVP writes each comment from the
// video's own title and the product link in its description, posts it, and
// SCOUT pins it, one video at a time so each result can be seen as it lands.
//
// EACH ROW SAYS WHAT HAPPENED, from the server's answer and SCOUT's own read of
// the pinned badge: pinned, posted but not pinned (and why), waiting until the
// video is public, or not posted (and why). A run that hits YouTube's daily
// limit stops and says so rather than marking the rest failed.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Pin, Search } from 'lucide-react'
import { pinFirstComment } from '@/lib/first-comment-pins'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import PageHero from '@/components/layout/PageHero'
import { PinnedCommentsGuide } from '@/components/guide/tool-guides'

const ACCENT = '#0EA5A4'
const PAGE = 50

type FirstComment = {
  id: string; state: string; commentId: string | null; pinned: boolean | null
  pinError: string | null; lastError: string | null; text: string; postedAt: string | null
}
type Video = {
  youtubeVideoId: string; title: string | null; thumbnailUrl: string | null
  publishedAt: string | null; views: number | null; productLink: string | null
  firstComment: FirstComment | null
}
type Counts = { videos: number; pinned: number; postedNotPinned: number; waiting: number; none: number }
type Step = 'waiting' | 'posting' | 'pinning' | 'done' | 'held' | 'failed'
type RunItem = { id: string; title: string; step: Step; note: string | null }

// NEVER-HEARD-BACK IS NOT "NOT POSTED": a post whose answer was lost may well
// be on the video, so it is not offered for a second one in bulk.
const MAYBE_POSTED = /never heard back/i
const needsOne = (v: Video) => !v.firstComment || v.firstComment.state === 'cancelled'
  || (v.firstComment.state === 'failed' && !MAYBE_POSTED.test(v.firstComment.lastError || ''))

export default function OlderVideos() {
  const [videos, setVideos] = useState<Video[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [missingTable, setMissingTable] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  // Searched a moment after typing stops, not on every key.
  useEffect(() => { const t = setTimeout(() => setQuery(typed), 350); return () => clearTimeout(t) }, [typed])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [run, setRun] = useState<RunItem[] | null>(null)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState<string | null>(null)
  const stop = useRef(false)

  const load = useCallback(async (offset = 0) => {
    setLoading(true); setLoadError(null)
    try {
      const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE) })
      if (onlyMissing) qs.set('missing', '1')
      if (query.trim()) qs.set('q', query.trim())
      const r = await fetchWithTimeout(`/api/youtube/first-comment/videos?${qs}`, { timeoutMs: 30_000 })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setLoadError(j.error || `Could not load your videos (HTTP ${r.status}).`); return }
      setMissingTable(!!j.missingTable)
      setCounts(j.counts ?? null)
      setTotal(Number(j.total || 0))
      setVideos((prev) => offset === 0 ? (j.videos ?? []) : [...prev, ...(j.videos ?? [])])
    } catch {
      setLoadError('Could not reach MVP to load your videos.')
    } finally { setLoading(false) }
  }, [onlyMissing, query])

  useEffect(() => { void load(0) }, [load])

  const pickable = useMemo(() => videos.filter(needsOne), [videos])
  const toPin = useMemo(() => videos.filter((v) => v.firstComment?.state === 'posted' && v.firstComment.commentId && v.firstComment.pinned !== true), [videos])

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const update = (id: string, patch: Partial<RunItem>) => setRun((r) => r && r.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  async function postAndPin() {
    const list = pickable.filter((v) => selected.has(v.youtubeVideoId))
    if (list.length === 0) return
    stop.current = false
    setRunning(true); setRunNote(null)
    setRun(list.map((v) => ({ id: v.youtubeVideoId, title: v.title || v.youtubeVideoId, step: 'waiting', note: null })))
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      if (stop.current) {
        for (const rest of list.slice(i)) update(rest.youtubeVideoId, { step: 'held', note: 'Stopped before this one. Nothing was posted.' })
        setRunNote('Stopped. The ones already done stay done.')
        break
      }
      update(v.youtubeVideoId, { step: 'posting', note: 'Writing the comment and posting it' })
      let j: { state?: string; id?: string; commentId?: string; error?: string; reason?: string; publishAt?: string | null; written?: string; already?: boolean } = {}
      try {
        const r = await fetchWithTimeout('/api/youtube/first-comment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ youtubeVideoId: v.youtubeVideoId, videoTitle: v.title }),
          timeoutMs: 60_000,
        })
        j = await r.json().catch(() => ({}))
        if (!r.ok && !j.state) { update(v.youtubeVideoId, { step: 'failed', note: j.error || `MVP refused it (HTTP ${r.status}).` }); continue }
      } catch {
        update(v.youtubeVideoId, { step: 'failed', note: 'Could not reach MVP. Nothing was posted.' })
        continue
      }
      if (j.state === 'gone') {
        update(v.youtubeVideoId, { step: 'held', note: 'YouTube no longer has this video, so MVP forgot it.' })
        continue
      }
      if (j.state === 'waiting') {
        if (j.reason === 'quota') {
          update(v.youtubeVideoId, { step: 'held', note: "YouTube's daily comment limit for MVP is used up. It posts itself when the limit resets." })
          for (const rest of list.slice(i + 1)) update(rest.youtubeVideoId, { step: 'held', note: 'Not started: the daily limit is used up. Try these tomorrow.' })
          setRunNote("Stopped at YouTube's daily limit. Nothing after this was tried, so nothing was lost.")
          break
        }
        update(v.youtubeVideoId, { step: 'held', note: j.reason === 'not_public' ? 'Not public yet. It posts itself when the video is public, and SCOUT pins it next time Co-Pilot or Liftoff is open.' : 'YouTube did not answer. MVP tries again by itself.' })
        continue
      }
      if (j.state !== 'posted' || !j.commentId || !j.id) {
        update(v.youtubeVideoId, { step: 'failed', note: j.error || 'Not posted, and YouTube gave no reason.' })
        continue
      }
      update(v.youtubeVideoId, { step: 'pinning', note: j.already ? 'It already had its first comment. Pinning it' : `Posted${j.written === 'plain' ? ' (the plain comment: the writer was not available)' : ''}. Pinning it` })
      const pin = await pinFirstComment(j.id, v.youtubeVideoId, j.commentId)
      update(v.youtubeVideoId, pin.pinned
        ? { step: 'done', note: 'Posted and pinned. SCOUT saw the pinned badge.' }
        : { step: 'done', note: `Posted, not pinned: ${pin.error || 'no reason given'}` })
    }
    setRunning(false)
    setSelected(new Set())
    void load(0)
  }

  async function pinTheRest() {
    stop.current = false
    setRunning(true); setRunNote(null)
    setRun(toPin.map((v) => ({ id: v.youtubeVideoId, title: v.title || v.youtubeVideoId, step: 'waiting', note: null })))
    for (const v of toPin) {
      if (stop.current) { update(v.youtubeVideoId, { step: 'held', note: 'Stopped before this one.' }); continue }
      update(v.youtubeVideoId, { step: 'pinning', note: 'Pinning it' })
      const pin = await pinFirstComment(v.firstComment!.id, v.youtubeVideoId, v.firstComment!.commentId!)
      update(v.youtubeVideoId, pin.pinned ? { step: 'done', note: 'Pinned. SCOUT saw the pinned badge.' } : { step: 'failed', note: `Not pinned: ${pin.error || 'no reason given'}` })
    }
    setRunning(false)
    void load(0)
  }

  const chosen = pickable.filter((v) => selected.has(v.youtubeVideoId)).length

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero
        accent={ACCENT}
        guide={<PinnedCommentsGuide />}
        title="Pinned comments"
        subtitle="A comment from your channel with the product link, pinned to the top of every video, where viewers look first."
      />
      <div className="card p-4 mb-4 text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#d1d1d6]">
        Every video Co-Pilot or Liftoff uploads now gets a pinned first comment. This gives your older videos one too. Tick the videos, and MVP writes each comment from the video&apos;s title and the product link in its description (marked &quot;(paid link)&quot;), posts it from your channel, and SCOUT pins it.
        <span className="block mt-1.5 text-[12px] text-[#86868b]">
          Pinning replaces a comment you pinned yourself on that video. YouTube lets MVP post roughly 190 comments a day; when that runs out, the run stops and says so.
        </span>
      </div>

      {missingTable && (
        <div className="card p-3 mb-3 text-[12.5px] border border-[#ff9500]/40 text-[#c93400]">The first comments table is missing (migration 377), so nothing can be posted yet.</div>
      )}

      {counts && (
        <p className="text-[12px] mb-2 text-[#6e6e73] dark:text-[#aeaeb2] tabular-nums">
          {counts.videos.toLocaleString()} videos: {counts.pinned.toLocaleString()} pinned, {counts.postedNotPinned.toLocaleString()} posted and not pinned, {counts.waiting.toLocaleString()} waiting to go public, {counts.none.toLocaleString()} without one.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="flex items-center gap-2 flex-1 min-w-[220px] rounded-lg border border-[var(--border-2,#e5e5e7)] px-2.5 py-1.5">
          <Search size={14} className="text-[#86868b]" />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Find a video by title" className="bg-transparent outline-none text-[13px] flex-1" />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only videos without one
        </label>
        <button type="button" disabled={running || pickable.length === 0} onClick={() => setSelected(new Set(pickable.map((v) => v.youtubeVideoId)))}
          className="btn-secondary text-[12px] disabled:opacity-40">Select all shown ({pickable.length})</button>
        {selected.size > 0 && !running && <button type="button" onClick={() => setSelected(new Set())} className="text-[12px] text-[#86868b]">Clear</button>}
        <button type="button" disabled={running || chosen === 0} onClick={() => void postAndPin()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-40" style={{ background: ACCENT }}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <Pin size={13} />} Post and pin {chosen || ''}
        </button>
        {toPin.length > 0 && !running && (
          <button type="button" onClick={() => void pinTheRest()} className="btn-secondary text-[12px]">Pin the {toPin.length} not pinned</button>
        )}
        {running && <button type="button" onClick={() => { stop.current = true }} className="text-[12px] text-[#ff3b30]">Stop after this one</button>}
      </div>

      {run && <RunProgress items={run} running={running} note={runNote} />}

      {loadError && <div className="card p-3 mb-3 text-[12.5px] text-[#d70015]">{loadError}</div>}

      <ul className="flex flex-col gap-1.5">
        {videos.map((v) => {
          const fc = v.firstComment
          const can = needsOne(v)
          const status = !fc ? null
            : fc.state === 'posted' ? (fc.pinned === true ? { t: 'Pinned', c: '#16a34a' } : { t: `Posted, not pinned${fc.pinError ? `: ${fc.pinError}` : ''}`, c: '#d97706' })
            : fc.state === 'waiting' ? { t: `Waiting until the video is public${fc.lastError ? ` (${fc.lastError})` : ''}`, c: '#0EA5A4' }
            : fc.state === 'posting' ? { t: 'Posting now', c: '#0EA5A4' }
            : fc.state === 'failed' && MAYBE_POSTED.test(fc.lastError || '') ? { t: fc.lastError || 'May already be on the video.', c: '#b26a00' }
            : fc.state === 'failed' ? { t: `Not posted: ${fc.lastError || 'no reason given'}`, c: '#d70015' }
            : { t: 'Cancelled', c: '#86868b' }
          return (
            <li key={v.youtubeVideoId} className="card p-2.5 flex items-start gap-3">
              <input type="checkbox" className="mt-1" disabled={!can || running} checked={selected.has(v.youtubeVideoId)} onChange={() => toggle(v.youtubeVideoId)}
                aria-label={`Choose ${v.title || v.youtubeVideoId}`} />
              {v.thumbnailUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={v.thumbnailUrl} alt="" width={96} height={54} className="rounded object-cover shrink-0" style={{ width: 96, height: 54 }} />
                : <div className="rounded bg-black/5 shrink-0" style={{ width: 96, height: 54 }} />}
              <div className="min-w-0 flex-1 text-[12.5px]">
                <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="font-medium block truncate hover:underline" style={{ color: 'var(--text)' }}>{v.title || v.youtubeVideoId}</a>
                <span className="block text-[11.5px] text-[#86868b] tabular-nums">
                  {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'Date unknown'}
                  {v.views != null ? ` · ${v.views.toLocaleString()} views` : ''}
                  {' · '}{v.productLink ? 'the comment carries the product link in its description' : 'no product link in its description, so the comment has none'}
                </span>
                {status && <span className="block text-[11.5px] mt-0.5" style={{ color: status.c }}>{status.t}</span>}
                {fc?.text && fc.state !== 'failed' && <span className="block text-[11.5px] mt-0.5 text-[#6e6e73] dark:text-[#aeaeb2] line-clamp-2">&ldquo;{fc.text}&rdquo;</span>}
              </div>
            </li>
          )
        })}
      </ul>

      {loading && <div className="py-6 flex justify-center text-[#86868b]"><Loader2 size={16} className="animate-spin" /></div>}
      {!loading && videos.length === 0 && !loadError && (
        <div className="card p-6 text-[13px] text-[#6e6e73] dark:text-[#aeaeb2]">{onlyMissing ? 'Every video MVP knows about has its first comment.' : 'MVP has no YouTube videos for this account yet. Sync your channel under YouTube first.'}</div>
      )}
      {!loading && videos.length < total && (
        <div className="py-3 flex justify-center">
          <button type="button" onClick={() => void load(videos.length)} className="btn-secondary text-[12px]">Show more ({(total - videos.length).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  )
}

function RunProgress({ items, running, note }: { items: RunItem[]; running: boolean; note: string | null }) {
  const finished = items.filter((i) => i.step === 'done' || i.step === 'held' || i.step === 'failed').length
  const pinned = items.filter((i) => i.step === 'done' && /pinned\. SCOUT saw/i.test(i.note || '')).length
  const posted = items.filter((i) => i.step === 'done').length
  const colour: Record<Step, string> = { waiting: 'var(--text-faint)', posting: ACCENT, pinning: ACCENT, done: '#16a34a', held: '#d97706', failed: '#ef4444' }
  const word: Record<Step, string> = { waiting: 'Waiting', posting: 'Posting', pinning: 'Pinning', done: 'Done', held: 'Held', failed: 'Not posted' }
  return (
    <div className="card p-3 mb-3">
      <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
        {running ? `Working: ${finished} of ${items.length} finished` : `Finished: ${posted} posted, ${pinned} of them pinned, ${items.length - posted} not posted`}
      </p>
      <div className="h-1.5 rounded-full mb-2 overflow-hidden" style={{ background: 'var(--surface-hover, #f2f2f4)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((finished / Math.max(1, items.length)) * 100)}%`, background: ACCENT }} />
      </div>
      {note && <p className="text-[12px] mb-1.5 text-[#c93400]">{note}</p>}
      <ul className="flex flex-col gap-1">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-2 text-[12px]">
            <span className="shrink-0 w-[78px] font-semibold inline-flex items-center gap-1" style={{ color: colour[i.step] }}>
              {(i.step === 'posting' || i.step === 'pinning') && <Loader2 size={11} className="animate-spin" />}
              {i.step === 'done' && <Check size={11} />}
              {word[i.step]}
            </span>
            <span className="min-w-0">
              <span className="block truncate" style={{ color: 'var(--text)' }}>{i.title}</span>
              {i.note && <span className="block" style={{ color: 'var(--text-soft, #6e6e73)' }}>{i.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
