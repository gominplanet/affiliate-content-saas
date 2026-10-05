// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
'use client'

/**
 * ShortsCreatePanel — the Shorts Studio "create" flow, inline (no modal).
 *
 * Used inside Clip Factory: pick a long video, find the strongest 15–30s
 * moments, render one to a 9:16 clip with running captions, then hand that
 * rendered clip up to the page via onUseClip so it flows into Enhance → Publish.
 * This is the same plan/ingest/render pipeline the ShortsStudioModal uses, minus
 * the publish pills (publishing happens in Clip Factory's own stage).
 */
import { useCallback, useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, AlertCircle, Film, Scissors, ExternalLink, ArrowRight, Pencil, Check, Trash2 } from 'lucide-react'
import { ShortVideoUpload } from '@/components/ShortVideoUpload'
import { InfoTip } from '@/components/ui/InfoTip'
import { dispatchCapReached } from '@/components/CapReachedBanner'
import { ShortsQuotaBadge, notifyShortsUsageChanged } from '@/components/vertical/ShortsQuotaBadge'
import { errText } from '@/lib/err-text'
import { requestVideoTranscriptCues, requestStudioVideoFile } from '@/lib/extension-frame'
import { SUBTITLE_STYLES, type SubtitleStyle, type ShortRow } from '@/lib/shorts-types'

const PURPLE = '#7C3AED'
const STYLE_LABEL: Record<SubtitleStyle, string> = { 'bold-white': 'Bold white', 'yellow-pop': 'Yellow pop', 'outline': 'Outline', 'hype': 'Hype', 'brand': 'Brand' }

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Parse a JSON response, but tolerate a NON-JSON body. Our API routes always
 * return JSON, so a non-JSON body is a platform/gateway response — usually a
 * function timeout on a heavy render, or a 5xx/HTML error page. Rather than let
 * `res.json()` throw a cryptic "Unexpected token 'A'…is not valid JSON", we throw
 * a plain-English, actionable message keyed off the HTTP status.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<any> {
  const raw = await res.text()
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    if (res.status === 504 || res.status === 502 || res.status === 503 || res.status === 524) {
      throw new Error('The render took too long and timed out on the server. Try again, or upload the video file once (the upload box on this page), then clips render faster and more reliably.')
    }
    throw new Error(`The server hit an error (${res.status || 'network'}). Give it a moment and try again.`)
  }
}

