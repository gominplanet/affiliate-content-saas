'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BATCH FROM THE A-ROLL AND B-ROLL FOLDERS (lib/review-edit-batch). The two
// folders are set once and remembered. A batch is two picks: the new talking
// takes in the A-roll folder, then their B-roll in the B-roll folder (the
// picker opens in each, Shift or Ctrl to pick many). MVP pairs them, reads
// from each take's shape whether it is a review or a TRYBE ad, and shows the
// pairs to check and change before any of them is queued. Every pair that
// could not be added says why. Takes already made are left out and listed,
// so picking everything in the folders each time is safe.

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, FolderOpen, Layers, Check, AlertTriangle } from 'lucide-react'
import { pickFolder, pickMany, type DriveState, type DriveFolderRef } from '@/components/review-editor/drive-picker'
import { pairTakes, unpaired, type DriveTake, type Pair } from '@/lib/review-edit-batch'
import { cleanSettings, clock, KIND_WORDS, type EditSettings, type VideoKind } from '@/lib/review-edit'

const PURPLE = '#7C3AED'
const BLUE = '#1a73e8'
const soft = { color: 'var(--text-3)' }
const HOW: Record<Pair['how'], string> = { name: 'Paired by name', filmed: 'Paired by when they were filmed', order: 'Paired by file order', none: 'No B-roll found for it' }

