'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CHECK YOUR VIDEOS, for a batch from Google Drive (DriveBatch) or from the
// computer (ComputerBatch): the videos MVP made of the takes (lib/
// review-edit-batch), each file saying which video it is for, so the
// creator can join two talking files into one video, keep them apart, move
// a B-roll, mark a video a review or a TRYBE ad, and name the product,
// before anything is added. The same list both ways, so a batch reads the
// same wherever its takes come from.

import type { ReactNode } from 'react'
import { AlertTriangle, ArrowUp } from 'lucide-react'
import { moveFile, moveUp, unusedBroll, talkSeconds, type BatchVideo, type DriveTake, type Pair } from '@/lib/review-edit-batch'
import { clock, KIND_WORDS, type VideoKind } from '@/lib/review-edit'
import CalloutPicker from '@/components/review-editor/CalloutPicker'

const PURPLE = 'var(--accent)'
const soft = { color: 'var(--text-3)' }
const HOW: Record<Pair['how'], string> = { name: 'Paired by name', filmed: 'Paired by when they were filmed', order: 'Paired by file order', you: 'Picked by you', none: 'No B-roll found for it' }

export const shape = (t: DriveTake) => (t.width && t.height ? (t.height > t.width ? 'upright' : 'sideways') : null)
/** One upright file and one sideways cannot be one video. */
export const mixed = (v: BatchVideo) => new Set(v.a.map(shape).filter(Boolean)).size > 1

type SetVideos = (f: (vs: BatchVideo[] | null) => BatchVideo[] | null) => void