export function ShortsCreatePanel({
  videoId, youtubeVideoId, videoTitle, onUseClip, allowWhole = false, reel = false,
}: {
  /** Meta Hub: Facebook Reels, longer complete moments (lib/shorts-planner reelWindow). */
  reel?: boolean
  /** Offer "Post the whole video" (Labs whole_video). */
  allowWhole?: boolean
  videoId: string
  youtubeVideoId: string | null
  videoTitle: string
  /** Called when a clip is rendered and the creator picks it to carry forward. */
  onUseClip: (clip: { url: string; title: string; caption: string; hashtags: string[]; durationSec?: number }) => void
}) {
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [clips, setClips] = useState<ShortRow[]>([])
  const [hasSource, setHasSource] = useState(false)
  // YouTube refused the server download for this video: the upload box shows
  // even though the video has a YouTube id, because it is now the only way.
  const [needsUpload, setNeedsUpload] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [styleById, setStyleById] = useState<Record<string, SubtitleStyle>>({})
  const [captionsById, setCaptionsById] = useState<Record<string, boolean>>({})
  const [layoutById, setLayoutById] = useState<Record<string, 'center' | 'split'>>({})
  const [renderingId, setRenderingId] = useState<string | null>(null)
  // In-app editor: which clip + its draft (trim/hook/caption) + saving flag.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ startSec: number; endSec: number; hook: string; caption: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setClips(data.shorts || [])
      setHasSource(!!data.hasSource)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [videoId])

  useEffect(() => { void load() }, [load])

  // Set below: SCOUT fetching the creator's own video from YouTube Studio.
  // Answers whether the file came in.
  const getFromStudioRef = useRef<(() => Promise<boolean>) | null>(null)

  const findShorts = useCallback(async (whole = false, autoStudio = true) => {
    setPlanning(true); setError(null)
    try {
      // Pull the timestamped transcript from the creator's OWN browser via SCOUT
      // first. YouTube throttles our datacenter IP, so the server-side scraper and
      // audio ingest fail a lot ("Finding moments…" hangs, then no transcript) —
      // but SCOUT reads the caption track from the watch page in the creator's
      // logged-in session and works every time, even on private/unlisted drafts.
      // Best-effort: no extension / no captions → [] and the server pipeline runs
      // exactly as before (no regression).
      let cues: Array<{ text: string; offset: number; duration: number }> = []
      if (youtubeVideoId) {
        try { cues = await requestVideoTranscriptCues(youtubeVideoId) } catch { /* fall back to server */ }
      }
      const res = await fetch('/api/youtube/shorts/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, youtubeVideoId, ...(cues.length ? { cues } : {}), ...(whole ? { whole: true } : {}), ...(reel ? { format: 'reel' } : {}) }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        if (data.limitReached) dispatchCapReached(data.error || 'Clip Factory is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        // NO CAPTIONS: GET THE VIDEO, DON'T STOP. YouTube sometimes will not
        // hand over the captions; a creator then read "bring the video in"
        // and compared MVP with tools that just carry on. So SCOUT fetches
        // their own video from YouTube Studio right away, MVP transcribes the
        // file, and Find Shorts runs again by itself, once. Only when that
        // fails too is the way in shown, with SCOUT's own reason.
        if (data.needsUpload && autoStudio && youtubeVideoId && getFromStudioRef.current) {
          toast('YouTube would not give MVP the captions. SCOUT is getting your video from YouTube Studio so MVP can transcribe it…', { duration: 9000 })
          const got = await getFromStudioRef.current()
          if (got) { setPlanning(false); return await findShorts(whole, false) }
        }
        if (data.needsUpload) setNeedsUpload(true)
        throw new Error(data.error || 'Could not find Shorts')
      }
      if (data.whole) {
        // Added beside any clips already there, not in place of them.
        const got: ShortRow[] = data.shorts || []
        setClips(prev => [...got, ...prev.filter(c => c.status !== 'suggested' && !got.some(g => g.id === c.id))])
        toast.success('The whole video is ready as one clip. Render it below.')
      } else {
        setClips(data.shorts || [])
        toast.success(`Found ${data.shorts?.length ?? 0} Short${data.shorts?.length === 1 ? '' : 's'}`)
      }
    } catch (e) {
      setError(errText(e)); toast.error(errText(e))
    } finally {
      setPlanning(false)
    }
  }, [videoId, youtubeVideoId, reel])


  // YouTube refused the download, now or on an earlier visit (the failed
  // clip's saved reason says so): the upload box stays until a file is in.
  const youtubeRefused = needsUpload || clips.some(c => c.status === 'failed' && /YouTube/i.test(c.renderError || ''))

  // YOUR OWN VIDEO, FROM YOUTUBE STUDIO. SCOUT fetches the file in the
  // creator's signed-in browser and uploads it straight to MVP, so nothing is
  // downloaded from YouTube on MVP's server (which YouTube blocks).
  const [fromStudio, setFromStudio] = useState<'idle' | 'working' | 'done'>('idle')
  const [studioError, setStudioError] = useState<string | null>(null)
  const getFromStudio = useCallback(async (): Promise<boolean> => {
    if (!youtubeVideoId) return false
    setFromStudio('working'); setStudioError(null)
    try {
      const a = await fetch('/api/youtube/shorts/studio-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId }) })
      const aj = await safeJson(a)
      if (!a.ok || !aj.uploadUrl) throw new Error(aj.error || 'MVP could not open an upload for the file.')
      const r = await requestStudioVideoFile(youtubeVideoId, aj.uploadUrl, aj.maxBytes)
      if (!r.ok) {
        const e = r.error || ''
        throw new Error(
          e === 'not-installed' ? 'SCOUT is not installed in this browser.'
          : e === 'needs-update' ? 'Update SCOUT to 1.21.22 or later, then try again.'
          : e === 'signed-out' ? 'YouTube Studio is signed out in this browser. Sign in at studio.youtube.com, then try again.'
          : e === 'not-your-video' ? 'YouTube Studio does not list this video for the account signed in here. Sign in to the channel that owns it.'
          : e === 'no-download-url' ? 'YouTube Studio did not offer a download for this video. Download it in Studio (the ⋮ menu, then Download) and drop it in the box.'
          : e === 'too-large' ? 'The video is over 300 MB, too big for Clip Factory. Upload a smaller copy.'
          : e === 'timeout' ? 'It took too long. A long video can; try again, or drop the file in the box.'
          : `SCOUT could not bring the file in (${e || 'unknown'}). Drop the file in the box instead.`)
      }
      const at = await fetch('/api/youtube/shorts/studio-file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, path: aj.path }) })
      const atj = await safeJson(at)
      if (!at.ok || !atj.ok) throw new Error(atj.error || 'The file did not attach.')
      setHasSource(true); setNeedsUpload(false); setFromStudio('done')
      toast.success('Your video is in, from YouTube Studio.')
      return true
    } catch (e) {
      setFromStudio('idle'); setStudioError(errText(e))
      return false
    }
  }, [videoId, youtubeVideoId])
  useEffect(() => { getFromStudioRef.current = getFromStudio }, [getFromStudio])

  // Remove a clip from the list. Posted clips stay posted on the platforms.
  const [removingId, setRemovingId] = useState<string | null>(null)
  const removeClip = useCallback(async (clip: ShortRow) => {
    if (clip.status === 'rendered' && !window.confirm('Remove this rendered clip from Clip Factory? Anything already posted stays posted.')) return
    setRemovingId(clip.id)
    try {
      const res = await fetch(`/api/youtube/shorts?shortId=${encodeURIComponent(clip.id)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error || 'The clip was not removed.')
      setClips(prev => prev.filter(c => c.id !== clip.id))
    } catch (e) { toast.error(errText(e)) }
    finally { setRemovingId(null) }
  }, [])

  // We can render if the creator uploaded a source OR the clip has a YouTube id
  // (we fetch just that clip's window at render time — no full download).
  const canRender = hasSource || !!youtubeVideoId

  const renderClip = useCallback(async (clip: ShortRow) => {
    if (!canRender) { toast.error('Prepare the source video first.'); return }
    setRenderingId(clip.id)
    try {
      const res = await fetch('/api/youtube/shorts/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortId: clip.id,
          subtitleStyle: styleById[clip.id] || clip.subtitleStyle || 'bold-white',
          captions: captionsById[clip.id] !== false,
          reframe: layoutById[clip.id] === 'split' ? 'split' : 'center',
        }),
      })
      // Our route always returns JSON, so a non-JSON body means a platform/gateway
      // error — almost always the render (heavy video work) exceeding the function
      // time limit. Surface something actionable, never a raw "Unexpected token" JSON
      // parse error.
      const data = await safeJson(res)
      if (!res.ok) {
        if (data.needsUpload) { setHasSource(false); setNeedsUpload(true); throw new Error(data.error || 'Prepare the source video first.') }
        if (data.limitReached) dispatchCapReached(data.error || 'Rendering is a Pro feature.', { cap: data.cap || 'shorts_studio', currentTier: data.currentTier, upgrade: data.upgrade })
        throw new Error(data.error || 'Render failed')
      }
      if (data.short) setClips(prev => prev.map(c => (c.id === clip.id ? data.short : c)))
      // A render is the only thing that spends a slot, so it is the only thing
      // that moves the counter. Refreshing on mount alone is how a creator
      // rendered her way to fifty while the number above her sat still.
      notifyShortsUsageChanged()
      toast.success('Short rendered')
    } catch (e) {
      // THE CONNECTION DROPPED, NOT THE RENDER. "Failed to fetch" is the
      // browser saying it lost MVP before an answer came back; a heavy render
      // (split screen) can still finish on the server. So MVP looks before it
      // says anything, for up to three minutes, and never shows those words.
      if (e instanceof TypeError) {
        const before = { status: clip.status, url: clip.renderedUrl }
        toast('The connection dropped while rendering. Checking whether the Short finished…')
        for (let i = 0; i < 18; i++) {
          await new Promise((r) => setTimeout(r, 10_000))
          try {
            const res = await fetch(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`, { cache: 'no-store' })
            const data = await res.json().catch(() => ({}))
            const now = (data.shorts as ShortRow[] | undefined)?.find((c) => c.id === clip.id)
            if (!now) continue
            if (now.status === 'rendered' && (now.renderedUrl !== before.url || before.status !== 'rendered')) {
              setClips(prev => prev.map(c => (c.id === clip.id ? now : c)))
              notifyShortsUsageChanged()
              toast.success('Short rendered')
              setRenderingId(null)
              return
            }
            if (now.status === 'failed' && now.renderError && now.renderError !== clip.renderError) {
              setClips(prev => prev.map(c => (c.id === clip.id ? now : c)))
              toast.error(now.renderError)
              setRenderingId(null)
              return
            }
          } catch { /* still offline: keep looking */ }
        }
        const said = 'The connection to MVP dropped while this Short was rendering, and three minutes later it still had not finished. Press Render Short again.'
        toast.error(said)
        setClips(prev => prev.map(c => (c.id === clip.id ? { ...c, status: 'failed', renderError: said } : c)))
        setRenderingId(null)
        return
      }
      toast.error(errText(e))
      setClips(prev => prev.map(c => (c.id === clip.id ? { ...c, status: 'failed', renderError: errText(e) } : c)))
    } finally {
      setRenderingId((cur) => (cur === clip.id ? null : cur))
    }
  }, [canRender, styleById, captionsById, layoutById, videoId])

  function startEdit(clip: ShortRow) {
    setEditingId(clip.id)
    setEditDraft({ startSec: clip.startSec, endSec: clip.endSec, hook: clip.hook || '', caption: clip.caption || '' })
  }
  function cancelEdit() { setEditingId(null); setEditDraft(null) }

  const saveEdit = useCallback(async (clipId: string) => {
    if (!editDraft) return
    if (!(editDraft.endSec > editDraft.startSec)) { toast.error('End must be after start.'); return }
    setSavingEdit(true)
    try {
      const res = await fetch('/api/youtube/shorts/update', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId: clipId, ...editDraft }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.short) setClips(prev => prev.map(c => (c.id === clipId ? data.short : c)))
      setEditingId(null); setEditDraft(null)
      toast.success('Saved. Re-render to apply.')
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setSavingEdit(false)
    }
  }, [editDraft])

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-md">
          <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{videoTitle}</span>: {reel
            ? <>we find complete moments that make sense on their own (up to 90 seconds on a video over 3 minutes, Facebook&apos;s limit for Page Reels) and cut them for you.</>
            : <>we find the strongest 15 to 30 second moments and cut them for you.</>} Subtitles are word-for-word from what you actually said.
        </p>
        <div className="shrink-0 flex flex-wrap items-center gap-2">
        {allowWhole && (
          <button
            onClick={() => findShorts(true)}
            disabled={planning}
            title="No cutting: the full video as one vertical clip, captioned, ready to post"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border disabled:opacity-60"
            style={{ borderColor: PURPLE, color: PURPLE }}
          >
            <Film size={15} /> Post the whole video
          </button>
        )}
        <button
          onClick={() => findShorts(false)}
          disabled={planning}
          className="shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: PURPLE }}
        >
          {planning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {planning ? 'Working…' : clips.length ? 'Find more Shorts' : 'Find Shorts'}
        </button>
        </div>
      </div>

      {/* Source-video prompt — only when we can't fetch from YouTube (no id) and
          nothing's uploaded. With a YouTube id we transcribe from audio and cut
          each clip's window on demand, so no full upload/download is needed. */}
      {!hasSource && (!youtubeVideoId || youtubeRefused) && (
        <div className="rounded-xl border border-dashed border-black/10 dark:border-white/15 p-4">
          <p className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
            {youtubeRefused
              ? 'MVP needs this video\'s file, and YouTube will not let MVP download it. Bring it in here once, then press the button again.'
              : 'Upload the full video once. MVP transcribes it and cuts your clips from it.'}
          </p>
          {youtubeVideoId && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => { void getFromStudio() }}
                disabled={fromStudio === 'working'}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: PURPLE }}
              >
                {fromStudio === 'working' ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                {fromStudio === 'working' ? 'SCOUT is getting it from YouTube Studio…' : 'Get it from YouTube Studio'}
              </button>
              <span className="text-[11px] text-[#86868b]">SCOUT fetches your own video in your signed-in browser. Or drop the file below.</span>
              {studioError && <p className="w-full text-[11px] text-[#ff3b30] flex items-center gap-1"><AlertCircle size={11} /> {studioError}</p>}
            </div>
          )}
          <ShortVideoUpload
            videoId={videoId}
            targetColumn="source_video_url"
            extraFields={{ source_video_uploaded_at: new Date().toISOString() }}
            label="Drop the full video (the long one) here"
            helpText="MP4, under 300 MB. We transcribe it and cut every clip from it — it never touches YouTube."
            onUploaded={async () => { setHasSource(true); setNeedsUpload(false); toast.success(youtubeRefused ? 'Video uploaded. Press Render again.' : 'Video uploaded. Press Find Shorts.') }}
          />
        </div>
      )}

      {error && <p className="text-[12px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={13} /> {error}</p>}

      {/* How many renders are left, beside the buttons that spend them. The
          only counter used to sit in the Clip Factory page header, scrolled far
          above this list and refreshed once on mount, so the first news of a cap
          was being refused by it. */}
      {clips.length > 0 && (
        <div className="flex items-center">
          <ShortsQuotaBadge />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-[#86868b]"><Loader2 size={20} className="animate-spin" /></div>
      ) : clips.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2 text-[#86868b]">
          <Film size={26} />
          <p className="text-sm">No Shorts yet. Hit <span className="font-medium" style={{ color: PURPLE }}>Find Shorts</span> to scan this video.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clips.map(clip => {
            const style = styleById[clip.id] || clip.subtitleStyle || 'bold-white'
            const captionsOn = captionsById[clip.id] !== false
            const rendering = renderingId === clip.id
            const ytLink = clip.youtubeVideoId ? `https://youtu.be/${clip.youtubeVideoId}?t=${Math.floor(clip.startSec)}` : null
            return (
              <div key={clip.id} className="rounded-xl border border-black/5 dark:border-white/10 p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* The whole video was never scored, so it says what it is
                          instead of a 0/100 that reads as a bad clip. */}
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-white" style={{ backgroundColor: PURPLE }}>
                        {clip.score > 0 ? `${clip.score}/100` : clip.startSec === 0 ? 'Whole video' : 'Your clip'}
                      </span>
                      <span className="text-[11px] text-[#86868b] tabular-nums">{fmt(clip.startSec)}–{fmt(clip.endSec)} · {Math.round(clip.endSec - clip.startSec)}s</span>
                      {ytLink && <a href={ytLink} target="_blank" rel="noreferrer" className="text-[11px] inline-flex items-center gap-0.5 hover:underline" style={{ color: PURPLE }}><ExternalLink size={10} /> Watch moment</a>}
                    </div>
                    {editingId === clip.id && editDraft ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="text-[11px] text-[#86868b]">Start
                            <input type="number" step={0.5} min={0} value={editDraft.startSec}
                              onChange={e => setEditDraft(d => d && ({ ...d, startSec: Math.max(0, Number(e.target.value) || 0) }))}
                              className="ml-1 w-20 text-[12px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 tabular-nums" />
                          </label>
                          <label className="text-[11px] text-[#86868b]">End
                            <input type="number" step={0.5} min={0} value={editDraft.endSec}
                              onChange={e => setEditDraft(d => d && ({ ...d, endSec: Math.max(0, Number(e.target.value) || 0) }))}
                              className="ml-1 w-20 text-[12px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 tabular-nums" />
                          </label>
                          <span className="text-[11px] text-[#86868b] tabular-nums">= {Math.max(0, Math.round((editDraft.endSec - editDraft.startSec) * 10) / 10)}s</span>
                        </div>
                        <input type="text" value={editDraft.hook} maxLength={90} placeholder="On-screen hook"
                          onChange={e => setEditDraft(d => d && ({ ...d, hook: e.target.value }))}
                          className="text-[13px] font-medium rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1" />
                        <textarea value={editDraft.caption} maxLength={600} rows={3} placeholder="Post caption"
                          onChange={e => setEditDraft(d => d && ({ ...d, caption: e.target.value }))}
                          className="text-[12px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1" />
                        <div className="flex items-center gap-2">
                          <button onClick={() => saveEdit(clip.id)} disabled={savingEdit}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
                            {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                          </button>
                          <button onClick={cancelEdit} disabled={savingEdit} className="text-[12px] text-[#86868b] hover:underline">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 mt-1.5">
                        {clip.hook && <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2">{clip.hook}</p>}
                        <button onClick={() => startEdit(clip)} className="text-[11px] inline-flex items-center gap-0.5 hover:underline shrink-0" style={{ color: PURPLE }} title="Edit trim, hook and caption">
                          <Pencil size={10} /> Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.07]">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5] cursor-pointer select-none">
                    <input type="checkbox" checked={captionsOn} onChange={e => setCaptionsById(prev => ({ ...prev, [clip.id]: e.target.checked }))} disabled={rendering} className="accent-[#7C3AED]" />
                    Captions
                  </label>
                  <InfoTip>On: burn word-by-word captions onto the Short (readable with sound off). Off: a clean clip, no text. Pick the caption look from the style dropdown.</InfoTip>
                  <select
                    value={style}
                    onChange={e => setStyleById(prev => ({ ...prev, [clip.id]: e.target.value as SubtitleStyle }))}
                    disabled={rendering || !captionsOn}
                    className="text-[11px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-40"
                  >
                    {SUBTITLE_STYLES.map(s => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
                  </select>
                  {/* Layout: Standard center-crop, or Split (center-crop zoom on
                      top over the full horizontal frame below). */}
                  <select
                    value={layoutById[clip.id] || 'center'}
                    onChange={e => setLayoutById(prev => ({ ...prev, [clip.id]: e.target.value as 'center' | 'split' }))}
                    disabled={rendering}
                    title="Video layout"
                    className="text-[11px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-40"
                  >
                    <option value="center">Standard</option>
                    <option value="split">Split screen</option>
                  </select>
                  <button
                    onClick={() => renderClip(clip)}
                    disabled={rendering}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: rendering ? '#9ca3af' : PURPLE }}
                  >
                    {rendering ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
                    {rendering ? 'Rendering…' : clip.status === 'rendered' ? 'Re-render' : 'Render Short'}
                  </button>
                  {clip.status === 'rendered' && clip.renderedUrl && (
                    <button
                      onClick={() => onUseClip({ url: clip.renderedUrl!, title: clip.hook || videoTitle, caption: clip.caption || '', hashtags: clip.hashtags || [], durationSec: clip.endSec - clip.startSec })}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#34c759' }}
                    >
                      Use this clip <ArrowRight size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => removeClip(clip)}
                    disabled={rendering || removingId === clip.id}
                    title="Remove this clip from the list"
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50"
                  >
                    {removingId === clip.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
                  </button>
                  {clip.status === 'failed' && clip.renderError && (
                    <span className="text-[11px] text-[#ff3b30] inline-flex items-center gap-1"><AlertCircle size={11} /> {clip.renderError}</span>
                  )}
                </div>

                {clip.status === 'rendered' && clip.renderedUrl && (
                  <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.07] flex items-center gap-3">
                    <div className="rounded-lg overflow-hidden bg-black aspect-[9/16] w-[90px] shrink-0">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video src={clip.renderedUrl} controls playsInline className="w-full h-full" />
                    </div>
                    <p className="text-[11px] text-[#86868b]">Rendered. Click <span className="font-medium text-[#248a3d]">Use this clip</span> to add a CTA and publish.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
