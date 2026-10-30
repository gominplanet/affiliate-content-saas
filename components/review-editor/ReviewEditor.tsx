'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR (Labs). Two takes in: the review in one go, the B-roll in
// another. MVP cuts the mistakes, puts the B-roll where it is talked about,
// adds the logo, title, zooms and colour, and makes it wide (Amazon and
// YouTube) and or vertical (TRYBE, TikTok). Add a batch and leave it: each
// video moves through the queue by itself (lib/review-edit-server), and
// every card says where it is and what MVP did, so a video still being read
// never looks like one that failed, and a cut is never silent.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud, Check, AlertTriangle, Film, Scissors, Clapperboard, Download, Send, Trash2, RotateCcw, Wand2, ImagePlus, HardDrive } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { pickFromDrive, type DriveState } from '@/components/review-editor/drive-picker'
import DriveBatch from '@/components/review-editor/DriveBatch'
import {
  DEFAULT_SETTINGS, FORMAT_WORDS, KIND_WORDS, LOGO_OPACITY, LOGO_SIZES, LOGO_WIDTH, MAX_PICTURES, PICTURE_WHEN_WORDS, PICTURE_WIDTH, POSITIONS, POSITION_WORDS, SPOTS,
  TITLE_COLORS, TITLE_LOOKS, TITLE_LOOK_WORDS, TITLE_SECONDS, clock, cleanSettings,
  type EditSettings, type Format, type LogoSize, type Picture, type PictureTime, type PictureWhen, type Position, type Spot, type TitleColor, type VideoKind,
} from '@/lib/review-edit'

const PURPLE = '#7C3AED'
const GREEN = '#15803D'
const AMBER = '#B45309'
const RED = '#B91C1C'
const soft = { color: 'var(--text-3)' }
const card = 'rounded-2xl border p-4'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const mb = (n: number) => `${Math.round(n / 1048576)} MB`

/** A take: uploading to MVP (url once up), or picked in Google Drive (driveId). */
interface Upl { name: string; bytes: number; sent: number; url: string | null; driveId?: string; error: string | null }
interface EditView {
  id: string; name: string | null; status: string; note: string | null; product: string | null
  createdAt: string; madeAt: string | null; rawDeleted: boolean; hasBroll: boolean
  /** When the step it is on began. */
  since: string
  /** While being made: what the video server says it is doing with it. */
  onServer: { stage: string; pct: number | null; since: string; ahead: number; others: number } | { missing: true } | null
  /** Takes uploaded to MVP that are still kept; a Drive take is never kept by MVP. */
  rawInMvp: boolean; fromDrive: boolean
  settings: EditSettings
  review: { duration: number; width: number; height: number } | null
  outputs: Partial<Record<Format, { url: string; seconds: number }>> | null
  cuts: { k: number; kind: string; why: string; restored: boolean; at: string; text: string }[]
  broll: { k: number; off: boolean; why: string; shot: string; line: string; at: string }[]
  zooms: number
  /** What went on the video when it was last sent to be made, and what was left out. */
  placed: { title: { from: number; to: number } | { missed: string } | null; pictures: PictureTime[] } | null
}

const STATUS: Record<string, { words: string; color: string; busy?: boolean }> = {
  queued: { words: 'In line', color: 'var(--text-3)', busy: true },
  reading: { words: 'Reading your takes', color: PURPLE, busy: true },
  ready_to_make: { words: 'Waiting to be made', color: PURPLE, busy: true },
  making: { words: 'Being made', color: PURPLE, busy: true },
  done: { words: 'Ready', color: GREEN },
  failed: { words: 'Stopped', color: RED },
}

/** The video server's step, in words. */
function serverWords(s: { stage: string; pct: number | null; since: string; ahead: number; others: number }): string {
  const pct = s.pct != null ? ` (${s.pct}%)` : ''
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(s.since)) / 60_000))
  const for_ = mins >= 1 ? `, for ${mins} ${mins === 1 ? 'minute' : 'minutes'}` : ''
  switch (s.stage) {
    case 'wait': {
      const n = s.ahead + s.others
      return n ? `On the video server: waiting behind ${n} other ${n === 1 ? 'video' : 'videos'}${for_}.` : `On the video server: about to start${for_}.`
    }
    case 'download': return `On the video server: getting your talking take${pct}${for_}.`
    case 'broll': return `On the video server: getting your B-roll take${pct}${for_}.`
    case 'cut': return `On the video server: cutting the B-roll moments${pct}${for_}.`
    case 'make': return `On the video server: making the video${pct}${for_}.`
    case 'save': return `On the video server: saving the finished video${for_}.`
    default: return 'On the video server.'
  }
}

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'That did not work.')
  return d
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="rounded-full border px-3 py-1 text-[12.5px] font-semibold"
      style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text-2)' }}>{children}</button>
  )
}

function Toggle({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span><b className="font-semibold">{label}</b>{hint && <span className="block text-[12px]" style={soft}>{hint}</span>}</span>
    </label>
  )
}

