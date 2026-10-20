'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR INTRO VIDEO FOR BRANDS (Seb, 2026-10-20: "have that one single intro
// video be uploaded to MVP, and then MVP uses that video on all of the
// requests ... Let's make it a personal intro submission based on what MVP
// wants to recommend"). MVP writes what to say (lib/trybe-intro), the
// creator films it once and uploads it here. What it does yet is said in
// plain words: until SCOUT can add it to TRYBE's Request to Join, the card
// says requests still go without it, so a saved video never reads as sent.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Video, Loader2, Sparkles, Copy, Check, Trash2, UploadCloud, AlertTriangle } from 'lucide-react'
import { INTRO_TIPS, INTRO_MAX_BYTES, INTRO_SECONDS, YEARS_CHOICES, type IntroLine, type IntroVideo } from '@/lib/trybe-intro'

const ROSE = '#E11D48'
type Script = { lines: IntroLine[]; words: number; name?: string; years?: string; at?: string }

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

export default function TrybeIntroVideo() {
  const [video, setVideo] = useState<IntroVideo | null>(null)
  const [script, setScript] = useState<Script | null>(null)
  const [migrated, setMigrated] = useState(true)
  // OPTIONAL (Seb: "if they do not want to do this, they do not have to and
  // can simply send the intro message like before"): off sends the message only.
  const [off, setOff] = useState(false)
  const [name, setName] = useState('')
  const [years, setYears] = useState<string>('')
  const [writing, setWriting] = useState(false)
  const [uploading, setUploading] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api({ action: 'intro_get' }).then((d) => {
      setMigrated(d.migrated !== false)
      setVideo(d.video || null)
      setOff(d.off === true)
      if (d.script?.lines) { setScript(d.script); setName(d.script.name || ''); setYears(d.script.years || '') }
    }).catch((e) => setError(e instanceof Error ? e.message : 'MVP did not answer.'))
  }, [])

  const write = useCallback(async () => {
    setWriting(true); setError(null)
    try { const d = await api({ action: 'intro_script', name, years }); setScript(d.script) }
    catch (e) { setError(e instanceof Error ? e.message : 'MVP could not write it.') }
    finally { setWriting(false) }
  }, [name, years])

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
    } catch (e) {
      setError(`The intro did not upload: ${e instanceof Error ? e.message : 'no answer'}. Nothing was saved.`)
    } finally { setUploading(null); if (file.current) file.current.value = '' }
  }, [])

  const toggle = useCallback(async (next: boolean) => {
    setError(null)
    const was = off
    setOff(next)
    try { await api({ action: 'intro_toggle', off: next }) } catch (e) { setOff(was); setError(e instanceof Error ? e.message : 'MVP could not save that.') }
  }, [off])

  const remove = useCallback(async () => {
    try { await api({ action: 'intro_remove' }); setVideo(null) } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not remove it.') }
  }, [])

  const copy = async () => {
    if (!script) return
    try { await navigator.clipboard.writeText(script.lines.map((l) => l.say).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { toast.error('Copy did not work in this browser. Select the words instead.') }
  }

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
            TRYBE lets you add a video when you ask to join a brand. A short hello, so the brand sees who is asking. MVP writes what to say; you film it once. Prefer not to? Requests go with your message only, as before.
          </p>
        </div>
        <button onClick={() => void toggle(true)} className="shrink-0 text-[12.5px] font-semibold underline" style={soft}>No thanks, message only</button>
      </div>

      {!migrated && <p className="mt-3 text-[12.5px] inline-flex items-center gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} /> The intro video needs migration 450 in Supabase first.</p>}
      {error && <p className="mt-3 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: '#D70015' }}><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</p>}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {/* 1. What to say */}
        <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13.5px] font-semibold">1. What to say</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[12px]" style={soft}>Your first name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Seb" className="mt-1 block w-36 rounded-lg border px-2.5 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
            </label>
            <label className="text-[12px]" style={soft}>Making videos for
              <select value={years} onChange={(e) => setYears(e.target.value)} className="mt-1 block rounded-lg border px-2.5 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">Choose...</option>
                {YEARS_CHOICES.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <button onClick={() => void write()} disabled={writing || !migrated} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: ROSE }}>
              {writing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {script ? 'Write it again' : 'Write my intro'}
            </button>
          </div>
          {script && (
            <div className="mt-3">
              <ol className="space-y-1.5">
                {script.lines.map((l, i) => (
                  <li key={i} className="text-[13.5px] leading-relaxed">
                    {l.say}{l.show && <span className="block text-[11.5px]" style={soft}>Show: {l.show}</span>}
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-center gap-3 text-[12px]" style={soft}>
                <span>{script.words} words, about {Math.max(10, Math.round(script.words / 2.6))} seconds</span>
                <button onClick={() => void copy()} className="inline-flex items-center gap-1 underline" style={{ color: ROSE }}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy the words'}</button>
              </div>
            </div>
          )}
          <ul className="mt-3 space-y-1 text-[12px]" style={soft}>
            {INTRO_TIPS.map((t) => <li key={t}>• {t}</li>)}
          </ul>
        </div>

        {/* 2. Upload it */}
        <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13.5px] font-semibold">2. Upload it once</p>
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
          {/* What it does yet, said plainly (failure looks different from success). */}
          <p className="mt-3 text-[12px] rounded-lg px-2.5 py-2" style={{ background: 'rgba(180,83,9,0.08)', color: '#B45309' }}>
            Not added to requests yet. Requests still go with your message only. MVP adds this video to each one as soon as SCOUT can.
          </p>
        </div>
      </div>
    </section>
  )
}
