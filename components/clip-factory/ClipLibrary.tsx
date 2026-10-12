'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MY CLIPS (Seb, 2026-10-12: "could we also have a tab where it gives you all
// the clips that it's ever created that are still available to post, for each
// user?"). Every clip Clip Factory rendered for this creator, newest first:
// where it came from, how long it is, where it is already posted, and whether
// its file is still there. "Use this clip" takes it into Enhance and Publish,
// the same as a clip just made. A clip whose file is gone says so and can be
// cleared from the list; a check that could not answer is not called gone.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Film, Trash2, ExternalLink, AlertTriangle, RotateCcw, Check } from 'lucide-react'
import type { ShortRow } from '@/lib/shorts-types'

const PURPLE = '#7C3AED'

export interface LibraryClip extends ShortRow {
  renderedAt: string | null
  videoTitle: string | null
  videoThumbnail: string | null
  /** The file is there (true), gone (false), or could not be checked (null). */
  available: boolean | null
}

type Filter = 'unposted' | 'all'

const len = (c: ShortRow) => {
  const s = Math.max(0, Math.round(c.endSec - c.startSec))
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}
const when = (iso: string | null) => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
const postedOn = (c: ShortRow) => [c.postedTiktok && 'TikTok', c.postedInstagram && 'Instagram', c.postedYoutube && 'YouTube'].filter(Boolean) as string[]

export default function ClipLibrary({ onUse, onClose }: {
  onUse: (clip: LibraryClip) => void
  onClose: () => void
}) {
  const [clips, setClips] = useState<LibraryClip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capped, setCapped] = useState(false)
  const [rendering, setRendering] = useState(0)
  const [filter, setFilter] = useState<Filter>('unposted')
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null); setClips(null)
    try {
      const r = await fetch('/api/youtube/shorts/library', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `MVP could not read your clips (${r.status}).`)
      setClips((d.clips || []) as LibraryClip[])
      setCapped(!!d.capped)
      setRendering(Number(d.rendering) || 0)
    } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read your clips.') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(c: LibraryClip, quiet = false) {
    setRemoving(c.id)
    try {
      const r = await fetch(`/api/youtube/shorts?shortId=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Not removed.')
      setClips((cs) => (cs || []).filter((x) => x.id !== c.id))
      if (!quiet) toast.success('Removed from your clips. Anything already posted stays posted.')
    } catch (e) { if (!quiet) toast.error(e instanceof Error ? e.message : 'Not removed.') }
    finally { setRemoving(null) }
  }

  const ready = useMemo(() => (clips || []).filter((c) => c.available !== false), [clips])
  const gone = useMemo(() => (clips || []).filter((c) => c.available === false), [clips])
  const shown = filter === 'unposted' ? ready.filter((c) => postedOn(c).length === 0) : ready
  const unpostedCount = ready.filter((c) => postedOn(c).length === 0).length

  const pill = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold border ${on ? 'text-white border-transparent' : 'border-black/15 dark:border-white/20 text-[#1d1d1f] dark:text-[#f5f5f7]'}`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] inline-flex items-center gap-2"><Film size={17} style={{ color: PURPLE }} /> My clips</h2>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-[#86868b] hover:text-[#7C3AED]"><RotateCcw size={12} /> Refresh</button>
        <button onClick={onClose} className="text-[12px] font-semibold" style={{ color: PURPLE }}>Back to making clips</button>
      </div>
      <p className="text-[13px] text-[#4b4b4f] dark:text-[#b0b0b5] max-w-2xl mb-4">
        Every clip Clip Factory made for you, newest first, including the ones it rendered in the background. Pick one to add a CTA and post it, without cutting it again.
      </p>

      {error && <p className="text-[13px] text-[#ff3b30] inline-flex items-start gap-1.5 mb-3"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}
      {!clips && !error && <p className="text-[13px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Reading your clips and checking each file is still there.</p>}

      {clips && (<>
        {rendering > 0 && (
          <p className="text-[12px] mb-3 inline-flex items-center gap-1.5" style={{ color: PURPLE }}>
            <Loader2 size={12} className="animate-spin" /> {rendering} more clip{rendering === 1 ? ' is' : 's are'} rendering in the background and will show here when done. Press Refresh.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setFilter('unposted')} className={pill(filter === 'unposted')} style={filter === 'unposted' ? { backgroundColor: PURPLE } : undefined}>Not posted yet ({unpostedCount})</button>
          <button onClick={() => setFilter('all')} className={pill(filter === 'all')} style={filter === 'all' ? { backgroundColor: PURPLE } : undefined}>All clips ({ready.length})</button>
        </div>

        {ready.length === 0 && (
          <p className="text-[13px] text-[#86868b]">No clips yet. Pick a video under Make clips and MVP cuts the best moments for you; they show up here once rendered.</p>
        )}
        {ready.length > 0 && shown.length === 0 && (
          <p className="text-[13px] text-[#86868b]">Every clip here is posted somewhere already. <button onClick={() => setFilter('all')} className="font-semibold underline" style={{ color: PURPLE }}>Show all clips</button></p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {shown.map((c) => {
            const on = postedOn(c)
            return (
              <div key={c.id} className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1c1e] overflow-hidden flex flex-col">
                <video src={c.renderedUrl || undefined} poster={c.videoThumbnail || undefined} preload="metadata" muted playsInline controls
                  className="w-full bg-black object-contain" style={{ aspectRatio: '9 / 16' }} />
                <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                  <p className="text-[12.5px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2">{c.hook || c.videoTitle || 'Clip'}</p>
                  {c.videoTitle && c.hook && <p className="text-[11px] text-[#86868b] line-clamp-1" title={c.videoTitle}>From: {c.videoTitle}</p>}
                  <p className="text-[11px] text-[#86868b] tabular-nums">{len(c)} · made {when(c.renderedAt)}</p>
                  <p className="text-[11px]">
                    {on.length
                      ? <span className="inline-flex items-center gap-1 text-[#16a34a] font-medium"><Check size={11} /> Posted on {on.join(', ')}</span>
                      : <span className="text-[#86868b]">Not posted yet</span>}
                  </p>
                  {c.available === null && <p className="text-[11px] text-[#d97706]">MVP could not check this file just now. It may still play.</p>}
                  <div className="mt-auto pt-1 flex flex-wrap items-center gap-1.5">
                    <button onClick={() => onUse(c)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: PURPLE }}>
                      Use this clip
                    </button>
                    {c.renderedUrl && <a href={c.renderedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#86868b] hover:text-[#7C3AED]" title="Open the file to watch or save it"><ExternalLink size={11} /> File</a>}
                    <button onClick={() => void remove(c)} disabled={removing === c.id} className="ml-auto text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50" title="Remove from your clips. A posted clip stays posted.">
                      {removing === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {gone.length > 0 && (
          <div className="mt-4 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2.5 text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">
            {gone.length} older clip{gone.length === 1 ? '' : 's'} can no longer be posted: the file is not stored any more.{' '}
            <button onClick={() => void (async () => { for (const c of gone) await remove(c, true); toast.success('Cleared from the list.') })()} className="font-semibold underline" style={{ color: PURPLE }}>Clear {gone.length === 1 ? 'it' : 'them'} from the list</button>
          </div>
        )}
        {capped && <p className="mt-3 text-[11.5px] text-[#86868b]">Showing your newest 200 clips.</p>}
      </>)}
    </div>
  )
}