export default function DriveBatch({ drive, loadDrive, settings, onAdded }: {
  drive: DriveState
  loadDrive: () => Promise<DriveState | null>
  /** The look chosen above (logo, zooms, colour...), used for every video. */
  settings: EditSettings
  onAdded: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const [pool, setPool] = useState<DriveTake[]>([])
  const [problems, setProblems] = useState<string[]>([])
  /** Takes left out because they are already made or in the queue. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** False when the video server could not say when the takes were filmed. */
  const [filmedRead, setFilmedRead] = useState(true)
  const [added, setAdded] = useState<{ ok: number; failed: string[] } | null>(null)

  const fresh = async () => {
    const st = await loadDrive()
    if (!st?.connected || !st.token || !st.appId) { toast.error(st?.error || 'Connect Google Drive first.'); return null }
    return st as DriveState & { token: string; appId: string }
  }

  const setFolder = async (which: 'aRoll' | 'bRoll') => {
    setBusy(which)
    try {
      const st = await fresh()
      if (!st) return
      const f: DriveFolderRef | null = await pickFolder({ token: st.token, appId: st.appId, key: st.key, title: which === 'aRoll' ? 'Choose your A-roll folder (your talking takes)' : 'Choose your B-roll folder' })
      if (!f) return
      const r = await fetch('/api/review-edit/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'folders', [which]: f }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error || 'The folder was not saved.'); return }
      await loadDrive()
      toast.success(`${which === 'aRoll' ? 'A-roll' : 'B-roll'} folder: ${f.name}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Google’s picker did not open.') } finally { setBusy(null) }
  }

  const pickBatch = async () => {
    if (!drive.aRoll) return
    setBusy('pick'); setAdded(null); setProblems([]); setSkipped([]); setFilmedRead(true)
    try {
      const st = await fresh()
      if (!st) return
      const a = await pickMany({ token: st.token, appId: st.appId, key: st.key, folderId: drive.aRoll.id, title: `Select the talking takes for this batch, in ${drive.aRoll.name}` })
      if (!a.length) return
      const b = drive.bRoll ? await pickMany({ token: st.token, appId: st.appId, key: st.key, folderId: drive.bRoll.id, title: `Now select their B-roll, in ${drive.bRoll.name} (or close this for none)` }) : []
      setBusy('read')
      const r = await fetch('/api/review-edit/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'files', ids: [...a, ...b].map((f) => f.id) }) })
      const d = await r.json().catch(() => ({})) as { files?: DriveTake[]; problems?: { id: string; error: string }[]; used?: string[]; filmedRead?: boolean; error?: string }
      if (!r.ok) { toast.error(d.error || 'MVP could not read the files you picked.'); return }
      // Already made, or in the queue: left out, and said.
      const used = new Set(d.used ?? [])
      setSkipped((d.files ?? []).filter((f) => used.has(f.id)).map((f) => f.name))
      setFilmedRead(d.filmedRead !== false)
      const files = (d.files ?? []).filter((f) => !used.has(f.id))
      const aIds = new Set(a.map((f) => f.id)), bIds = new Set(b.map((f) => f.id))
      const aT = files.filter((f) => aIds.has(f.id)), bT = files.filter((f) => bIds.has(f.id))
      const named = new Map([...a, ...b].map((f) => [f.id, f.name]))
      setProblems((d.problems ?? []).map((p) => `${named.get(p.id) || 'A file'}: ${p.error}`))
      setPool(bT)
      setPairs(pairTakes(aT, bT))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Google’s picker did not open.') } finally { setBusy(null) }
  }

  const change = (i: number, patch: Partial<Pair>) => setPairs((ps) => ps ? ps.map((p, k) => (k === i ? { ...p, ...patch } : p)) : ps)
  const usedB = new Set((pairs ?? []).map((p) => p.b?.id).filter(Boolean))

  const addAll = async () => {
    if (!pairs?.length) return
    setBusy('add')
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i]
      setBusy(`add:${i + 1}`)
      try {
        // Each video gets its own title from what is said in it.
        const look = cleanSettings({ ...settings, kind: p.kind, title: { ...settings.title, text: '' } }, settings)
        const r = await fetch('/api/review-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', name: p.product || p.a.name.replace(/\.[^.]+$/, ''), review: { driveId: p.a.id, name: p.a.name }, broll: p.b ? { driveId: p.b.id, name: p.b.name } : undefined, product: p.product, settings: look }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok) ok++
        else failed.push(`${p.a.name}: ${d.error || 'not added'}`)
      } catch { failed.push(`${p.a.name}: not added (no answer)`) }
    }
    setAdded({ ok, failed })
    if (ok) { setPairs(failed.length ? pairs.filter((p) => failed.some((f) => f.startsWith(`${p.a.name}:`))) : null); await onAdded() }
    setBusy(null)
  }

  const folderRow = (which: 'aRoll' | 'bRoll', label: string, hint: string) => {
    const f = which === 'aRoll' ? drive.aRoll : drive.bRoll
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <FolderOpen size={14} style={{ color: BLUE }} />
        <b>{label}</b>
        {f ? <span>{f.name}</span> : <span style={soft}>{hint}</span>}
        <button type="button" onClick={() => void setFolder(which)} disabled={!!busy} className="underline font-semibold" style={{ color: BLUE }}>
          {busy === which ? <Loader2 size={12} className="animate-spin inline" /> : null} {f ? 'Change' : which === 'aRoll' ? 'Choose your A-roll folder' : 'Choose your B-roll folder'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-3 mb-3" style={{ borderColor: `${BLUE}55`, background: `${BLUE}08` }} aria-label="A batch from Google Drive">
      <p className="text-[14px] font-bold flex items-center gap-1.5"><Layers size={15} /> A batch from Google Drive</p>
      <p className="text-[12.5px] mt-0.5 mb-2" style={{ color: 'var(--text-2)' }}>
        Keep your talking takes in one Drive folder (A-roll) and your B-roll in another. Film one product at a time: its talking take, then its B-roll (or the B-roll first, as long as you always do it the same way). No renaming needed: MVP reads when each was filmed from the file itself. Each time, select everything in each folder; anything already made is left out. Upright takes become TRYBE ads; sideways ones, Amazon and YouTube reviews.
      </p>
      <div className="flex flex-col gap-1.5">
        {folderRow('aRoll', 'A-roll folder:', 'not set yet (your talking takes)')}
        {folderRow('bRoll', 'B-roll folder:', 'not set yet (optional)')}
      </div>
      <button type="button" onClick={() => void pickBatch()} disabled={!drive.aRoll || !!busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: BLUE }}>
        {busy === 'pick' || busy === 'read' ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />} {busy === 'read' ? 'Reading the files you picked' : 'Pick this batch'}
      </button>
      {!drive.aRoll && <span className="ml-2 text-[12px]" style={soft}>Choose your A-roll folder first.</span>}

      {skipped.length > 0 && <p className="mt-2 text-[12.5px]" style={soft}>Left out, already made or in the queue ({skipped.length}): {skipped.join(', ')}.</p>}
      {pairs && !filmedRead && <p className="mt-2 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> MVP could not read when these were filmed, so they are paired by name and file order. Check each pair.</p>}
      {problems.length > 0 && (
        <ul className="mt-2 text-[12.5px] flex flex-col gap-0.5" style={{ color: '#B45309' }}>
          {problems.map((p) => <li key={p} className="inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {p}</li>)}
        </ul>
      )}

      {pairs && pairs.length > 0 && (
        <div className="mt-3">
          <p className="text-[13.5px] font-bold">Check the pairs ({pairs.length} {pairs.length === 1 ? 'video' : 'videos'})</p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {pairs.map((p, i) => (
              <li key={p.a.id} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="text-[13px] font-semibold">{i + 1}. {p.a.name} <span className="font-normal" style={soft}>{p.a.seconds ? `${clock(p.a.seconds)}, ` : ''}{p.a.width && p.a.height ? (p.a.height > p.a.width ? 'filmed upright' : 'filmed sideways') : 'shape unknown'}</span></p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {(['review', 'trybe'] as VideoKind[]).map((k) => (
                    <button key={k} type="button" onClick={() => change(i, { kind: k })} aria-pressed={p.kind === k} className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold"
                      style={p.kind === k ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text-2)' }}>{KIND_WORDS[k].name}</button>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-2 mt-1.5">
                  <label className="text-[12px]" style={soft}>B-roll
                    <select value={p.b?.id ?? ''} onChange={(e) => change(i, { b: pool.find((x) => x.id === e.target.value) ?? null, how: e.target.value ? p.how === 'none' ? 'order' : p.how : 'none' })}
                      className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      <option value="">No B-roll</option>
                      {pool.map((b) => <option key={b.id} value={b.id}>{b.name}{usedB.has(b.id) && b.id !== p.b?.id ? ' (used by another)' : ''}</option>)}
                    </select>
                  </label>
                  <label className="text-[12px]" style={soft}>The product (optional)
                    <input value={p.product} onChange={(e) => change(i, { product: e.target.value.slice(0, 120) })} placeholder="MVP hears it in your take if empty"
                      className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
                  </label>
                </div>
                <p className="text-[11.5px] mt-1" style={{ color: p.b ? 'var(--text-3)' : '#B45309' }}>{p.b ? `${HOW[p.how]}: ${p.b.name}` : HOW.none}</p>
              </li>
            ))}
          </ul>
          {unpaired(pairs, pool).length > 0 && <p className="text-[12px] mt-2" style={soft}>B-roll not used: {unpaired(pairs, pool).map((b) => b.name).join(', ')}.</p>}
          <button type="button" onClick={() => void addAll()} disabled={!!busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
            {busy?.startsWith('add') ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {busy?.startsWith('add:') ? `Adding ${busy.slice(4)} of ${pairs.length}` : `Add all ${pairs.length} to the queue`}
          </button>
          <p className="text-[12px] mt-1" style={soft}>They use the look chosen below (logo, zooms, colour), and each gets its own title from what you say.</p>
        </div>
      )}
      {added && (
        <p className="text-[12.5px] mt-2" style={{ color: added.failed.length ? '#B45309' : '#15803D' }}>
          {added.ok} added to the queue{added.failed.length ? `; ${added.failed.length} not added: ${added.failed.join('; ')}` : '. MVP works through them in the background.'}
        </p>
      )}
    </div>
  )
}
