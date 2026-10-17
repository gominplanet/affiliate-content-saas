'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: the places a video can go, drawn the same way everywhere on the page
// (the tiles on each video, the Launch plan, the results board), and the
// Launch plan editor: where each kind of video goes unless the creator says
// otherwise on the day.

import { useState } from 'react'
import { Youtube, FileText, Pin, Users, Scissors, Music2, Instagram, Facebook, Handshake, Smartphone, Check, Loader2, ShoppingCart } from 'lucide-react'
import { PLACE_INFO, type PlaceId, type LaunchPlans, type DropKind } from '@/lib/drop-plan'

export const TEAL = '#0EA5A4'

export function PlaceIcon({ place, size = 14 }: { place: PlaceId; size?: number }) {
  switch (place) {
    case 'liftoff': return <Youtube size={size} />
    case 'blog': return <FileText size={size} />
    case 'pin': case 'pinterest': return <Pin size={size} />
    case 'group': return <Users size={size} />
    case 'clips': return <Scissors size={size} />
    case 'tiktok': return <Music2 size={size} />
    case 'instagram': return <Instagram size={size} />
    case 'shorts': return <Smartphone size={size} />
    case 'facebook': return <Facebook size={size} />
    case 'trybe': return <Handshake size={size} />
    case 'amazon': return <ShoppingCart size={size} />
  }
}

/** One place, on or off. A place that cannot be used says why instead of
 *  looking like a choice. */
export function PlaceTile({ place, on, onClick, why, label }: { place: PlaceId; on: boolean; onClick: () => void; why?: string | null; label?: string }) {
  const info = PLACE_INFO[place]
  const off = !!why
  const lit = on && !off
  return (
    <button type="button" aria-pressed={lit} disabled={off} onClick={onClick} title={why || info.says}
      className={`group flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed ${lit ? 'text-cyan-800 dark:text-cyan-200' : ''}`}
      style={{ borderColor: lit ? TEAL : 'var(--border)', background: lit ? 'rgba(14,165,164,0.10)' : 'transparent', ...(lit ? {} : { color: off ? 'var(--text-3)' : 'var(--text)' }) }}>
      <span className="mt-0.5 shrink-0 rounded-md p-1" style={{ background: lit ? 'rgba(14,165,164,0.18)' : 'var(--surface-2)' }}>
        <PlaceIcon place={place} size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[12px] font-semibold leading-tight">
          {label || info.label}
          {lit && <Check size={12} className="shrink-0" />}
        </span>
        <span className="block text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-2)' }}>{why || info.says}</span>
      </span>
    </button>
  )
}

/** The places of one kind, in the order the page shows them. */
export const PLACES_OF: Record<DropKind, PlaceId[]> = {
  long: ['liftoff', 'blog', 'pin', 'group', 'clips'],
  vertical: ['tiktok', 'instagram', 'shorts', 'facebook', 'pinterest', 'amazon', 'trybe'],
}

/** The Launch plan, set once: long videos go here, vertical ones there. */
export function PlanEditor({ plans, why, onSave, onClose }: {
  plans: LaunchPlans
  /** Why a place cannot be used right now, if it cannot. */
  why: (place: PlaceId) => string | null
  onSave: (p: LaunchPlans) => Promise<boolean>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<LaunchPlans>(plans)
  const [saving, setSaving] = useState(false)
  const flip = (kind: DropKind, place: PlaceId) => setDraft((d) => ({ ...d, [kind]: d[kind].includes(place) ? d[kind].filter((x) => x !== place) : [...d[kind], place] }))
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Your Launch plan</h3>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>Where each kind of video goes when you drop it. You can still change any video before you press Launch.</p>
      </div>
      {(['long', 'vertical'] as DropKind[]).map((kind) => (
        <div key={kind} className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{kind === 'long' ? 'Long videos' : 'Vertical videos'}</p>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {PLACES_OF[kind].map((p) => <PlaceTile key={p} place={p} on={draft[kind].includes(p)} why={why(p)} onClick={() => flip(kind, p)} />)}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={async () => { setSaving(true); const ok = await onSave(draft); setSaving(false); if (ok) onClose() }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: TEAL }}>
          {saving && <Loader2 size={13} className="animate-spin" />} Save plan
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
      </div>
    </div>
  )
}
