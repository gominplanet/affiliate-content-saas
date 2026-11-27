'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MUSIC FOR A VIDEO SET (Seb, 2026-11-27: "this is also where we choose if we
// want music or not and what type of music. So that's another thing before we
// click on process"). No music, or one of your accepted beds (lib/music-bed),
// or a new one made right here with the mood, tempo and style ticked.
//
// WHAT IS TRUE TODAY: the pick is kept with the set, and the music goes into
// the videos with the next update to MVP's video server. Until then the panel
// says the videos are made without it, so a pick never reads as music added.

import { useEffect, useState } from 'react'
import { Music2, Loader2, AlertTriangle } from 'lucide-react'
import MusicBedMaker from '@/components/music/MusicBedMaker'

const ACCENT = 'var(--accent)'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }

interface Bed { id: string; moods: string[]; styles: string[]; tempo: string | null; seconds: number; url: string | null; status: string }
/** The music goes into the render once the video server can mix it. */
export const MUSIC_IN_RENDER = false

export default function StudioMusic({ picked, onPick, disabled = false }: {
  picked: { bedId: string; label: string } | null
  onPick: (m: { bedId: string; label: string } | null) => void
  disabled?: boolean
}) {
  const [beds, setBeds] = useState<Bed[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [making, setMaking] = useState(false)

  const load = async () => {
    try {
      const r = await fetch('/api/music-bed', { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Your music did not load.'); return }
      setBeds(((j.beds || []) as Bed[]).filter((b) => b.status === 'accepted' && b.url)); setErr(null)
    } catch { setErr('Your music did not load. Check your connection.') }
  }
  useEffect(() => { void load() }, [])

  const label = (b: Bed) => `${[...b.moods, b.tempo, ...b.styles].filter(Boolean).map((x) => String(x)[0].toUpperCase() + String(x).slice(1)).join(', ')} (${b.seconds} s)`
  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
      <p className="text-[13px] font-semibold inline-flex items-center gap-1.5"><Music2 size={14} style={{ color: ACCENT }} /> Music</p>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Music">
        <label className="inline-flex items-center gap-2 text-[13px]"><input type="radio" checked={!picked} onChange={() => onPick(null)} disabled={disabled} style={{ accentColor: 'var(--accent)' }} /> No music</label>
        {(beds ?? []).map((b) => (
          <label key={b.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <input type="radio" checked={picked?.bedId === b.id} onChange={() => onPick({ bedId: b.id, label: label(b) })} disabled={disabled} style={{ accentColor: 'var(--accent)' }} />
            <span className="min-w-[10rem]">{label(b)}</span>
            {b.url && <audio controls preload="none" src={b.url} className="h-8 max-w-[260px]" />}
          </label>
        ))}
      </div>
      {!beds && !err && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your music...</p>}
      {beds && beds.length === 0 && <p className="text-[12.5px]" style={soft}>No music beds yet. Make one below: tick a mood, a tempo and a style, listen, and accept it.</p>}
      {err && <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}</p>}
      <button onClick={() => setMaking(!making)} className="text-[12.5px] font-semibold underline" style={{ color: ACCENT }}>{making ? 'Close' : 'Make a new music bed'}</button>
      {making && <div className="pt-1"><MusicBedMaker defaultSeconds={60} /><button onClick={() => void load()} className="mt-2 text-[12.5px] font-semibold underline" style={{ color: ACCENT }}>Show my accepted beds above</button></div>}
      {!MUSIC_IN_RENDER && picked && <p className="text-[12.5px]" style={{ color: AMBER }}>Your pick is kept with this set. The music goes into your videos with the next update to MVP&rsquo;s video server; until then they are made without it.</p>}
    </div>
  )
}
