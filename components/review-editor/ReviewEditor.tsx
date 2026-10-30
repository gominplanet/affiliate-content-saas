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
//
// THE PAGE IN THREE PARTS (Seb, 2026-10-30: "Can we clean this up?"):
//   1. Your look: the logo, title, pictures and edit choices, set and saved
//      once (migration 462), shown as a short summary until edited.
//   2. Add videos: a batch from Google Drive, or one video.
//   3. Your videos: one card each, its state in one line, the finished video
//      with Send to Drop beside it, and everything to change folded away.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud, Check, AlertTriangle, Film, Scissors, Clapperboard, Download, Send, Trash2, RotateCcw, Wand2, ImagePlus, HardDrive, Pencil, ChevronDown, Layers } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { pickFromDrive, type DriveState } from '@/components/review-editor/drive-picker'
import DriveBatch from '@/components/review-editor/DriveBatch'
import {
  DEFAULT_SETTINGS, FORMAT_WORDS, KIND_WORDS, LOGO_OPACITY, LOGO_SIZES, LOGO_WHEN_WORDS, LOGO_WIDTH, MAX_PICTURES, SHOW_SECONDS, PICTURE_WHEN_WORDS, PICTURE_WIDTH, POSITIONS, POSITION_WORDS, SPOTS,
  TITLE_COLORS, TITLE_LOOKS, TITLE_LOOK_WORDS, TITLE_SECONDS, clock, cleanSettings,
  type EditSettings, type Format, type LogoSize, type LogoWhen, type Picture, type PictureTime, type PictureWhen, type Position, type Spot, type TitleColor, type VideoKind,
} from '@/lib/review-edit'

const PURPLE = '#7C3AED'
const GREEN = '#15803D'
const AMBER = '#B45309'
const RED = '#B91C1C'
const BLUE = '#1a73e8'
const soft = { color: 'var(--text-3)' }
const card = 'rounded-2xl border p-4 sm:p-5'
const cardStyle = { borderColor: 'var(--border-2)', background: 'var(--surface)' }
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
  brollCheck: { fits: boolean; talk: string; shows: string } | null
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
      style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>{children}</button>
  )
}

function Toggle({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5" style={{ accentColor: PURPLE }} />
      <span><b className="font-semibold">{label}</b>{hint && <span className="block text-[12px]" style={soft}>{hint}</span>}</span>
    </label>
  )
}

/** A labelled group of choices, with a line under the one above. */
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-t first:border-t-0 first:pt-0" style={{ borderColor: 'var(--border-2)' }}>
      <p className="text-[13.5px] font-bold">{title}</p>
      {note && <p className="text-[12px] mt-0.5" style={soft}>{note}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** A row of choices with its label in front. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <span className="text-[12px] w-16 shrink-0" style={soft}>{label}</span>
      {children}
    </div>
  )
}

/** The creator's picture library, shared by every video's choices. */
interface Library { pictures: string[]; busy: boolean; add: (f: File) => Promise<string | null>; forget: (url: string) => Promise<void> }
const checker = { background: 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 12px 12px' }
const newPicture = (url: string): Picture => ({ url, on: true, position: 'lower-right', size: 'medium', opacity: 1, when: 'whole', seconds: SHOW_SECONDS, say: '' })
const sizeWords = (z: LogoSize) => (z === 'small' ? 'Small' : z === 'medium' ? 'Medium' : 'Large')
const selectStyle = { borderColor: 'var(--border-2)', background: 'var(--surface)', color: 'var(--text)' }
const inputCls = 'w-full rounded-lg border px-3 py-1.5 text-[13px] bg-transparent'
const inputStyle = { borderColor: 'var(--border-2)', color: 'var(--text)' }

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
function FramePreview({ s, titleUrl, vertical }: { s: EditSettings; titleUrl: string; vertical: boolean }) {
  const [titleW, setTitleW] = useState<number | null>(null)
  const share = titleW ? Math.min(0.9, Math.max(0.1, titleW / 1920)) : 0.4
  const logo = !vertical && s.logo?.on ? s.logo : null
  const pics = s.pictures.filter((p) => p.on)
  return (
    <div className="relative overflow-hidden rounded-lg mx-auto" aria-label="How it sits on your video"
      style={{ width: vertical ? 160 : '100%', aspectRatio: vertical ? '9 / 16' : '16 / 9', background: 'radial-gradient(circle at 35% 40%, #cdb8a0, #7d6a5c 55%, #2b2623)' }}>
      {pics.map((p, i) => <img key={i} src={p.url} alt="" style={spotStyle(p.position, PICTURE_WIDTH[p.size][vertical ? 'vertical' : 'wide'], p.opacity)} />)}
      {logo && <img src={logo.url} alt="" style={spotStyle(logo.position, LOGO_WIDTH[logo.size].wide, logo.opacity)} />}
      {s.title.on && <img src={titleUrl} alt="" onLoad={(ev) => setTitleW(ev.currentTarget.naturalWidth)} style={spotStyle(s.title.position, vertical ? Math.min(0.9, share * 1.5) : share)} />}
    </div>
  )
}

/** One picture on this video: where, how big, how solid, and when. */
function PictureRow({ p, set, remove }: { p: Picture; set: (p: Picture) => void; remove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border-2)' }}>
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
      {p.when === 'say' && <input value={p.say} onChange={(ev) => set({ ...p, say: ev.target.value.slice(0, 60) })} placeholder="the words, e.g. link below" className="rounded border px-2 py-0.5 w-40 bg-transparent" style={inputStyle} />}
      {p.when !== 'whole' && (
        <select aria-label="For how long" value={p.seconds} onChange={(ev) => set({ ...p, seconds: Number(ev.target.value) })} className="rounded border px-1 py-0.5" style={selectStyle}>
          {[2, 3, 4, 5, 6, 8, 10, 15].map((n) => <option key={n} value={n}>for {n} seconds</option>)}
        </select>
      )}
      <button type="button" onClick={remove} className="underline ml-auto" style={soft}>Take it off</button>
    </div>
  )
}

