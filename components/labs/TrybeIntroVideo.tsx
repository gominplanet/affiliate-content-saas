'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR INTRO VIDEO FOR BRANDS (Seb, 2026-10-20: "have that one single intro
// video be uploaded to MVP, and then MVP uses that video on all of the
// requests"). Optional: one short video, uploaded once, put on TRYBE through
// SCOUT, and attached to every request SCOUT sends. What it does yet is said
// in plain words, so a saved video never reads as sent.
//
// NO SCRIPT, NO FORM (Seb, 2026-10-22: "I don't want to give a script to
// someone. Just give them a little idea of what the intro video should be
// ... make sure that people write their core message, because the core
// message is what's being written as a request to tribe brands. And then
// attached to that will be the intro video"). So the card is a few lines on
// what a good intro is, the upload, and where the core message stands.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Video, Loader2, Check, Trash2, UploadCloud, AlertTriangle, Pencil } from 'lucide-react'
import { INTRO_GUIDE, INTRO_MAX_BYTES, INTRO_SECONDS, TRYBE_PORTFOLIO_PATH, introMime, type IntroVideo } from '@/lib/trybe-intro'
import { getScoutStatus, requestTrybeApi, requestTrybePutFile } from '@/lib/extension-frame'
import { SCOUT_TRYBE_INTRO_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'
import { TRYBE_NOT_OPEN, TRYBE_NOT_OPEN_WORDS } from '@/lib/trybe-tab'

const ROSE = '#E11D48'

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

export default function TrybeIntroVideo({ core, onWriteCore }: {
  /** The creator's core message: the words of every request. */
  core: string
  /** Open the core message to write or edit it. */
  onWriteCore: () => void
}) {
  const [video, setVideo] = useState<IntroVideo | null>(null)
  const [migrated, setMigrated] = useState(true)
  // OPTIONAL (Seb: "if they do not want to do this, they do not have to and
  // can simply send the intro message like before"): off sends the message only.
  const [off, setOff] = useState(false)
  const [uploading, setUploading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ON TRYBE (SCOUT 1.53.7): the intro in the creator's TRYBE portfolio, the
  // link every request carries. The SCOUT in this Chrome decides whether it can.
  const [scout, setScout] = useState<{ installed: boolean; version: string | null } | null>(null)
  const [onTrybeBusy, setOnTrybeBusy] = useState(false)
  const scoutReady = !!scout?.installed && scoutAtLeast(scout.version, SCOUT_TRYBE_INTRO_MIN_VERSION)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { getScoutStatus().then(setScout).catch(() => setScout({ installed: false, version: null })) }, [])

  /** The intro into the creator's TRYBE portfolio, the way TRYBE's own Upload
   *  Preview does: an address from TRYBE, the file copied there by SCOUT from
   *  MVP's storage, the link kept only when TRYBE shows the file at it. */
  const putOnTrybe = useCallback(async (v: IntroVideo) => {
    setOnTrybeBusy(true); setError(null)
    try {
      let size = v.bytes
      if (!size) { const h = await fetch(v.url, { method: 'HEAD' }).catch(() => null); size = Number(h?.headers.get('content-length') || 0) || null }
      if (!size) throw new Error('MVP could not tell the size of the file')
      const type = introMime(v.name)
      const u = await requestTrybeApi('POST', TRYBE_PORTFOLIO_PATH, { fileName: v.name, fileType: type, fileSize: size, uploadType: 'portfolio_video' })
      const j = (u.json && typeof u.json === 'object' ? u.json : {}) as { data?: { uploadUrl?: string; publicUrl?: string }; uploadUrl?: string; publicUrl?: string }
      const d = j.data || j
      if (u.error === TRYBE_NOT_OPEN) throw new Error(TRYBE_NOT_OPEN_WORDS)
      if (!u.ok || !d.uploadUrl || !d.publicUrl) throw new Error(`TRYBE gave no upload address (${u.status || u.error || 'no answer'})`)
      const put = await requestTrybePutFile({ fileUrl: v.url, uploadUrl: d.uploadUrl, contentType: type })
      if (!put.ok) throw new Error(`the file did not reach TRYBE (${put.error || put.status || 'no answer'})`)
      const saved = await api({ action: 'intro_trybe_saved', url: d.publicUrl })
      setVideo(saved.video)
      toast.success('Your intro is on TRYBE')
    } catch (e) {
      setError(`Your intro is saved in MVP, but not on TRYBE yet: ${e instanceof Error ? e.message : 'no answer'}. Requests go with your message only until it is.`)
    } finally { setOnTrybeBusy(false) }
  }, [])

  useEffect(() => {
    api({ action: 'intro_get' }).then((d) => {
      setMigrated(d.migrated !== false)
      setVideo(d.video || null)
      setOff(d.off === true)
    }).catch((e) => setError(e instanceof Error ? e.message : 'MVP did not answer.'))
  }, [])

  const upload = useCallback(async (f: File) => {
    setError(null)
    if (!/^video\//.test(f.type)) { setError('That is not a video file.'); return }
    if (f.size > INTRO_MAX_BYTES) { setError(`That video is ${Math.round(f.size / 1048576)} MB. Keep the intro under ${Math.round(INTRO_MAX_BYTES / 1048576)} MB (about ${INTRO_SECONDS} seconds is plenty).`); return }
    setUploading(0)
    try {
      const u = await api({ action: 'intro_upload_url', name: f.name, bytes: f.size })
      // The bytes go straight to MVP storage, with progress.
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest()
        x.open('PUT', u.uploadUrl)
        x.setRequestHeader('Content-Type', f.type || 'video/mp4')
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) setUploading(Math.round((ev.loaded / ev.total) * 100)) }
        x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`storage said ${x.status}`)))
        x.onerror = () => reject(new Error('the connection dropped'))
        x.send(f)
      })
      const d = await api({ action: 'intro_saved', path: u.path, name: f.name })
      setVideo(d.video)
      toast.success('Intro video saved in MVP')
      // Straight on to TRYBE when this Chrome's SCOUT can do it.
      const st = await getScoutStatus().catch(() => null)
      if (st?.installed && scoutAtLeast(st.version, SCOUT_TRYBE_INTRO_MIN_VERSION) && d.video) void putOnTrybe(d.video)
    } catch (e) {
      setError(`The intro did not upload: ${e instanceof Error ? e.message : 'no answer'}. Nothing was saved.`)
    } finally { setUploading(null); if (file.current) file.current.value = '' }
  }, [putOnTrybe])

  const toggle = useCallback(async (next: boolean) => {
    setError(null)
    const was = off
    setOff(next)
    try { await api({ action: 'intro_toggle', off: next }) } catch (e) { setOff(was); setError(e instanceof Error ? e.message : 'MVP could not save that.') }
  }, [off])

  const remove = useCallback(async () => {
    try { await api({ action: 'intro_remove' }); setVideo(null) } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not remove it.') }
  }, [])

  const soft = { color: 'var(--text-3)' }
  const box = 'rounded-xl border px-4 py-3.5'
  // Turned off: one quiet line, the way back in, and nothing else.
  if (off) return (
    <div className="rounded-xl border px-4 py-2.5 flex flex-wrap items-center gap-2 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <Video size={15} style={{ color: ROSE }} />
      <span className="flex-1 min-w-0" style={soft}><b style={{ color: 'var(--text)' }}>Intro video off.</b> Requests go with your message only, as before.</span>
      <button onClick={() => void toggle(false)} className="text-[12.5px] font-semibold underline" style={{ color: ROSE }}>Use an intro video</button>
      {error && <span className="w-full text-[12px]" style={{ color: '#D70015' }}>{error}</span>}
    </div>
  )
  return (
    <section className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: `${ROSE}40`, background: `linear-gradient(120deg, ${ROSE}0d 0%, transparent 55%), var(--surface)` }}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl inline-flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${ROSE}, ${ROSE}cc)` }}><Video size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-tight">Your intro video for brands <span className="ml-1 text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 align-middle" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>Optional</span></p>
          <p className="text-[13px] mt-0.5 max-w-3xl" style={soft}>
            Every request MVP sends to a TRYBE brand is your core message. Add a short intro video and it goes with every one, so the brand sees who is asking. Prefer not to? Requests go with your message only, as before.
          </p>
        </div>
        <button onClick={() => void toggle(true)} className="shrink-0 text-[12.5px] font-semibold underline" style={soft}>No thanks, message only</button>
      </div>

      {!migrated && <p className="mt-3 text-[12.5px] inline-flex items-center gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} /> The intro video needs migration 450 in Supabase first.</p>}
      {error && <p className="mt-3 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: '#D70015' }}><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</p>}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {/* 1. What a good intro is, and the words it goes with. */}
        <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13.5px] font-semibold">1. What a good intro video is</p>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {INTRO_GUIDE.map((t) => <li key={t} className="flex gap-2"><span className="mt-[7px] w-1.5 h-1.5 shrink-0 rounded-full" style={{ background: ROSE }} />{t}</li>)}
          </ul>
          {/* THE CORE MESSAGE IS THE REQUEST: the video only goes with it. */}
          {core.trim() ? (
            <div className="mt-3 rounded-lg px-2.5 py-2 text-[12.5px]" style={{ background: 'rgba(22,163,74,0.10)', color: '#15803D' }}>
              <p className="inline-flex items-center gap-1.5 font-semibold"><Check size={12} /> Your core message is written.</p>
              <p className="mt-0.5">It is the words of every request; the intro video goes with it.{' '}
                <button onClick={onWriteCore} className="inline-flex items-center gap-1 font-semibold underline"><Pencil size={11} /> Edit it</button>
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-lg px-2.5 py-2 text-[12.5px] space-y-1.5" style={{ background: 'rgba(180,83,9,0.08)', color: '#B45309' }}>
              <p><b>Write your core message first.</b> It is the words of every request MVP sends to a brand; the intro video only goes with it.</p>
              <button onClick={onWriteCore} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: ROSE }}>Write my core message</button>
            </div>
          )}
        </div>

        {/* 2. Upload it */}
        <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13.5px] font-semibold">2. Upload it once <span className="font-normal" style={soft}>(optional)</span></p>
          {video ? (
            <div className="mt-2 flex gap-3">
              <video src={video.url} controls playsInline preload="metadata" className="rounded-lg bg-black shrink-0" style={{ width: 120, height: 213, objectFit: 'cover' }} />
              <div className="min-w-0 text-[12.5px] space-y-1.5" style={soft}>
                <p className="font-semibold truncate" style={{ color: 'var(--text)' }}>{video.name}</p>
                <p>{video.bytes ? `${Math.round(video.bytes / 1048576)} MB, ` : ''}saved {video.uploadedAt ? new Date(video.uploadedAt).toLocaleDateString() : ''}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => file.current?.click()} disabled={uploading !== null} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><UploadCloud size={12} /> Replace</button>
                  <button onClick={() => void remove()} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: '#D70015' }}><Trash2 size={12} /> Remove</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => file.current?.click()} disabled={uploading !== null || !migrated}
              className="mt-2 w-full rounded-xl border-2 border-dashed px-4 py-8 flex flex-col items-center gap-1.5 text-[13px] font-semibold disabled:opacity-50"
              style={{ borderColor: `${ROSE}66`, color: ROSE }}>
              {uploading !== null ? <><Loader2 size={18} className="animate-spin" /> Uploading {uploading}%</> : <><UploadCloud size={20} /> Choose your intro video</>}
              <span className="text-[11.5px] font-normal" style={soft}>Vertical, about {INTRO_SECONDS} seconds</span>
            </button>
          )}
          {uploading !== null && video && <p className="mt-2 text-[12px] inline-flex items-center gap-1" style={soft}><Loader2 size={12} className="animate-spin" /> Uploading the new one: {uploading}%</p>}
          <input ref={file} type="file" accept="video/mp4,video/quicktime,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
          {/* WHERE IT STANDS, said plainly (failure looks different from success). */}
          {(() => {
            const amber = { background: 'rgba(180,83,9,0.08)', color: '#B45309' }
            const green = { background: 'rgba(22,163,74,0.10)', color: '#15803D' }
            if (!video) return <p className="mt-3 text-[12px] rounded-lg px-2.5 py-2" style={amber}>No intro yet. Requests go with your message only.</p>
            if (onTrybeBusy) return <p className="mt-3 text-[12px] rounded-lg px-2.5 py-2 inline-flex items-center gap-1.5" style={amber}><Loader2 size={12} className="animate-spin" /> Putting your intro on TRYBE through SCOUT...</p>
            if (!video.trybeUrl) return (
              <div className="mt-3 text-[12px] rounded-lg px-2.5 py-2 space-y-1.5" style={amber}>
                <p>Saved in MVP, not on TRYBE yet, so requests still go with your message only.</p>
                {scoutReady
                  ? <button onClick={() => void putOnTrybe(video)} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: ROSE }}>Put it on TRYBE</button>
                  : <p>This needs SCOUT {SCOUT_TRYBE_INTRO_MIN_VERSION}{scout?.version ? ` (this Chrome has ${scout.version})` : ''}: open chrome://extensions, turn on Developer mode and press Update.</p>}
              </div>
            )
            if (!scoutReady) return <p className="mt-3 text-[12px] rounded-lg px-2.5 py-2" style={amber}>On TRYBE, but this Chrome has SCOUT {scout?.version || 'not installed'}, which sends requests without it. Update SCOUT to {SCOUT_TRYBE_INTRO_MIN_VERSION}.</p>
            return <p className="mt-3 text-[12px] rounded-lg px-2.5 py-2 inline-flex items-center gap-1.5" style={green}><Check size={12} /> On TRYBE. Every request SCOUT sends now carries it, and each one says so in the run log.</p>
          })()}
        </div>
      </div>
    </section>
  )
}