export default function BatchCheck({ videos, setVideos, pool, locked = false, status }: {
  videos: BatchVideo[]
  setVideos: SetVideos
  /** Every B-roll file of the batch, used or not. */
  pool: DriveTake[]
  /** Nothing can be changed (the batch is being added). */
  locked?: boolean
  /** What has happened to a video so far, shown on it (a batch being uploaded). */
  status?: (v: BatchVideo, i: number) => ReactNode
}) {
  const change = (i: number, patch: Partial<BatchVideo>) => setVideos((vs) => vs ? vs.map((v, k) => (k === i ? { ...v, ...patch } : v)) : vs)
  const move = (id: string, to: number | 'new' | 'none') => setVideos((vs) => (vs ? moveFile(vs, id, to, pool) : vs))
  /** Each file after the first in its own video again, right after it, in order
   *  (the last first, as each new video goes straight after this one). */
  const apart = (v: BatchVideo) => setVideos((vs) => (vs ? v.a.slice(1).reverse().reduce((acc, f) => moveFile(acc, f.id, 'new', pool), vs) : vs))
  const unused = unusedBroll(videos, pool)

  /** Which video a file is for: any video, or a new one (talking), or none (B-roll). */
  const whichVideo = (f: DriveTake, now: number | null, talk: boolean) => (
    <select value={now == null ? 'none' : String(now)} aria-label={`Which video ${f.name} is for`} disabled={locked}
      onChange={(e) => move(f.id, e.target.value === 'new' ? 'new' : e.target.value === 'none' ? 'none' : Number(e.target.value))}
      className="rounded-lg border px-1.5 py-0.5 text-[12px] bg-transparent shrink-0" style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }}>
      {videos.map((_, j) => <option key={j} value={j}>Video {j + 1}</option>)}
      {talk ? <option value="new">A new video</option> : <option value="none">Not used</option>}
    </select>
  )
  const fileLine = (f: DriveTake, now: number | null, talk: boolean, up?: () => void) => (
    <li key={f.id} className="flex items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{f.name}</b> <span style={soft}>{[f.seconds ? clock(f.seconds) : null, shape(f)].filter(Boolean).join(', ')}</span></span>
      {up && !locked && <button type="button" onClick={up} title="Play this one earlier" aria-label={`Play ${f.name} earlier`} className="rounded p-0.5" style={{ color: 'var(--text-3)' }}><ArrowUp size={13} /></button>}
      {whichVideo(f, now, talk)}
    </li>
  )

  return (
    <div className="mt-3">
      <p className="text-[13.5px] font-bold">Check your videos ({videos.length})</p>
      <p className="text-[12px]" style={soft}>Each file says which video it is for. Change it to put two files in one video or to take them apart, then add them all.</p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {videos.map((v, i) => {
          const secs = talkSeconds(v)
          return (
            <li key={v.a[0].id} className="rounded-xl border p-3" style={{ borderColor: mixed(v) ? '#B4530988' : 'var(--border-2)', background: 'var(--surface)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13.5px] font-bold">Video {i + 1} <span className="font-normal text-[12.5px]" style={soft}>{[secs ? clock(secs) : null, v.a.length > 1 ? `${v.a.length} files joined` : null].filter(Boolean).join(', ')}</span></p>
                <div className="flex items-center gap-1.5">
                  {(['review', 'trybe'] as VideoKind[]).map((k) => (
                    <button key={k} type="button" onClick={() => change(i, { kind: k })} disabled={locked} aria-pressed={v.kind === k} className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold"
                      style={v.kind === k ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border-2)', color: 'var(--text-2)' }}>{KIND_WORDS[k].name}</button>
                  ))}
                </div>
              </div>
              {status?.(v, i)}
              <p className="text-[11.5px] font-semibold uppercase tracking-wider mt-2" style={soft}>Talking</p>
              <ul className="mt-0.5 flex flex-col gap-1">{v.a.map((f, k) => fileLine(f, i, true, k > 0 ? () => setVideos((vs) => (vs ? moveUp(vs, f.id) : vs)) : undefined))}</ul>
              {v.apart != null && (
                <p className="text-[12px] mt-1" style={{ color: 'var(--text-2)' }}>MVP put these together: they were filmed {v.apart <= 1 ? 'one straight after the other' : `${v.apart} seconds apart`}.{' '}
                  {!locked && <button type="button" onClick={() => apart(v)} className="font-semibold underline" style={{ color: 'var(--accent-text)' }}>Keep them apart</button>}</p>
              )}
              {v.a.length > 1 && v.apart == null && <p className="text-[12px] mt-1" style={soft}>Joined into one video in this order.</p>}
              {mixed(v) && <p className="text-[12px] mt-1 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> One of these was filmed upright and one sideways, so they cannot be one video. Move one to another video.</p>}
              <p className="text-[11.5px] font-semibold uppercase tracking-wider mt-2" style={soft}>B-roll</p>
              {v.b.length
                ? <ul className="mt-0.5 flex flex-col gap-1">{v.b.map((f) => fileLine(f, i, false))}</ul>
                : <p className="text-[12px]" style={{ color: '#B45309' }}>None. Choose one from the B-roll not used below, or it is made without.</p>}
              {v.b.length > 0 && <p className="text-[11.5px] mt-0.5" style={soft}>{HOW[v.how]}{v.b.length > 1 ? '. The B-roll files are joined into one.' : ''}</p>}
              <label className="block text-[12px] mt-2" style={soft}>The product (optional): its Amazon ASIN, a link to it, or its name
                <input value={v.product} onChange={(e) => change(i, { product: e.target.value.slice(0, 300) })} disabled={locked} placeholder="B0FR4RHHXF, a product link, or MVP hears it in your take"
                  className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }} />
              </label>
              <div className="mt-2"><CalloutPicker product={v.product} value={v.callouts ?? []} onChange={(callouts) => change(i, { callouts })} disabled={locked} /></div>
            </li>
          )
        })}
      </ul>
      {unused.length > 0 && (
        <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--border-2)' }}>
          <p className="text-[12.5px] font-semibold">B-roll not used ({unused.length})</p>
          <ul className="mt-1 flex flex-col gap-1">{unused.map((f) => fileLine(f, null, false))}</ul>
        </div>
      )}
    </div>
  )
}