/** The logo, title and pictures in a few words each, for the look's summary. */
function lookLines(s: EditSettings): { label: string; value: string }[] {
  const op = (o: number) => (o === 1 ? 'solid' : `see-through ${Math.round(o * 100)}%`)
  const logo = !s.logo ? 'None added' : !s.logo.on ? 'Off'
    : `${POSITION_WORDS[s.logo.position]}, ${op(s.logo.opacity)}, ${s.logo.when === 'whole' ? 'the whole video' : s.logo.when === 'start' ? `the first ${s.logo.seconds} seconds` : `the last ${s.logo.seconds} seconds`}`
  const t = s.title
  const title = !t.on ? 'Off'
    : `${TITLE_LOOK_WORDS[t.look]}, ${t.color}, ${POSITION_WORDS[t.position].toLowerCase()}, ${t.seconds === 0 ? 'the whole video' : `${t.seconds} seconds`}${t.text ? `: “${t.text}”` : ', written by MVP for each video'}`
  const pics = s.pictures.filter((p) => p.on).length
  const edit = [s.broll ? 'B-roll on' : 'B-roll off', s.color ? 'colour boost on' : 'colour boost off', s.zooms ? 'slow zooms on' : 'slow zooms off', s.captions ? 'captions on TRYBE ads' : 'no captions'].join(', ')
  return [
    { label: 'Logo', value: logo },
    { label: 'Title', value: title },
    { label: 'Pictures', value: pics ? `${pics} on every video` : 'None' },
    { label: 'Editing', value: edit.charAt(0).toUpperCase() + edit.slice(1) },
  ]
}

/** The choices for a video, or for the look every new video starts from
 *  (kind null: both a review and a TRYBE ad). The preview sits beside them. */
