'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR SAVED SCRIPTS (Seb, 2026-11-06: "make sure that under brand scripts,
// when ... MVP gives you the 5 or 10 scripts, that we actually save them,
// even if we refresh or leave, and then just let users delete it manually if
// they no longer want to do it, or if they've actually shot it, maybe a tick
// box and it deletes it"). Every set Brand scripts writes is kept on MVP's
// server (the saved ideas) until the creator clears it: Shot it when a video
// is filmed, Delete when they will not make it, or Delete all for a set. Each
// clear can be undone for a few seconds. A list that could not be read says
// so; it never reads as "no saved scripts".

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, ChevronDown, ChevronUp, Trash2, Check, Bookmark } from 'lucide-react'
import { ScriptVideoCard } from '@/components/labs/ScriptParts'
import TrybeFilmIt, { type FilmScript } from '@/components/labs/TrybeFilmIt'
import { ideaText, HOOK_STYLE_WORDS, type VideoIdea, type VideoPlan } from '@/lib/trybe-playbook'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'

type Plan = VideoPlan & { onSale?: string[]; products?: string[] }
export interface SavedSet { id: string; brand_id: string; brand_name: string | null; product: string | null; plan: Plan; created_at: string }

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `MVP answered ${r.status}`)
  return d
}

/** One script cleared from a saved set on MVP's server. */
export const clearSavedScript = (ideaId: string, index: number, v: VideoIdea) => api({ action: 'script_done', ideaId, index, hook: v.hook })
/** A saved set written back as it was (Undo). */
export const restoreSavedSet = (s: { id: string; brand_id: string; brand_name: string | null; product: string | null; plan: Plan; created_at?: string }) =>
  api({ action: 'idea_restore', ideaId: s.id, plan: s.plan, brandId: s.brand_id, brandName: s.brand_name, product: s.product, createdAt: s.created_at })

/** The two ways a script leaves the list: filmed, or not wanted. */
export function ScriptDoneBar({ onShot, onDelete, busy }: { onShot: () => void; onDelete: () => void; busy?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
      <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold cursor-pointer" style={{ color: GREEN }} title="Filmed it: it leaves your saved scripts">
        <input type="checkbox" className="w-4 h-4" style={{ accentColor: GREEN }} checked={false} disabled={busy} onChange={onShot} />
        Shot it
      </label>
      <button type="button" onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: 'var(--text-soft)' }} title="Not making this one: it leaves your saved scripts">
        <Trash2 size={12} /> Delete
      </button>
      {busy && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-soft)' }} />}
    </div>
  )
}

const day = (t: string) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) }