/** The creator's picture library, shared by every video's choices. */
interface Library { pictures: string[]; busy: boolean; add: (f: File) => Promise<string | null>; forget: (url: string) => Promise<void> }
const checker = { background: 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 12px 12px' }
const newPicture = (url: string): Picture => ({ url, on: true, position: 'lower-right', size: 'medium', opacity: 1, when: 'whole', seconds: 4, say: '' })
const sizeWords = (z: LogoSize) => (z === 'small' ? 'Small' : z === 'medium' ? 'Medium' : 'Large')
const selectStyle = { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text)' }

/** The title exactly as MVP draws it for the video (/api/review-edit/title),
 *  a moment after the typing stops. */
function useTitleUrl(t: EditSettings['title']): string {
  const want = `/api/review-edit/title?${new URLSearchParams({ text: t.text || 'Your title here', look: t.look, color: t.color, size: t.size, position: t.position })}`
  const [url, setUrl] = useState(want)
  useEffect(() => { const h = setTimeout(() => setUrl(want), 450); return () => clearTimeout(h) }, [want])
  return url
}

/** Where an overlay sits on a frame, the same spots the video server uses
 *  (edit-filters placeAt: 4% in from the side, 5% from the top or bottom). */
function spotStyle(p: Spot, widthPct: number, opacity = 1): React.CSSProperties {
  const left = p.includes('left'), right = p.includes('right'), mid = p === 'top' || p === 'bottom' || p === 'center'
  const up = p.startsWith('upper') || p === 'top', down = p.startsWith('lower') || p === 'bottom'
  return {
    position: 'absolute', width: `${Math.round(widthPct * 1000) / 10}%`, height: 'auto', opacity,
    ...(left ? { left: '4%' } : right ? { right: '4%' } : { left: '50%' }),
    ...(up ? { top: '5%' } : down ? { bottom: '5%' } : { top: '50%' }),
    transform: `${mid ? 'translateX(-50%)' : ''} ${p === 'center' ? 'translateY(-50%)' : ''}`.trim() || undefined,
  }
}

/** Everything that goes on the video, in its place on a blank frame, at its
 *  real size. Each shows at its own moment on the video; here, all at once. */
function FramePreview({ s, titleUrl }: { s: EditSettings; titleUrl: string }) {
  const vertical = s.kind === 'trybe'
  const [titleW, setTitleW] = useState<number | null>(null)
  const share = titleW ? Math.min(0.9, Math.max(0.1, titleW / 1920)) : 0.4
  const logo = !vertical && s.logo?.on ? s.logo : null
  const pics = s.pictures.filter((p) => p.on)
  return (
    <div className="relative overflow-hidden rounded-lg" aria-label="How it sits on your video"
      style={{ width: vertical ? 170 : 'min(100%, 420px)', aspectRatio: vertical ? '9 / 16' : '16 / 9', background: 'radial-gradient(circle at 35% 40%, #cdb8a0, #7d6a5c 55%, #2b2623)' }}>
      {pics.map((p, i) => <img key={i} src={p.url} alt="" style={spotStyle(p.position, PICTURE_WIDTH[p.size][vertical ? 'vertical' : 'wide'], p.opacity)} />)}
      {logo && <img src={logo.url} alt="" style={spotStyle(logo.position, LOGO_WIDTH[logo.size].wide, logo.opacity)} />}
      {s.title.on && <img src={titleUrl} alt="" onLoad={(ev) => setTitleW(ev.currentTarget.naturalWidth)} style={spotStyle(s.title.position, vertical ? Math.min(0.9, share * 1.5) : share)} />}
    </div>
  )
}

/** One picture on this video: where, how big, how solid, and when. */
function PictureRow({ p, set, remove }: { p: Picture; set: (p: Picture) => void; remove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
      <img src={p.url} alt="" className="h-9 w-auto max-w-[4.5rem] rounded" style={checker} />
      <Toggle on={p.on} set={(v) => set({ ...p, on: v })} label="Show" />
      <select aria-label="Where" value={p.position} onChange={(ev) => set({ ...p, position: ev.target.value as Spot })} className="rounded border px-1 py-0.5" style={selectStyle}>
        {SPOTS.map((x) => <option key={x} value={x}>{POSITION_WORDS[x]}</option>)}
      </select>
      <select aria-label="Size" value={p.size} onChange={(ev) => set({ ...p, size: ev.target.value as LogoSize })} className="rounded border px-1 py-0.5" style={selectStyle}>
        {LOGO_SIZES.map((z) => <option key={z} value={z}>{sizeWords(z)}</option>)}
      </select>
      <select aria-label="Look" value={p.opacity} onChange={(ev) => set({ ...p, opacity: Number(ev.target.value) })} className="rounded border px-1 py-0.5" style={selectStyle}>
        {LOGO_OPACITY.map((o) => <option key={o} value={o}>{o === 1 ? 'Solid' : `See-through ${Math.round(o * 100)}%`}</option>)}
      </select>
      <select aria-label="When" value={p.when} onChange={(ev) => set({ ...p, when: ev.target.value as PictureWhen })} className="rounded border px-1 py-0.5" style={selectStyle}>
        {(Object.keys(PICTURE_WHEN_WORDS) as PictureWhen[]).map((w) => <option key={w} value={w}>{PICTURE_WHEN_WORDS[w]}</option>)}
      </select>
      {p.when === 'say' && <input value={p.say} onChange={(ev) => set({ ...p, say: ev.target.value.slice(0, 60) })} placeholder="the words, e.g. link below" className="rounded border px-2 py-0.5 w-40 bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />}
      {p.when !== 'whole' && (
        <select aria-label="For how long" value={p.seconds} onChange={(ev) => set({ ...p, seconds: Number(ev.target.value) })} className="rounded border px-1 py-0.5" style={selectStyle}>
          {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>for {n} seconds</option>)}
        </select>
      )}
      <button type="button" onClick={remove} className="underline" style={soft}>Take it off this video</button>
    </div>
  )
}

/** The choices for a video, new or made. */
function Choices({ s, set, onLogo, logoBusy, lib }: { s: EditSettings; set: (s: EditSettings) => void; onLogo: (f: File) => void; logoBusy: boolean; lib: Library }) {
  const ad = s.kind === 'trybe'
  const titleUrl = useTitleUrl(s.title)
  const [titleBad, setTitleBad] = useState(false)
  useEffect(() => setTitleBad(false), [titleUrl])
  const t = s.title
  const setT = (v: Partial<EditSettings['title']>) => set({ ...s, title: { ...t, ...v } })
  const pos = (cur: Position, pick: (p: Position) => void) => (
    <div className="flex flex-wrap gap-1.5 mt-1">{POSITIONS.map((p) => <Chip key={p} on={cur === p} onClick={() => pick(p)}>{POSITION_WORDS[p]}</Chip>)}</div>
  )
  const unused = lib.pictures.filter((u) => !s.pictures.some((p) => p.url === u))
  const full = s.pictures.length >= MAX_PICTURES
  const addPicture = async (f: File) => {
    const url = await lib.add(f)
    if (url && !full) set({ ...s, pictures: [...s.pictures, newPicture(url)] })
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Toggle on={s.broll} set={(v) => set({ ...s, broll: v })} label="B-roll over the talk" hint="Your B-roll shots where you talk about what they show." />
        <Toggle on={s.zooms} set={(v) => set({ ...s, zooms: v })} label="Slow zooms" hint="A slow push in on your strongest points." />
        <Toggle on={s.color} set={(v) => set({ ...s, color: v })} label="Colour boost" hint="A little more colour and contrast." />
        {ad && <Toggle on={s.captions} set={(v) => set({ ...s, captions: v })} label="Captions" hint="Word by word, the way ads are watched with the sound off." />}
      </div>
      {(s.title.on || s.pictures.some((p) => p.on) || (!ad && s.logo?.on)) && (
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>How it sits on your video</p>
          <div className="mt-1"><FramePreview s={s} titleUrl={titleUrl} /></div>
          <p className="text-[11.5px] mt-1" style={soft}>All at once here. On the video, each shows at its own time.</p>
        </div>
      )}
      {!ad && <div>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Logo</p>
        {s.logo ? (
          <div className="mt-1">
            <div className="flex items-center gap-2">
              <img src={s.logo.url} alt="Your logo" className="h-8 w-auto rounded" style={checker} />
              <Toggle on={s.logo.on} set={(v) => set({ ...s, logo: { ...s.logo!, on: v } })} label="Show my logo" />
            </div>
            {s.logo.on && (
              <>
                {pos(s.logo.position, (p) => set({ ...s, logo: { ...s.logo!, position: p } }))}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[12px]" style={soft}>Look:</span>
                  {LOGO_OPACITY.map((o) => <Chip key={o} on={s.logo!.opacity === o} onClick={() => set({ ...s, logo: { ...s.logo!, opacity: o } })}>{o === 1 ? 'Solid' : `See-through ${Math.round(o * 100)}%`}</Chip>)}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[12px]" style={soft}>Size:</span>
                  {LOGO_SIZES.map((z) => <Chip key={z} on={s.logo!.size === z} onClick={() => set({ ...s, logo: { ...s.logo!, size: z } })}>{sizeWords(z)}</Chip>)}
                </div>
                <p className="text-[12px] mt-1" style={soft}>It stays in its corner for the whole video.</p>
              </>
            )}
          </div>
        ) : null}
        <label className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold underline cursor-pointer" style={{ color: PURPLE }}>
          {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} {s.logo ? 'Use another logo' : 'Add your logo (a PNG)'}
          <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = '' }} />
        </label>
      </div>}
      {ad && <p className="text-[12px]" style={soft}>No logo on a TRYBE ad: the brand runs it as its own ad.</p>}
      <div>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>{ad ? 'Hook on screen' : 'Title'}</p>
        <Toggle on={t.on} set={(v) => setT({ on: v })} label={ad ? 'Show the hook as text' : 'Show a title, or a line such as your disclosure'} />
        {t.on && (
          <>
            <input value={t.text} onChange={(e) => setT({ text: e.target.value.slice(0, 80) })} placeholder={ad ? 'Leave empty and MVP writes the hook from what you say' : 'Leave empty and MVP writes it from the product'}
              className="mt-1 w-full max-w-md rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[12px]" style={soft}>Look:</span>
              {TITLE_LOOKS.map((l) => <Chip key={l} on={t.look === l} onClick={() => setT({ look: l })}>{TITLE_LOOK_WORDS[l]}</Chip>)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5" role="group" aria-label="Colour">
              <span className="text-[12px]" style={soft}>Colour:</span>
              {(Object.keys(TITLE_COLORS) as TitleColor[]).map((c) => (
                <button key={c} type="button" onClick={() => setT({ color: c })} aria-pressed={t.color === c} aria-label={c} title={c}
                  className="h-6 w-6 rounded-full border-2" style={{ background: TITLE_COLORS[c], borderColor: t.color === c ? PURPLE : 'var(--border)', boxShadow: t.color === c ? `0 0 0 2px ${PURPLE}` : undefined }} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[12px]" style={soft}>Size:</span>
              {LOGO_SIZES.map((z) => <Chip key={z} on={t.size === z} onClick={() => setT({ size: z })}>{sizeWords(z)}</Chip>)}
            </div>
            <div className="mt-2 rounded-lg p-3 inline-block max-w-full" style={{ background: '#3a3330' }}>
              {titleBad
                ? <p className="text-[12.5px]" style={{ color: '#FCA5A5' }}>The preview could not be drawn. Try another look, or check your connection.</p>
                : <img src={titleUrl} alt={`The title as it will look: ${t.text || 'Your title here'}`} onError={() => setTitleBad(true)} className="max-w-full h-auto" style={{ maxHeight: 90 }} />}
            </div>
            <p className="text-[11.5px] mt-1" style={soft}>This is the picture MVP puts on the video, drawn the same way.</p>
            {pos(t.position, (p) => setT({ position: p }))}
            <label className="text-[12.5px] mt-1 inline-flex items-center gap-2" style={soft}>On screen for
              <select value={t.seconds} onChange={(e) => setT({ seconds: Number(e.target.value) })} className="rounded border px-1 py-0.5" style={selectStyle}>
                {TITLE_SECONDS.map((n) => <option key={n} value={n}>{n === 0 ? 'the whole video' : `${n} seconds`}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      <div>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Pictures on screen</p>
        <p className="text-[12px] mt-0.5" style={soft}>Your own PNGs: a badge, an arrow, a sticker. A PNG with a see-through background sits best. Each one you add stays in your library for your next videos. Calls to action are added in Drop, so Amazon gets a clean copy.</p>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {s.pictures.map((p, i) => (
            <PictureRow key={p.url} p={p} set={(v) => set({ ...s, pictures: s.pictures.map((x, j) => (j === i ? v : x)) })} remove={() => set({ ...s, pictures: s.pictures.filter((_, j) => j !== i) })} />
          ))}
        </div>
        {unused.length > 0 && (
          <div className="mt-2">
            <p className="text-[12px]" style={soft}>{full ? `Up to ${MAX_PICTURES} on one video. Take one off to use another.` : 'From your library, tap to put it on this video:'}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {unused.map((u) => (
                <div key={u} className="flex flex-col items-center gap-0.5">
                  <button type="button" disabled={full} onClick={() => set({ ...s, pictures: [...s.pictures, newPicture(u)] })} className="rounded border p-1 disabled:opacity-40" style={{ borderColor: 'var(--border)' }}>
                    <img src={u} alt="A picture from your library" className="h-10 w-auto max-w-[5rem] rounded" style={checker} />
                  </button>
                  <button type="button" onClick={() => void lib.forget(u)} className="text-[11px] underline" style={soft}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <label className={`mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold underline ${full ? 'opacity-50' : 'cursor-pointer'}`} style={{ color: PURPLE }}>
          {lib.busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Add a PNG
          <input type="file" accept="image/png,image/webp" className="hidden" disabled={full || lib.busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPicture(f); e.target.value = '' }} />
        </label>
      </div>
    </div>
  )
}

export default function ReviewEditor() {
  const supabase = createBrowserClient()
  const [edits, setEdits] = useState<EditView[] | null>(null)
  const [needsSql, setNeedsSql] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EditSettings>(DEFAULT_SETTINGS)
  const [review, setReview] = useState<Upl | null>(null)
  const [broll, setBroll] = useState<Upl | null>(null)
  const [product, setProduct] = useState('')
  const [adding, setAdding] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [library, setLibrary] = useState<string[]>([])
  const [picBusy, setPicBusy] = useState(false)
  const [drive, setDrive] = useState<DriveState | null>(null)
  const [picking, setPicking] = useState<'review' | 'broll' | null>(null)
  const seeded = useRef(false)

  // GOOGLE DRIVE (Seb, 2026-10-30): the takes stay in the creator's Drive.
  const loadDrive = useCallback(async (): Promise<DriveState | null> => {
    try {
      const r = await fetch('/api/review-edit/drive', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      const st: DriveState = r.ok ? d : { connected: false, appId: null, key: null, error: d.error || 'Google Drive could not be checked.' }
      setDrive(st)
      return st
    } catch { setDrive({ connected: false, appId: null, key: null, error: 'Google Drive could not be checked. Check your connection.' }); return null }
  }, [])
  useEffect(() => {
    void loadDrive()
    // Back from Google: say how the connect went, then tidy the address.
    const q = new URLSearchParams(window.location.search)
    if (q.get('drive') === 'connected') toast.success('Google Drive is connected. Choose your takes from it below.')
    const bad = q.get('drive_error') || (q.get('youtube_error') ? `Google did not connect Drive (${q.get('youtube_error')}). Press Connect Google Drive again.` : null)
    if (bad) toast.error(bad, { duration: 15000 })
    if (q.has('drive') || q.has('drive_error') || q.has('youtube_error')) window.history.replaceState(null, '', window.location.pathname)
  }, [loadDrive])

  const fromDrive = async (kind: 'review' | 'broll') => {
    setPicking(kind)
    try {
      // A fresh token each time: the last one may be over an hour old.
      const st = await loadDrive()
      if (!st?.connected || !st.token) { toast.error(st?.error || 'Connect Google Drive first.'); return }
      if (!st.appId) { toast.error('MVP’s Google project number is missing, so the picker cannot open.'); return }
      const f = await pickFromDrive({ token: st.token, appId: st.appId, key: st.key, title: kind === 'review' ? 'Choose your talking take' : 'Choose your B-roll take' })
      if (!f) return
      if (!f.mimeType.startsWith('video/')) { toast.error(`${f.name} is not a video.`); return }
      const set = kind === 'review' ? setReview : setBroll
      set({ name: f.name, bytes: f.bytes ?? 0, sent: f.bytes ?? 0, url: null, driveId: f.id, error: null })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Google’s picker did not open.') } finally { setPicking(null) }
  }
  const disconnectDrive = async () => {
    if (!confirm('Disconnect Google Drive? Videos already in the queue from Drive will stop until you connect it again.')) return
    await fetch('/api/review-edit/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect' }) })
    await loadDrive()
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/review-edit', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setNeedsSql(!!d.needsSql); setLoadError(d.error || 'Your videos could not be read.'); return }
      setLoadError(null); setNeedsSql(false)
      setEdits(d.edits || [])
      if (Array.isArray(d.pictures)) setLibrary(d.pictures)
      if (!seeded.current && d.defaults) { setSettings(d.defaults); seeded.current = true }
    } catch { setLoadError('Your videos could not be read. Check your connection.') }
  }, [])
  useEffect(() => { void load() }, [load])
  // While anything is moving, look again every ten seconds.
  const busy = (edits || []).some((e) => STATUS[e.status]?.busy)
  useEffect(() => { if (!busy) return; const t = setInterval(() => void load(), 10_000); return () => clearInterval(t) }, [busy, load])

  const upload = async (file: File, kind: 'review' | 'broll') => {
    const setU = kind === 'review' ? setReview : setBroll
    if (!file.type.startsWith('video/')) { toast.error('That is not a video file.'); return }
    if (file.size > BULK_VIDEO_MAX_BYTES) { setU({ name: file.name, bytes: file.size, sent: 0, url: null, error: `${mb(file.size)} is over the ${mb(BULK_VIDEO_MAX_BYTES)} limit. Film at 1080p, or keep the take shorter.` }); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the take.'); return }
    setU({ name: file.name, bytes: file.size, sent: 0, url: null, error: null })
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
    let path = `${user.id}/source-edit-${crypto.randomUUID()}.${ext}`
    const type = file.type || 'video/mp4'
    try {
      try {
        await uploadResumable({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          getAccessToken: (force) => freshAccessToken(supabase, force), bucket: 'instagram-videos', path, file, contentType: type,
          onProgress: ({ sent }) => setU((u) => (u ? { ...u, sent } : u)),
        })
      } catch (e) {
        if (!(e instanceof ResumableUnavailable)) throw e
        path = `${user.id}/source-edit-${crypto.randomUUID()}.${ext}`
        const token = await freshAccessToken(supabase, true)
        if (!token) throw new Error('Signed out during the upload. Sign in again and add it again.')
        await uploadWithProgress({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
          bucket: 'instagram-videos', path, file, contentType: type, onProgress: ({ sent }) => setU((u) => (u ? { ...u, sent } : u)),
        })
      }
      const url = supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      setU((u) => (u ? { ...u, sent: file.size, url } : u))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The upload failed.'
      setU((u) => (u ? { ...u, error: storageSizeRefusal(msg, file.size) || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and add it again.' : msg) } : u))
    }
  }

  const uploadLogo = async (file: File, then: (url: string) => void) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the logo.'); return }
    if (file.size > 5 * 1048576) { toast.error('That logo is over 5 MB.'); return }
    setLogoBusy(true)
    try {
      const path = `${user.id}/logo-${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`
      const { error } = await supabase.storage.from('instagram-videos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      then(supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl)
    } catch (e) { toast.error(`The logo was not saved: ${e instanceof Error ? e.message : 'upload failed'}`) } finally { setLogoBusy(false) }
  }

  // THE PICTURE LIBRARY (Seb, 2026-10-30: "add things to the screen by
  // uploads, like PNGs"): each PNG is kept in the creator's folder as pic-*,
  // for every video after.
  const addPicture = async (file: File): Promise<string | null> => {
    if (!/^image\/(png|webp)$/.test(file.type)) { toast.error('Use a PNG (or WebP), so the see-through parts stay see-through.'); return null }
    if (file.size > 5 * 1048576) { toast.error('That picture is over 5 MB.'); return null }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the picture.'); return null }
    setPicBusy(true)
    try {
      const path = `${user.id}/pic-${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'webp'}`
      const { error } = await supabase.storage.from('instagram-videos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      const url = supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      setLibrary((l) => [url, ...l])
      return url
    } catch (e) { toast.error(`The picture was not saved: ${e instanceof Error ? e.message : 'upload failed'}`); return null } finally { setPicBusy(false) }
  }
  const forgetPicture = async (url: string) => {
    if (!confirm('Delete this picture from your library? Videos already made keep it.')) return
    try { const d = await api({ action: 'forget_picture', url }); if (Array.isArray(d.pictures)) setLibrary(d.pictures) } catch (e) { toast.error(e instanceof Error ? e.message : 'Not deleted.') }
  }
  const lib: Library = { pictures: library, busy: picBusy, add: addPicture, forget: forgetPicture }

  const ready = (u: Upl | null) => !!u && !u.error && (!!u.url || !!u.driveId)
  const asTake = (u: Upl) => (u.driveId ? { driveId: u.driveId, name: u.name, bytes: u.bytes } : { url: u.url, name: u.name, bytes: u.bytes })
  const add = async () => {
    if (!review || !ready(review)) return
    setAdding(true)
    try {
      await api({ action: 'add', name: review.name.replace(/\.[^.]+$/, ''), review: asTake(review), broll: broll && ready(broll) ? asTake(broll) : undefined, product, settings })
      toast.success('Added. MVP works on it in the background; you can add the next one now.')
      setReview(null); setBroll(null); setProduct('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not added.') } finally { setAdding(false) }
  }

  const progress = (u: Upl | null) => !u ? null : u.error
    ? <p className="text-[12.5px] mt-1" style={{ color: RED }}>{u.name}: {u.error}</p>
    : u.driveId ? <p className="text-[12.5px] mt-1 inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> {u.name}, from Google Drive{u.bytes ? ` (${mb(u.bytes)})` : ''}. It stays in your Drive.</p>
    : u.url ? <p className="text-[12.5px] mt-1 inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> {u.name} is up ({mb(u.bytes)})</p>
    : <p className="text-[12.5px] mt-1 inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Uploading {u.name}: {Math.round((u.sent / Math.max(1, u.bytes)) * 100)}%</p>
  const uploading = (review && !ready(review) && !review.error) || (broll && !ready(broll) && !broll.error)
  // Each take: from Google Drive (when connected), or uploaded from this computer.
  const takeButtons = (kind: 'review' | 'broll') => {
    const cur = kind === 'review' ? review : broll
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        {drive?.connected && (
          <button type="button" onClick={() => void fromDrive(kind)} disabled={!!picking}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#1a73e8' }}>
            {picking === kind ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />} {cur ? 'Choose another from Google Drive' : 'Choose from Google Drive'}
          </button>
        )}
        <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          {kind === 'review' ? <UploadCloud size={14} /> : <Film size={14} />} {drive?.connected ? 'Or upload from this computer' : cur ? 'Choose another' : 'Upload from this computer'}
          <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, kind); e.target.value = '' }} />
        </label>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold flex items-center gap-2"><Clapperboard size={20} /> Review editor
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--text-3)' }}>Labs</span></h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--text-2)' }}>
          Film your talking in one take and your B-roll in another, then add them here. MVP cuts the mistakes and long pauses, puts your B-roll where you talk about it, and makes the video. Add a whole batch tonight and they are ready in the morning.
        </p>
      </div>

      <details className={card} style={cardStyle}>
        <summary className="text-[13.5px] font-semibold cursor-pointer">How to shoot it</summary>
        <ul className="text-[13px] mt-2 flex flex-col gap-1.5 list-disc pl-5" style={{ color: 'var(--text-2)' }}>
          <li><b>Talk it through in one go.</b> Prop up your phone or camera. Made a mistake? Pause, and say the sentence again. MVP keeps the last good try.</li>
          <li><b>The B-roll:</b> a second take of just the product, without stopping. Hold each shot three to five seconds: the front, the details, it in use.</li>
          <li><b>An Amazon and YouTube review</b> is filmed sideways (landscape), at a talking pace. Its Shorts, TikTok and Reels come from the finished review later, through Drop.</li>
          <li><b>A TRYBE ad</b> is filmed upright (portrait). It is an ad the brand runs, not a review: open on the hook, keep it tight, and film the B-roll upright too.</li>
          <li>1080p is plenty. Each file can be up to {mb(BULK_VIDEO_MAX_BYTES)}.</li>
        </ul>
      </details>

      {needsSql && <p className="text-[13px] rounded-xl border p-3" style={{ borderColor: AMBER, color: AMBER }}>{loadError}</p>}

      <section className={card} style={cardStyle} aria-label="Add a video">
        <p className="text-[15px] font-bold mb-2">Add a video</p>
        <div className="rounded-xl border p-3 mb-3 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <HardDrive size={16} style={{ color: '#1a73e8' }} />
          {drive === null ? <span className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Checking Google Drive</span>
            : drive.connected ? (
              <>
                <span className="text-[13px]"><b>Google Drive is connected</b>{drive.email ? ` as ${drive.email}` : ''}. Your takes stay in your Drive; MVP opens only the files you choose.</span>
                <button type="button" onClick={() => void disconnectDrive()} className="text-[12px] underline" style={soft}>Disconnect</button>
              </>
            ) : (
              <>
                <span className="text-[13px] flex-1 min-w-[14rem]">{drive.needsSql ? drive.error : <>Keep your takes in <b>Google Drive</b> and choose them here. MVP opens only the files you choose, nothing else in your Drive.{drive.error ? <span className="block text-[12px]" style={{ color: AMBER }}>{drive.error}</span> : null}</>}</span>
                {!drive.needsSql && <a href="/api/auth/google-drive" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: '#1a73e8' }}>Connect Google Drive</a>}
              </>
            )}
        </div>
        {drive?.connected && <DriveBatch drive={drive} loadDrive={loadDrive} settings={settings} onAdded={load} />}
        {drive?.connected && <p className="text-[14px] font-bold mb-2 mt-1">Or add one video</p>}
        <p className="text-[13px] font-semibold">1. What is this video for?</p>
        <div className="grid sm:grid-cols-2 gap-2 mt-1 mb-3" role="group" aria-label="What this video is for">
          {(['review', 'trybe'] as VideoKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setSettings((s) => cleanSettings({ ...s, kind: k, captions: k === 'trybe' ? true : s.captions }, s))} aria-pressed={settings.kind === k}
              className="text-left rounded-xl border p-3" style={settings.kind === k ? { borderColor: PURPLE, background: 'rgba(124,58,237,0.08)' } : { borderColor: 'var(--border)' }}>
              <p className="text-[13.5px] font-bold" style={settings.kind === k ? { color: PURPLE } : undefined}>{KIND_WORDS[k].name}</p>
              <p className="text-[12px] mt-0.5" style={soft}>{KIND_WORDS[k].line}</p>
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[13px] font-semibold">2. Your talking take <span className="font-normal" style={soft}>({settings.kind === 'trybe' ? 'filmed upright' : 'filmed sideways'})</span></p>
            {takeButtons('review')}
            {progress(review)}
          </div>
          <div>
            <p className="text-[13px] font-semibold">3. Your B-roll take <span className="font-normal" style={soft}>(optional)</span></p>
            {takeButtons('broll')}
            {progress(broll)}
          </div>
        </div>
        <div className="mt-3">
          <p className="text-[13px] font-semibold">4. The product <span className="font-normal" style={soft}>(optional: {settings.kind === 'trybe' ? 'the brand and product' : 'its name or Amazon link'})</span></p>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Bassdash UPF 50 hoodie" className="mt-1 w-full max-w-md rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        </div>
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <Choices s={settings} set={setSettings} lib={lib} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => setSettings((s) => ({ ...s, logo: { url, position: s.logo?.position ?? 'upper-left', on: true, opacity: s.logo?.opacity ?? 1, size: s.logo?.size ?? 'medium' } })))} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void add()} disabled={!ready(review) || !!uploading || adding}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />} Add to the queue
          </button>
          {!review && <span className="text-[12.5px]" style={soft}>Add your talking take first.</span>}
          {uploading && <span className="text-[12.5px]" style={soft}>Waiting for the upload to finish.</span>}
        </div>
      </section>

      <section aria-label="Your videos" className="flex flex-col gap-3">
        <p className="text-[15px] font-bold">Your videos</p>
        {loadError && !needsSql && <p className="text-[13px]" style={{ color: RED }}>{loadError}</p>}
        {edits === null && !loadError && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your videos</p>}
        {edits?.length === 0 && <p className="text-[13px]" style={soft}>None yet. Add your first one above.</p>}
        {(edits || []).map((e) => <EditCard key={e.id} e={e} reload={load} uploadLogo={uploadLogo} logoBusy={logoBusy} lib={lib} />)}
      </section>
    </div>
  )
}

function EditCard({ e, reload, uploadLogo, logoBusy, lib }: { e: EditView; reload: () => Promise<void>; uploadLogo: (f: File, then: (url: string) => void) => Promise<void>; logoBusy: boolean; lib: Library }) {
  const st = STATUS[e.status] || { words: e.status, color: 'var(--text-3)' }
  const [s, setS] = useState<EditSettings>(e.settings)
  const [changed, setChanged] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [work, setWork] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => { if (!changed) setS(e.settings) }, [e.settings, changed])

  const act = async (what: string, body: Record<string, unknown>, ok?: string) => {
    setWork(what)
    try {
      const d = await api(body)
      if (d.said) setSaid(d.said)
      if (ok) toast.success(ok)
      await reload()
      return d
    } catch (err) { toast.error(err instanceof Error ? err.message : 'That did not work.'); return null } finally { setWork(null) }
  }
  const save = async () => { const d = await act('save', { action: 'change', id: e.id, settings: s }); if (d) setChanged(false); return !!d }
  const makeAgain = async () => { if (changed && !(await save())) return; await act('make', { action: 'make', id: e.id }, 'In line to be made again.') }
  const sendToDrop = async () => {
    if (!e.outputs) return
    setWork('drop')
    try {
      const r = await fetch('/api/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft_start', name: 'Drop' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.id) throw new Error(d.error || 'Drop did not open.')
      for (const f of Object.keys(e.outputs) as Format[]) {
        const o = e.outputs[f]!
        const ar = await fetch('/api/drop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'draft_add', dropId: d.id, item: { fileName: `${e.name || 'Review'} (${f}).mp4`, sourceUrl: o.url, mimeType: 'video/mp4', durationSeconds: o.seconds, width: f === 'wide' ? 1920 : 1080, height: f === 'wide' ? 1080 : 1920, kind: f === 'wide' ? 'long' : 'vertical', asin: e.product || undefined, title: e.name || undefined } }),
        })
        const ad = await ar.json().catch(() => ({}))
        if (!ar.ok) throw new Error(ad.error || 'Drop did not take it.')
      }
      toast.success(e.settings.kind === 'trybe'
        ? <span>In your Drop. <a href="/drop" className="underline font-semibold">Open Drop</a> and pick the TRYBE brand it is for.</span>
        : <span>In your Drop. <a href="/drop" className="underline font-semibold">Open Drop</a> to send it to Amazon and YouTube, and to make its Shorts, TikTok and Reels.</span>, { duration: 12000 })
    } catch (err) { toast.error(`Not sent to Drop: ${err instanceof Error ? err.message : 'unknown'}`) } finally { setWork(null) }
  }
  const outs = (Object.entries(e.outputs || {}) as [Format, { url: string; seconds: number }][])

  return (
    <article className={card} style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14.5px] font-bold">{e.name || 'Review'}</p>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{KIND_WORDS[e.settings.kind].name}</span>
        <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ color: st.color, background: 'var(--surface-2)' }}>
          {st.busy && <Loader2 size={11} className="animate-spin" />}{e.status === 'done' && <Check size={11} />}{e.status === 'failed' && <AlertTriangle size={11} />} {st.words}
        </span>
        <span className="text-[11.5px]" style={soft}>added {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      {e.note && <p className="text-[12.5px] mt-1" style={{ color: e.status === 'failed' ? RED : 'var(--text-2)' }}>{e.note}</p>}
      {/* WHAT THE SERVER IS DOING, SAID (Seb, 2026-10-30: "I don't know if it's
          stuck somewhere"): its step and how far, or that it does not have it. */}
      {e.status === 'making' && e.onServer && (
        <p className="mt-1 text-[12.5px] font-semibold" style={{ color: 'missing' in e.onServer ? AMBER : PURPLE }}>
          {'missing' in e.onServer
            ? 'The video server does not have this one right now. MVP sends it again within a few minutes.'
            : serverWords(e.onServer)}
        </p>
      )}
      {/* HOW LONG, SAID (Seb, 2026-10-30: "How long is this supposed to take?"). */}
      {st.busy && (() => {
        const mins = Math.max(0, Math.floor((Date.now() - Date.parse(e.since)) / 60_000))
        const normal = e.status === 'reading' ? 'Reading takes 1 to 3 minutes.' : e.status === 'making' ? 'Making takes 2 to 10 minutes, longer for a long or 4K take.' : 'It starts when the videos before it are done.'
        const stuck = (e.status === 'reading' || e.status === 'making') && mins >= 20
        return (
          <div className="mt-1 text-[12px]" style={{ color: stuck ? AMBER : 'var(--text-3)' }}>
            {mins < 1 ? 'This step just started.' : `This step started ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago.`} {normal}
            {stuck && (
              <>
                {' '}That is far longer than it should take.{' '}
                <button type="button" onClick={() => void act('retry', { action: 'retry', id: e.id }, 'Started again.')} disabled={!!work} className="underline font-semibold" style={{ color: PURPLE }}>Start it again</button>
              </>
            )}
          </div>
        )
      })()}

      {e.status === 'done' && outs.length > 0 && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {outs.map(([f, o]) => (
            <div key={f}>
              <p className="text-[12px] font-semibold mb-1" style={soft}>{FORMAT_WORDS[f]}</p>
              <video src={o.url} controls preload="metadata" className="w-full rounded-lg bg-black" style={{ maxHeight: 360 }} />
              <a href={o.url} download className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold underline" style={{ color: PURPLE }}><Download size={12} /> Download</a>
            </div>
          ))}
        </div>
      )}
      {/* WHAT IS ON THE VIDEO, AS MADE: a title that could not be drawn or a
          picture waiting for words never said shows as missing, not as done. */}
      {(e.status === 'done' || e.status === 'making') && e.placed && (e.placed.title || e.placed.pictures.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
          {e.placed.title && ('missed' in e.placed.title
            ? <li className="inline-flex items-center gap-1.5" style={{ color: AMBER }}><AlertTriangle size={12} /> {e.placed.title.missed}</li>
            : <li>{e.settings.kind === 'trybe' ? 'Hook' : 'Title'} on screen {clock(e.placed.title.from)} to {clock(e.placed.title.to)}</li>)}
          {e.placed.pictures.map((p) => (
            <li key={p.k} className="inline-flex items-center gap-1.5">
              <img src={p.url} alt="" className="h-5 w-auto rounded" style={checker} />
              {'missed' in p ? <span style={{ color: AMBER }}>{p.missed}</span> : <span>On screen {clock(p.from)} to {clock(p.to)}</span>}
            </li>
          ))}
        </ul>
      )}
      {e.status === 'done' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void sendToDrop()} disabled={!!work} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
            {work === 'drop' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to Drop
          </button>
          {e.fromDrive && !e.rawInMvp && <span className="text-[12px] self-center" style={soft}>Your takes stay in your Google Drive; MVP kept no copy.</span>}
          {e.rawInMvp && <button type="button" onClick={() => void act('finish', { action: 'finish', id: e.id }, 'Your uploaded takes are deleted. The finished video stays.')} disabled={!!work} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>I am happy with it: delete the uploaded takes</button>}
        </div>
      )}
      {e.status === 'failed' && (
        <button type="button" onClick={() => void act('retry', { action: 'retry', id: e.id }, 'Trying again.')} disabled={!!work || e.rawDeleted} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}><RotateCcw size={13} /> Try again</button>
      )}

      {(e.cuts.length > 0 || e.broll.length > 0) && (
        <details className="mt-3">
          <summary className="text-[13px] font-semibold cursor-pointer">What MVP cut ({e.cuts.filter((c) => !c.restored).length}){e.hasBroll ? ` and where the B-roll went (${e.broll.filter((b) => !b.off).length})` : ''}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {e.cuts.map((c) => (
              <li key={`c${c.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-semibold">{c.at}</span> <span style={{ textDecoration: c.restored ? 'none' : 'line-through', color: 'var(--text-2)' }}>&ldquo;{c.text}&rdquo;</span>
                <span className="block" style={soft}>{c.restored ? 'You put this back.' : c.why}</span>
                <button type="button" disabled={!!work || e.rawDeleted} onClick={() => void act('cut', { action: 'change', id: e.id, ...(c.restored ? { cut: [c.k] } : { restore: [c.k] }) })} className="mt-0.5 underline font-semibold" style={{ color: PURPLE }}>{c.restored ? 'Cut it again' : 'Put it back'}</button>
              </li>
            ))}
            {e.broll.map((b) => (
              <li key={`b${b.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-semibold">{b.at}</span> B-roll: <b>{b.shot}</b>{b.line && <span style={soft}> over &ldquo;{b.line}&rdquo;</span>}
                <button type="button" disabled={!!work || e.rawDeleted} onClick={() => void act('broll', { action: 'change', id: e.id, ...(b.off ? { placementOn: [b.k] } : { placementOff: [b.k] }) })} className="ml-2 underline font-semibold" style={{ color: PURPLE }}>{b.off ? 'Use it' : 'Take it out'}</button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] mt-1" style={soft}>Changes here show once you press Make it again.</p>
        </details>
      )}

      {['done', 'failed', 'ready_to_make'].includes(e.status) && e.cuts !== undefined && (
        <details className="mt-3">
          <summary className="text-[13px] font-semibold cursor-pointer">Change the look</summary>
          <div className="mt-2">
            <Choices s={s} set={(v) => { setS(v); setChanged(true) }} lib={lib} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => { setS((x) => ({ ...x, logo: { url, position: x.logo?.position ?? 'upper-left', on: true, opacity: x.logo?.opacity ?? 1, size: x.logo?.size ?? 'medium' } })); setChanged(true) })} />
          </div>
        </details>
      )}

      {e.status !== 'queued' && e.status !== 'reading' && !e.rawDeleted && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={prompt} onChange={(ev) => setPrompt(ev.target.value)} placeholder={'Tell MVP what to change: "logo top left", "keep the part about the price"'}
              className="flex-1 min-w-[14rem] rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button type="button" disabled={!prompt.trim() || !!work} onClick={() => void act('prompt', { action: 'change', id: e.id, prompt }).then((d) => { if (d) { setPrompt(''); setChanged(false) } })}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>
              {work === 'prompt' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Change it
            </button>
          </div>
          {said && <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>MVP: {said}</p>}
          {e.status !== 'making' && (
            <button type="button" onClick={() => void makeAgain()} disabled={!!work} className="self-start inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {work === 'make' || work === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />} Make it again{changed ? ' with your changes' : ''}
            </button>
          )}
        </div>
      )}
      {e.rawDeleted && e.status === 'done' && <p className="text-[12px] mt-2" style={soft}>The raw takes are deleted, so this one cannot be changed now. The finished video stays for 30 days.</p>}
      <button type="button" onClick={() => { if (confirm('Remove this video, its takes and its finished files?')) void act('remove', { action: 'remove', id: e.id }, 'Removed.') }} disabled={!!work || e.status === 'making'} className="mt-3 inline-flex items-center gap-1 text-[12px] underline" style={soft}><Trash2 size={12} /> Remove</button>
    </article>
  )
}