function Choices({ s, set, onLogo, logoBusy, lib, kind }: { s: EditSettings; set: (s: EditSettings) => void; onLogo: (f: File) => void; logoBusy: boolean; lib: Library; kind: VideoKind | null }) {
  const ad = kind === 'trybe'
  const titleUrl = useTitleUrl(s.title)
  const [titleBad, setTitleBad] = useState(false)
  useEffect(() => setTitleBad(false), [titleUrl])
  const t = s.title
  const setT = (v: Partial<EditSettings['title']>) => set({ ...s, title: { ...t, ...v } })
  const pos = (cur: Position, pick: (p: Position) => void) => (
    <div className="flex flex-wrap gap-1.5">{POSITIONS.map((p) => <Chip key={p} on={cur === p} onClick={() => pick(p)}>{POSITION_WORDS[p]}</Chip>)}</div>
  )
  const unused = lib.pictures.filter((u) => !s.pictures.some((p) => p.url === u))
  const full = s.pictures.length >= MAX_PICTURES
  const addPicture = async (f: File) => {
    const url = await lib.add(f)
    if (url && !full) set({ ...s, pictures: [...s.pictures, newPicture(url)] })
  }
  const anything = s.title.on || s.pictures.some((p) => p.on) || (!ad && s.logo?.on)
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div>
        <Group title="Editing">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <Toggle on={s.broll} set={(v) => set({ ...s, broll: v })} label="B-roll over the talk" hint="Your B-roll shots where you talk about what they show." />
            <Toggle on={s.color} set={(v) => set({ ...s, color: v })} label="Colour boost" hint="A little more colour and contrast." />
            <Toggle on={s.zooms} set={(v) => set({ ...s, zooms: v })} label="Slow zooms" hint="A slow push in on your strongest points." />
            {kind !== 'review' && <Toggle on={s.captions} set={(v) => set({ ...s, captions: v })} label={kind === null ? 'Captions on TRYBE ads' : 'Captions'} hint="Word by word, the way ads are watched with the sound off." />}
          </div>
        </Group>

        {!ad && (
          <Group title="Logo" note={kind === null ? 'On reviews. A TRYBE ad never carries it: the brand runs it as its own ad.' : undefined}>
            {s.logo && (
              <div className="flex items-center gap-3">
                <img src={s.logo.url} alt="Your logo" className="h-9 w-auto rounded" style={checker} />
                <Toggle on={s.logo.on} set={(v) => set({ ...s, logo: { ...s.logo!, on: v } })} label="Show my logo" />
              </div>
            )}
            {s.logo?.on && (
              <>
                <Row label="Where">{pos(s.logo.position, (p) => set({ ...s, logo: { ...s.logo!, position: p } }))}</Row>
                <Row label="Look">{LOGO_OPACITY.map((o) => <Chip key={o} on={s.logo!.opacity === o} onClick={() => set({ ...s, logo: { ...s.logo!, opacity: o } })}>{o === 1 ? 'Solid' : `See-through ${Math.round(o * 100)}%`}</Chip>)}</Row>
                <Row label="Size">{LOGO_SIZES.map((z) => <Chip key={z} on={s.logo!.size === z} onClick={() => set({ ...s, logo: { ...s.logo!, size: z } })}>{sizeWords(z)}</Chip>)}</Row>
                <Row label="When">
                  {(Object.keys(LOGO_WHEN_WORDS) as LogoWhen[]).map((w) => <Chip key={w} on={s.logo!.when === w} onClick={() => set({ ...s, logo: { ...s.logo!, when: w } })}>{w === 'whole' ? LOGO_WHEN_WORDS.whole : w === 'start' ? `The first ${s.logo!.seconds} seconds` : `The last ${s.logo!.seconds} seconds`}</Chip>)}
                  {s.logo.when !== 'whole' && (
                    <select aria-label="How many seconds" value={s.logo.seconds} onChange={(ev) => set({ ...s, logo: { ...s.logo!, seconds: Number(ev.target.value) } })} className="rounded border px-1 py-0.5 text-[12.5px]" style={selectStyle}>
                      {[3, 4, 5, 6, 8, 10, 15].map((n) => <option key={n} value={n}>{n} seconds</option>)}
                    </select>
                  )}
                </Row>
                <p className="text-[12px] mt-2" style={soft}>{s.logo.when === 'whole' ? 'It stays in its corner for the whole video.' : s.logo.when === 'start' ? `It shows for the first ${s.logo.seconds} seconds, then goes.` : `It comes in for the last ${s.logo.seconds} seconds.`} Untick Show my logo for none.</p>
              </>
            )}
            <label className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold underline cursor-pointer" style={{ color: PURPLE }}>
              {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} {s.logo ? 'Use another logo' : 'Add your logo (a PNG)'}
              <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = '' }} />
            </label>
          </Group>
        )}

        <Group title={ad ? 'Hook on screen' : 'Title'} note={ad ? undefined : 'A title, or a line such as your disclosure.'}>
          <Toggle on={t.on} set={(v) => setT({ on: v })} label={ad ? 'Show the hook as text' : 'Show it'} />
          {t.on && (
            <>
              <input value={t.text} onChange={(e) => setT({ text: e.target.value.slice(0, 80) })} placeholder={ad ? 'Leave empty and MVP writes the hook from what you say' : 'Leave empty and MVP writes one for each video'}
                className={`mt-2 ${inputCls}`} style={inputStyle} />
              <Row label="Style">{TITLE_LOOKS.map((l) => <Chip key={l} on={t.look === l} onClick={() => setT({ look: l })}>{TITLE_LOOK_WORDS[l]}</Chip>)}</Row>
              <Row label="Colour">
                {(Object.keys(TITLE_COLORS) as TitleColor[]).map((c) => (
                  <button key={c} type="button" onClick={() => setT({ color: c })} aria-pressed={t.color === c} aria-label={c} title={c}
                    className="h-6 w-6 rounded-full border" style={{ background: TITLE_COLORS[c], borderColor: 'var(--border-2)', boxShadow: t.color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${PURPLE}` : undefined }} />
                ))}
              </Row>
              <Row label="Size">{LOGO_SIZES.map((z) => <Chip key={z} on={t.size === z} onClick={() => setT({ size: z })}>{sizeWords(z)}</Chip>)}</Row>
              <Row label="Where">{pos(t.position, (p) => setT({ position: p }))}</Row>
              <Row label="How long">
                <select value={t.seconds} onChange={(e) => setT({ seconds: Number(e.target.value) })} className="rounded border px-1 py-0.5 text-[12.5px]" style={selectStyle}>
                  {TITLE_SECONDS.map((n) => <option key={n} value={n}>{n === 0 ? 'the whole video' : `${n} seconds`}</option>)}
                </select>
              </Row>
            </>
          )}
        </Group>

        <Group title="Pictures on screen" note="Your own PNGs: a badge, an arrow, a second logo. A see-through background sits best. Calls to action are added in Drop, so Amazon gets a clean copy.">
          <div className="flex flex-col gap-1.5">
            {s.pictures.map((p, i) => (
              <PictureRow key={p.url} p={p} set={(v) => set({ ...s, pictures: s.pictures.map((x, j) => (j === i ? v : x)) })} remove={() => set({ ...s, pictures: s.pictures.filter((_, j) => j !== i) })} />
            ))}
          </div>
          {unused.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px]" style={soft}>{full ? `Up to ${MAX_PICTURES} on one video. Take one off to use another.` : 'Your library: tap one to use it.'}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {unused.map((u) => (
                  <div key={u} className="flex flex-col items-center gap-0.5">
                    <button type="button" disabled={full} onClick={() => set({ ...s, pictures: [...s.pictures, newPicture(u)] })} className="rounded border p-1 disabled:opacity-40" style={{ borderColor: 'var(--border-2)' }}>
                      <img src={u} alt="A picture from your library" className="h-10 w-auto max-w-[5rem] rounded" style={checker} />
                    </button>
                    <button type="button" onClick={() => void lib.forget(u)} className="text-[11px] underline" style={soft}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <label className={`mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold underline ${full ? 'opacity-50' : 'cursor-pointer'}`} style={{ color: PURPLE }}>
            {lib.busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Add a PNG
            <input type="file" accept="image/png,image/webp" className="hidden" disabled={full || lib.busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPicture(f); e.target.value = '' }} />
          </label>
        </Group>
      </div>

      {/* THE PREVIEW, BESIDE THE CHOICES: where everything sits, and the
          title drawn by the same code that puts it on the video. */}
      <div className="lg:sticky lg:top-4 flex flex-col gap-2">
        <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Preview</p>
        <FramePreview s={s} titleUrl={titleUrl} vertical={ad} />
        <p className="text-[11.5px]" style={soft}>{anything ? 'All at once here. On the video, each shows at its own time.' : 'Nothing on top of the video yet.'}</p>
        {t.on && (
          <div className="mt-1">
            <div className="rounded-lg p-2.5 flex justify-center" style={{ background: '#3a3330' }}>
              {titleBad
                ? <p className="text-[12.5px]" style={{ color: '#FCA5A5' }}>The preview could not be drawn. Try another style, or check your connection.</p>
                : <img src={titleUrl} alt={`The title as it will look: ${t.text || 'Your title here'}`} onError={() => setTitleBad(true)} className="max-w-full h-auto" style={{ maxHeight: 48 }} />}
            </div>
            <p className="text-[11.5px] mt-1" style={soft}>This is the picture MVP puts on the video, drawn the same way.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReviewEditor() {
  const supabase = createBrowserClient()
  const [edits, setEdits] = useState<EditView[] | null>(null)
  const [needsSql, setNeedsSql] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** The look every new video starts from. */
  const [settings, setSettings] = useState<EditSettings>(DEFAULT_SETTINGS)
  /** The look as last saved, to put back on Cancel and to tell a change. */
  const [savedLook, setSavedLook] = useState<EditSettings | null>(null)
  const [lookSaved, setLookSaved] = useState(false)
  const [lookNeedsSql, setLookNeedsSql] = useState(false)
  const [lookOpen, setLookOpen] = useState(false)
  const [savingLook, setSavingLook] = useState(false)
  const [showTips, setShowTips] = useState(false)
  const [tab, setTab] = useState<'drive' | 'one'>('drive')
  const [kind, setKind] = useState<VideoKind>('review')
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
    if (q.get('drive') === 'connected') toast.success('Google Drive is connected. Choose your A-roll and B-roll folders.')
    const bad = q.get('drive_error') || (q.get('youtube_error') ? `Google did not connect Drive (${q.get('youtube_error')}). Press Connect Google Drive again.` : null)
    if (bad) toast.error(bad, { duration: 15000 })
    if (q.has('drive') || q.has('drive_error') || q.has('youtube_error')) window.history.replaceState(null, '', window.location.pathname)
  }, [loadDrive])

  const fromDrive = async (which: 'review' | 'broll') => {
    setPicking(which)
    try {
      // A fresh token each time: the last one may be over an hour old.
      const st = await loadDrive()
      if (!st?.connected || !st.token) { toast.error(st?.error || 'Connect Google Drive first.'); return }
      if (!st.appId) { toast.error('MVP’s Google project number is missing, so the picker cannot open.'); return }
      const f = await pickFromDrive({ token: st.token, appId: st.appId, key: st.key, title: which === 'review' ? 'Choose your talking take' : 'Choose your B-roll take' })
      if (!f) return
      if (!f.mimeType.startsWith('video/')) { toast.error(`${f.name} is not a video.`); return }
      const set = which === 'review' ? setReview : setBroll
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
      setLookNeedsSql(!!d.lookNeedsSql)
      if (!seeded.current && d.defaults) { setSettings(d.defaults); setSavedLook(d.defaults); setLookSaved(!!d.lookSaved); seeded.current = true }
    } catch { setLoadError('Your videos could not be read. Check your connection.') }
  }, [])
  useEffect(() => { void load() }, [load])
  // While anything is moving, look again every ten seconds.
  const busy = (edits || []).some((e) => STATUS[e.status]?.busy)
  useEffect(() => { if (!busy) return; const t = setInterval(() => void load(), 10_000); return () => clearInterval(t) }, [busy, load])

  // YOUR LOOK, SAVED (migration 462): what every new video starts from.
  const lookChanged = !!savedLook && JSON.stringify(cleanSettings(settings)) !== JSON.stringify(cleanSettings(savedLook))
  const saveLook = async () => {
    setSavingLook(true)
    try {
      const d = await api({ action: 'save_look', settings })
      const next = cleanSettings(d.settings ?? settings)
      setSettings(next); setSavedLook(next); setLookSaved(true); setLookOpen(false)
      toast.success('Your look is saved. Every new video starts with it.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Your look was not saved.') } finally { setSavingLook(false) }
  }
  const cancelLook = () => { if (savedLook) setSettings(savedLook); setLookOpen(false) }

  const upload = async (file: File, which: 'review' | 'broll') => {
    const setU = which === 'review' ? setReview : setBroll
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
  const withLogo = (x: EditSettings, url: string): EditSettings => ({ ...x, logo: { url, position: x.logo?.position ?? 'upper-left', on: true, opacity: x.logo?.opacity ?? 1, size: x.logo?.size ?? 'medium', when: x.logo?.when ?? 'whole', seconds: x.logo?.seconds ?? SHOW_SECONDS } })

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
      const look = cleanSettings({ ...settings, kind }, settings)
      await api({ action: 'add', name: review.name.replace(/\.[^.]+$/, ''), review: asTake(review), broll: broll && ready(broll) ? asTake(broll) : undefined, product, settings: look })
      toast.success('Added. MVP works on it in the background; you can add the next one now.')
      setReview(null); setBroll(null); setProduct('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not added.') } finally { setAdding(false) }
  }

  const uploading = (review && !ready(review) && !review.error) || (broll && !ready(broll) && !broll.error)
  /** One take's box: what is in it, or the buttons to fill it. */
  const takeBox = (which: 'review' | 'broll', label: string, hint: string) => {
    const u = which === 'review' ? review : broll
    const clear = () => (which === 'review' ? setReview(null) : setBroll(null))
    return (
      <div className="rounded-xl border border-dashed p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-2)' }}>
        <p className="text-[13px] font-semibold">{label} <span className="font-normal" style={soft}>{hint}</span></p>
        {u ? (
          u.error ? <p className="text-[12.5px]" style={{ color: RED }}>{u.name}: {u.error}</p>
          : u.driveId ? <p className="text-[12.5px] inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> {u.name}, from Google Drive{u.bytes ? ` (${mb(u.bytes)})` : ''}. It stays in your Drive.</p>
          : u.url ? <p className="text-[12.5px] inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> {u.name} is up ({mb(u.bytes)})</p>
          : <p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Uploading {u.name}: {Math.round((u.sent / Math.max(1, u.bytes)) * 100)}%</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {drive?.connected && (
            <button type="button" onClick={() => void fromDrive(which)} disabled={!!picking}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: BLUE }}>
              {picking === which ? <Loader2 size={13} className="animate-spin" /> : <HardDrive size={13} />} {u ? 'Another from Drive' : 'From Google Drive'}
            </button>
          )}
          <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer" style={{ borderColor: 'var(--border-2)' }}>
            {which === 'review' ? <UploadCloud size={13} /> : <Film size={13} />} {u ? 'Upload another' : 'Upload from this computer'}
            <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, which); e.target.value = '' }} />
          </label>
          {u && <button type="button" onClick={clear} className="text-[12px] underline" style={soft}>Clear</button>}
        </div>
      </div>
    )
  }

  const list = edits || []
  const counts = {
    ready: list.filter((e) => e.status === 'done').length,
    moving: list.filter((e) => STATUS[e.status]?.busy).length,
    stopped: list.filter((e) => e.status === 'failed').length,
  }

  return (
    <div className="max-w-5xl mx-auto px-1 sm:px-4 py-4 flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-bold flex items-center gap-2"><Clapperboard size={20} /> Review editor
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>Labs</span></h1>
        <p className="text-[13.5px] mt-1 max-w-2xl" style={{ color: 'var(--text-2)' }}>
          Your talking take and your B-roll in, a finished review out. MVP cuts the mistakes and dead air, puts your B-roll where you talk about it, and adds your look. Add a batch tonight; it is ready in the morning.{' '}
          <button type="button" onClick={() => setShowTips((v) => !v)} className="underline font-semibold" style={{ color: PURPLE }} aria-expanded={showTips}>How to shoot it</button>
        </p>
        {showTips && (
          <ul className="text-[13px] mt-3 flex flex-col gap-1.5 list-disc pl-5 rounded-xl border p-3 pl-8" style={{ color: 'var(--text-2)', borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
            <li><b>Talk it through in one go.</b> Prop up your phone or camera. Made a mistake? Pause, and say the sentence again. MVP keeps the last good try.</li>
            <li><b>The B-roll:</b> a second take of just the product, without stopping. Hold each shot three to five seconds: the front, the details, it in use.</li>
            <li><b>An Amazon and YouTube review</b> is filmed sideways (landscape). Its Shorts, TikTok and Reels come from the finished review later, through Drop.</li>
            <li><b>A TRYBE ad</b> is filmed upright (portrait). It is an ad the brand runs, not a review: open on the hook, keep it tight, and film the B-roll upright too.</li>
            <li>1080p is plenty. Each file can be up to {mb(BULK_VIDEO_MAX_BYTES)}.</li>
          </ul>
        )}
      </header>

      {needsSql && <p className="text-[13px] rounded-xl border p-3" style={{ borderColor: AMBER, color: AMBER }}>{loadError}</p>}

      {/* 1. YOUR LOOK: set once, saved, shown as a summary until edited. */}
      <section className={card} style={cardStyle} aria-label="Your look">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold">Your look</h2>
            <p className="text-[12.5px] mt-0.5" style={soft}>Every new video starts with this. You can still change any one video after it is made.</p>
          </div>
          {!lookOpen && (
            <button type="button" onClick={() => setLookOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'var(--border-2)' }}>
              <Pencil size={13} /> Edit your look
            </button>
          )}
        </div>
        {!lookOpen ? (
          <div className="mt-4 grid sm:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
            <LookThumb s={settings} />
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              {lookLines(settings).map((l) => (
                <div key={l.label} className="contents">
                  <dt className="font-semibold" style={soft}>{l.label}</dt>
                  <dd style={{ color: 'var(--text-2)' }}>{l.value}</dd>
                </div>
              ))}
            </dl>
            {(!lookSaved || lookNeedsSql) && (
              <p className="sm:col-span-2 text-[12px]" style={{ color: lookNeedsSql ? AMBER : 'var(--text-3)' }}>
                {lookNeedsSql ? 'Saving your look needs migration 462 in Supabase. Until then, new videos start from the last video you added.' : 'Not saved yet: this is the look of the last video you added. Press Edit your look, then Save, to keep it.'}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Choices s={settings} set={setSettings} lib={lib} kind={null} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => setSettings((s) => withLogo(s, url)))} />
            <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border-2)' }}>
              <button type="button" onClick={() => void saveLook()} disabled={savingLook}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
                {savingLook ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save my look
              </button>
              <button type="button" onClick={cancelLook} className="rounded-lg border px-3 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border-2)' }}>Cancel</button>
              <span className="text-[12px]" style={{ color: lookChanged ? AMBER : 'var(--text-3)' }}>{lookChanged ? 'Not saved yet.' : lookSaved ? 'Saved.' : 'Not saved yet.'}</span>
            </div>
          </div>
        )}
      </section>

      {/* 2. ADD VIDEOS: a batch from Google Drive, or one video. */}
      <section className={card} style={cardStyle} aria-label="Add videos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-bold">Add videos</h2>
          <div className="inline-flex rounded-lg border p-0.5" role="tablist" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2)' }}>
            {([['drive', 'A batch from Google Drive'], ['one', 'One video']] as const).map(([k, w]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold"
                style={tab === k ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: 'var(--text-3)' }}>{w}</button>
            ))}
          </div>
        </div>

        {tab === 'drive' && (
          <div className="mt-4">
            {drive === null ? <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Checking Google Drive</p>
              : !drive.connected ? (
                <div className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ borderColor: `${BLUE}40`, background: `${BLUE}08` }}>
                  <HardDrive size={20} style={{ color: BLUE }} />
                  <div className="flex-1 min-w-[14rem]">
                    <p className="text-[13.5px] font-semibold">{drive.needsSql ? 'Google Drive is not set up yet' : 'Connect your Google Drive'}</p>
                    <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>{drive.needsSql ? drive.error : 'Keep your takes in Drive and add a whole batch at once. MVP opens only the files you choose, nothing else in your Drive.'}</p>
                    {drive.error && !drive.needsSql && <p className="text-[12px] mt-1" style={{ color: AMBER }}>{drive.error}</p>}
                  </div>
                  {!drive.needsSql && <a href="/api/auth/google-drive" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white" style={{ background: BLUE }}>Connect Google Drive</a>}
                </div>
              ) : null}
            {drive?.connected && <DriveBatch drive={drive} loadDrive={loadDrive} settings={settings} onAdded={load} />}
            {drive?.connected && (
              <p className="text-[12px] mt-3" style={soft}>
                Google Drive is connected{drive.email ? ` as ${drive.email}` : ''}. Your takes stay in your Drive.{' '}
                <button type="button" onClick={() => void disconnectDrive()} className="underline">Disconnect</button>
              </p>
            )}
          </div>
        )}

        {tab === 'one' && (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <p className="text-[13px] font-semibold">What is this video for?</p>
              <div className="grid sm:grid-cols-2 gap-2 mt-1.5" role="group" aria-label="What this video is for">
                {(['review', 'trybe'] as VideoKind[]).map((k) => (
                  <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                    className="text-left rounded-xl border p-3" style={kind === k ? { borderColor: PURPLE, background: 'rgba(124,58,237,0.07)' } : { borderColor: 'var(--border-2)' }}>
                    <p className="text-[13.5px] font-bold" style={kind === k ? { color: PURPLE } : undefined}>{KIND_WORDS[k].name}</p>
                    <p className="text-[12px] mt-0.5" style={soft}>{KIND_WORDS[k].line}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {takeBox('review', 'Your talking take', kind === 'trybe' ? '(filmed upright)' : '(filmed sideways)')}
              {takeBox('broll', 'Your B-roll take', '(optional)')}
            </div>
            <label className="text-[13px] font-semibold">The product <span className="font-normal" style={soft}>(optional: {kind === 'trybe' ? 'the brand and product' : 'its name or Amazon link'})</span>
              <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Bassdash UPF 50 hoodie" className={`mt-1 max-w-md font-normal ${inputCls}`} style={inputStyle} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void add()} disabled={!ready(review) || !!uploading || adding}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />} Add to the queue
              </button>
              <span className="text-[12.5px]" style={soft}>{!review ? 'Add your talking take first.' : uploading ? 'Waiting for the upload to finish.' : 'It uses your look above.'}</span>
            </div>
          </div>
        )}
      </section>

      {/* 3. YOUR VIDEOS */}
      <section aria-label="Your videos" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-bold">Your videos</h2>
          {list.length > 0 && (
            <p className="text-[12.5px]" style={soft}>
              {[counts.ready && `${counts.ready} ready`, counts.moving && `${counts.moving} in progress`, counts.stopped && `${counts.stopped} stopped`].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        {loadError && !needsSql && <p className="text-[13px]" style={{ color: RED }}>{loadError}</p>}
        {edits === null && !loadError && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your videos</p>}
        {edits?.length === 0 && <p className="text-[13px] rounded-2xl border border-dashed p-6 text-center" style={{ ...soft, borderColor: 'var(--border-2)' }}>None yet. Add your first one above.</p>}
        {list.map((e) => <EditCard key={e.id} e={e} reload={load} uploadLogo={uploadLogo} withLogo={withLogo} logoBusy={logoBusy} lib={lib} />)}
      </section>
    </div>
  )
}

/** The look's small preview: logo, title and pictures on a blank frame. */
function LookThumb({ s }: { s: EditSettings }) {
  const titleUrl = useTitleUrl(s.title)
  return <FramePreview s={s} titleUrl={titleUrl} vertical={false} />
}

function EditCard({ e, reload, uploadLogo, withLogo, logoBusy, lib }: {
  e: EditView; reload: () => Promise<void>; uploadLogo: (f: File, then: (url: string) => void) => Promise<void>
  withLogo: (x: EditSettings, url: string) => EditSettings; logoBusy: boolean; lib: Library
}) {
  const st = STATUS[e.status] || { words: e.status, color: 'var(--text-3)' }
  const [s, setS] = useState<EditSettings>(e.settings)
  const [changed, setChanged] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [work, setWork] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
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
  const makeAgain = async () => { if (changed && !(await save())) return; await act('make', { action: 'make', id: e.id }, 'In line to be made again.'); setOpen(false) }
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
  const editable = ['done', 'failed', 'ready_to_make'].includes(e.status) && !e.rawDeleted
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(e.since)) / 60_000))
  const stuck = (e.status === 'reading' || e.status === 'making') && mins >= 20
  const missing = e.status === 'making' && e.onServer && 'missing' in e.onServer
  // ONE LINE FOR WHERE IT IS: the video server's own words while it is being
  // made, the step's note otherwise.
  const line = e.status === 'making' && e.onServer && !('missing' in e.onServer) ? serverWords(e.onServer) : e.note
  const normal = e.status === 'reading' ? 'Reading takes 1 to 3 minutes.' : e.status === 'making' ? 'Making takes 2 to 10 minutes, longer for a long or 4K take.' : 'It starts when the videos before it are done.'
  const footer = editable || e.status === 'failed'
  const remove = (
    <button type="button" onClick={() => { if (confirm('Remove this video, its takes and its finished files?')) void act('remove', { action: 'remove', id: e.id }, 'Removed.') }} disabled={!!work || e.status === 'making'} className="inline-flex items-center gap-1 text-[12px] underline disabled:opacity-40" style={soft}><Trash2 size={12} /> Remove</button>
  )
  const facts = [
    outs[0] ? `${clock(outs[0][1].seconds)} long` : null,
    e.cuts.length ? `${e.cuts.filter((c) => !c.restored).length} cuts` : null,
    e.hasBroll ? `${e.broll.filter((b) => !b.off).length} B-roll moments` : null,
    e.settings.zooms && e.zooms ? `${e.zooms} zooms` : null,
  ].filter(Boolean).join(', ')

  return (
    <article className={card} style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-bold mr-1">{e.name || 'Review'}</p>
        <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ color: st.color, background: 'var(--surface-2)' }}>
          {st.busy && <Loader2 size={11} className="animate-spin" />}{e.status === 'done' && <Check size={11} />}{e.status === 'failed' && <AlertTriangle size={11} />} {st.words}
        </span>
        <span className="text-[11.5px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>{KIND_WORDS[e.settings.kind].name}</span>
        <span className="text-[11.5px] ml-auto" style={soft}>added {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        {/* No other buttons yet: Remove sits up here, and not at all while it is being made. */}
        {!footer && e.status !== 'making' && remove}
      </div>

      {/* WHERE IT IS, IN ONE LINE (Seb, 2026-10-30: "I don't know if it's stuck
          somewhere"), how long the step has run against what is normal, and
          a way to start it again once it is far too long. */}
      {e.status !== 'done' && line && <p className="text-[13px] mt-1.5" style={{ color: e.status === 'failed' ? RED : e.status === 'making' && !missing ? PURPLE : 'var(--text-2)' }}>{line}</p>}
      {e.status === 'done' && e.note && !outs.length && <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-2)' }}>{e.note}</p>}
      {missing && <p className="mt-1 text-[12.5px] font-semibold" style={{ color: AMBER }}>The video server does not have this one right now. MVP sends it again within a few minutes.</p>}
      {st.busy && (
        <p className="mt-0.5 text-[12px]" style={{ color: stuck ? AMBER : 'var(--text-3)' }}>
          {mins < 1 ? 'This step just started.' : `This step started ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago.`} {normal}
          {stuck && (
            <>
              {' '}That is far longer than it should take.{' '}
              <button type="button" onClick={() => void act('retry', { action: 'retry', id: e.id }, 'Started again.')} disabled={!!work} className="underline font-semibold" style={{ color: PURPLE }}>Start it again</button>
            </>
          )}
        </p>
      )}

      {/* A B-ROLL OF ANOTHER PRODUCT (a batch paired wrong) is said, and left out until the creator says it is right. */}
      {e.brollCheck && !e.brollCheck.fits && (
        <p className="mt-2 text-[12.5px] flex items-start gap-1.5 rounded-lg p-2.5" style={{ color: AMBER, background: 'rgba(180,83,9,0.07)' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>The B-roll looks like a different product{e.brollCheck.shows ? <>: it shows {e.brollCheck.shows}</> : null}{e.brollCheck.talk ? <>, and you talk about {e.brollCheck.talk}</> : null}. MVP left it out of this video. If it is the right B-roll after all, press Use it on its moments under Edit this video, and Make it again.</span>
        </p>
      )}

      {e.status === 'done' && outs.length > 0 && (
        <div className="mt-3 grid md:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-4 items-start">
          <div className="flex flex-col gap-2">
            {outs.map(([f, o]) => <video key={f} src={o.url} controls preload="metadata" className="w-full rounded-lg bg-black" style={{ maxHeight: 380 }} aria-label={FORMAT_WORDS[f]} />)}
          </div>
          <div className="flex flex-col gap-2.5">
            <button type="button" onClick={() => void sendToDrop()} disabled={!!work} className="self-start inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {work === 'drop' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to Drop
            </button>
            {outs.map(([f, o]) => <a key={f} href={o.url} download className="self-start inline-flex items-center gap-1 text-[12.5px] font-semibold underline" style={{ color: PURPLE }}><Download size={12} /> Download{outs.length > 1 ? ` (${FORMAT_WORDS[f]})` : ''}</a>)}
            {facts && <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>{facts}</p>}
            {/* WHAT IS ON THE VIDEO, AS MADE: a title that could not be drawn or a
                picture waiting for words never said shows as missing, not as done. */}
            {e.placed && (e.placed.title || e.placed.pictures.length > 0) && (
              <ul className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
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
            {e.fromDrive && !e.rawInMvp && <p className="text-[12px]" style={soft}>Your takes stay in your Google Drive; MVP kept no copy.</p>}
            {e.rawInMvp && <button type="button" onClick={() => void act('finish', { action: 'finish', id: e.id }, 'Your uploaded takes are deleted. The finished video stays.')} disabled={!!work} className="self-start text-[12px] underline" style={soft}>I am happy with it: delete the uploaded takes</button>}
            {e.rawDeleted && <p className="text-[12px]" style={soft}>The raw takes are deleted, so this one cannot be changed now. The finished video stays for 30 days.</p>}
          </div>
        </div>
      )}
      {e.status === 'making' && e.placed && e.placed.pictures.some((p) => 'missed' in p) && (
        <ul className="mt-2 text-[12px]">{e.placed.pictures.map((p) => ('missed' in p ? <li key={p.k} style={{ color: AMBER }}>{p.missed}</li> : null))}</ul>
      )}

      {footer && <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border-2)' }}>
        {e.status === 'failed' && (
          <button type="button" onClick={() => void act('retry', { action: 'retry', id: e.id }, 'Trying again.')} disabled={!!work || e.rawDeleted} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border-2)' }}><RotateCcw size={13} /> Try again</button>
        )}
        {editable && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border-2)' }}>
            <Pencil size={13} /> Edit this video <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
        <span className="ml-auto">{remove}</span>
      </div>}

      {/* EVERYTHING TO CHANGE, FOLDED AWAY until asked for. */}
      {open && editable && (
        <div className="mt-3 flex flex-col gap-4">
          {(e.cuts.length > 0 || e.broll.length > 0) && (
            <div>
              <p className="text-[13.5px] font-bold">What MVP cut ({e.cuts.filter((c) => !c.restored).length}){e.hasBroll ? ` and where the B-roll went (${e.broll.filter((b) => !b.off).length})` : ''}</p>
              <ul className="mt-2 flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">
                {e.cuts.map((c) => (
                  <li key={`c${c.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border-2)' }}>
                    <span className="font-semibold">{c.at}</span> <span style={{ textDecoration: c.restored ? 'none' : 'line-through', color: 'var(--text-2)' }}>&ldquo;{c.text}&rdquo;</span>
                    <span className="block" style={soft}>{c.restored ? 'You put this back.' : c.why}</span>
                    <button type="button" disabled={!!work} onClick={() => void act('cut', { action: 'change', id: e.id, ...(c.restored ? { cut: [c.k] } : { restore: [c.k] }) })} className="mt-0.5 underline font-semibold" style={{ color: PURPLE }}>{c.restored ? 'Cut it again' : 'Put it back'}</button>
                  </li>
                ))}
                {e.broll.map((b) => (
                  <li key={`b${b.k}`} className="rounded-lg border p-2 text-[12.5px]" style={{ borderColor: 'var(--border-2)' }}>
                    <span className="font-semibold">{b.at}</span> B-roll: <b>{b.shot}</b>{b.line && <span style={soft}> over &ldquo;{b.line}&rdquo;</span>}
                    <button type="button" disabled={!!work} onClick={() => void act('broll', { action: 'change', id: e.id, ...(b.off ? { placementOn: [b.k] } : { placementOff: [b.k] }) })} className="ml-2 underline font-semibold" style={{ color: PURPLE }}>{b.off ? 'Use it' : 'Take it out'}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[13.5px] font-bold mb-2">The look of this video</p>
            <Choices s={s} set={(v) => { setS(v); setChanged(true) }} lib={lib} kind={e.settings.kind} logoBusy={logoBusy} onLogo={(f) => void uploadLogo(f, (url) => { setS((x) => withLogo(x, url)); setChanged(true) })} />
          </div>
          <div>
            <p className="text-[13.5px] font-bold">Or tell MVP</p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              <input value={prompt} onChange={(ev) => setPrompt(ev.target.value)} placeholder={'"logo top left", "keep the part about the price"'}
                className="flex-1 min-w-[14rem] rounded-lg border px-3 py-1.5 text-[13px] bg-transparent" style={inputStyle} />
              <button type="button" disabled={!prompt.trim() || !!work} onClick={() => void act('prompt', { action: 'change', id: e.id, prompt }).then((d) => { if (d) { setPrompt(''); setChanged(false) } })}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border-2)' }}>
                {work === 'prompt' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Change it
              </button>
            </div>
            {said && <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-2)' }}>MVP: {said}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void makeAgain()} disabled={!!work} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
              {work === 'make' || work === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />} Make it again{changed ? ' with your changes' : ''}
            </button>
            <span className="text-[12px]" style={soft}>Changes here show once you press Make it again.</span>
          </div>
        </div>
      )}
    </article>
  )
}