export default function TrybeSavedScripts({ refreshKey = 0 }: { refreshKey?: number }) {
  const [sets, setSets] = useState<SavedSet[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [filming, setFilming] = useState<FilmScript | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const d = await api({ action: 'saved_scripts' })
      const list = (d.sets || []) as SavedSet[]
      setSets(list); setMore(!!d.more)
    } catch (e) { setError(e instanceof Error ? e.message : 'the read did not finish') }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  const setsNow = useRef<SavedSet[] | null>(null)
  useEffect(() => { setsNow.current = sets }, [sets])
  const show = (next: SavedSet) => setSets((ss) => { const rest = (ss || []).filter((x) => x.id !== next.id); return [...rest, next].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) })

  // UNDO ONE: that script back where it was, in the set as it is now, so
  // undoing one never brings back another you cleared since.
  const undoOne = async (s: SavedSet, i: number, v: VideoIdea) => {
    const cur = setsNow.current?.find((x) => x.id === s.id) ?? { ...s, plan: { ...s.plan, videos: [] } }
    const videos = [...(cur.plan.videos || [])]
    videos.splice(Math.min(i, videos.length), 0, v)
    const next = { ...cur, plan: { ...cur.plan, videos } }
    try { await restoreSavedSet(next); show(next); toast.success('Put back.') }
    catch (e) { toast.error(`Not put back: ${e instanceof Error ? e.message : 'MVP did not answer'}`) }
  }

  const putBack = async (before: SavedSet) => {
    try {
      await restoreSavedSet(before)
      show(before)
      toast.success('Put back.')
    } catch (e) { toast.error(`Not put back: ${e instanceof Error ? e.message : 'MVP did not answer'}`) }
  }

  // FILMED OR NOT WANTED: off the list at once, cleared on MVP's server, and
  // a few seconds to undo. A clear that failed puts the script back and says so.
  async function clearOne(s: SavedSet, i: number, how: 'shot' | 'delete') {
    const v = s.plan.videos?.[i]
    if (!v) return
    const key = `${s.id}:${i}`
    setBusy(key)
    try {
      await clearSavedScript(s.id, i, v)
      const videos = (s.plan.videos || []).filter((_, j) => j !== i)
      setSets((ss) => (ss || []).map((x) => (x.id === s.id ? { ...x, plan: { ...x.plan, videos } } : x)).filter((x) => (x.plan.videos?.length || 0) > 0))
      const name = v.angle || HOOK_STYLE_WORDS[v.style]
      toast.success(how === 'shot' ? `Shot it: "${name}" is off your list.` : `Deleted "${name}".`, { action: { label: 'Undo', onClick: () => void undoOne(s, i, v) }, duration: 8000 })
    } catch (e) { toast.error(`Not cleared: ${e instanceof Error ? e.message : 'MVP did not answer'}. It is still on your list.`) }
    finally { setBusy(null) }
  }

  async function clearSet(s: SavedSet) {
    setBusy(s.id)
    try {
      await api({ action: 'idea_delete', ideaId: s.id })
      setSets((ss) => (ss || []).filter((x) => x.id !== s.id))
      toast.success(`Deleted ${s.plan.videos?.length || 0} scripts for ${s.product || s.brand_name || 'this product'}.`, { action: { label: 'Undo', onClick: () => void putBack(s) }, duration: 8000 })
    } catch (e) { toast.error(`Not deleted: ${e instanceof Error ? e.message : 'MVP did not answer'}.`) }
    finally { setBusy(null) }
  }

  const soft = { color: 'var(--text-soft)' }
  const total = (sets || []).reduce((n, s) => n + (s.plan.videos?.length || 0), 0)

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[18px] font-bold inline-flex items-center gap-2"><Bookmark size={17} style={{ color: PURPLE }} /> Your saved scripts</h2>
        {sets && sets.length > 0 && <span className="text-[13px]" style={soft}>{total} script{total === 1 ? '' : 's'} to shoot, in {sets.length} set{sets.length === 1 ? '' : 's'}</span>}
      </div>
      <p className="text-[13px] mt-1" style={soft}>Every set Brand scripts writes stays here, after a refresh too, until you clear it. Tick Shot it when you have filmed one, or Delete one you will not make.</p>

      {error ? (
        <p className="mt-3 text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> MVP could not read your saved scripts: {error.replace(/[.\s]+$/, '')}. They are not lost. <button onClick={() => void load()} className="font-semibold underline" style={{ color: PURPLE }}>Try again</button></p>
      ) : !sets ? (
        <p className="mt-3 text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your saved scripts...</p>
      ) : sets.length === 0 ? (
        <p className="mt-3 text-[13px]" style={soft}>No saved scripts right now. Pick a brand below and MVP writes a set for the product you have; it stays here until you clear it.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {sets.map((s) => {
            const on = open === s.id
            const n = s.plan.videos?.length || 0
            return (
              <li key={s.id} className="rounded-xl border" style={{ borderColor: on ? 'rgb(var(--brand-rgb) / 0.35)' : 'var(--border)' }}>
                <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                  <button type="button" onClick={() => setOpen(on ? null : s.id)} aria-expanded={on} className="flex-1 min-w-[12rem] text-left inline-flex items-center gap-2">
                    {on ? <ChevronUp size={14} style={{ color: PURPLE }} /> : <ChevronDown size={14} style={{ color: PURPLE }} />}
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold truncate">{s.brand_name || 'A brand'}{s.product ? `: ${s.product}` : ''}</span>
                      <span className="block text-[12px]" style={soft}>{n} script{n === 1 ? '' : 's'} left{day(s.created_at) ? `, written ${day(s.created_at)}` : ''}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => void clearSet(s)} disabled={busy === s.id} className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg px-2.5 py-1 border disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete all {n}
                  </button>
                </div>
                {on && (
                  <ol className="px-3.5 pb-3.5 flex flex-col gap-1.5">
                    {(s.plan.videos || []).map((v, i) => (
                      <ScriptVideoCard key={`${s.id}:${i}:${v.hook}`} v={v} n={i + 1} copied={copied === `${s.id}:${i}`}
                        onCopy={() => { void navigator.clipboard.writeText(ideaText(v, i + 1)).then(() => { setCopied(`${s.id}:${i}`); setTimeout(() => setCopied(null), 2000) }, () => toast.error('Could not copy. Select the text instead.')) }}
                        onFilm={() => setFilming({ title: `${i + 1}. ${v.angle || HOOK_STYLE_WORDS[v.style]}`, say: v.say?.length ? v.say : [v.hook, ...v.beats].filter(Boolean), broll: v.broll || [], shot: v.shot || null, forBrief: v.forBrief || null, onScreen: v.onScreen || null })}
                        footer={<>
                          {v.forBrief && <p className="mt-1.5 text-[12.5px]" style={{ color: GREEN }}>For the brief: {v.forBrief}</p>}
                          <ScriptDoneBar busy={busy === `${s.id}:${i}`} onShot={() => void clearOne(s, i, 'shot')} onDelete={() => void clearOne(s, i, 'delete')} />
                        </>} />
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {more && <p className="mt-2 text-[12px]" style={soft}>Showing your newest sets. Clear some and the older ones show here.</p>}
      {filming && <TrybeFilmIt script={filming} onClose={() => setFilming(null)} />}
      {sets && sets.length > 0 && <p className="mt-2 text-[12px] inline-flex items-center gap-1" style={soft}><Check size={12} style={{ color: GREEN }} /> Saved on MVP, so they are here on any computer you sign in on.</p>}
    </section>
  )
}
