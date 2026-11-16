'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FILM AND EDIT, INSIDE A TRYBE BATCH (Seb, 2026-11-16: "after scripts, users
// shoot and then come back and could potentially edit all of their vertical
// trybe videos inside of mvp before being able to submit them"; "go with your
// recommendation": the batch as a tracker, takes dropped in bulk, each video
// beside its script). The review editor's own batch upload (from this
// computer or Google Drive) with the batch attached: every video is a TRYBE
// ad, MVP finds each one's script from what is said (lib/trybe-edit), cuts it
// with that script, and checks the finished video against the brief.
//
// WHAT FAILURE LOOKS LIKE: a take MVP could not match says so and asks for
// its script; a video still being cut says where it is; a check that found
// a broken rule is red with the moment it happens. A video never reads as
// ready while it is not.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Check, Download, Film, UploadCloud, HardDrive, RotateCcw } from 'lucide-react'
import ComputerBatch from '@/components/review-editor/ComputerBatch'
import DriveBatch from '@/components/review-editor/DriveBatch'
import type { DriveState } from '@/components/review-editor/drive-picker'
import { DEFAULT_SETTINGS, type EditSettings } from '@/lib/review-edit'
import type { Campaign, Script } from '@/lib/trybe-batch'
import type { CutCheck } from '@/lib/trybe-edit'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'
const btnSoft = { border: '1px solid var(--border)', color: 'var(--text)' }

/** One of the batch's videos, as the editor lists it (app/api/review-edit). */
export interface BatchEdit {
  id: string; name: string | null; status: string; note: string | null; madeAt: string | null
  outputs: Record<string, { url: string; seconds: number }> | null
  trybe: { campaignId: string; idx: number | null; check: CutCheck | null } | null
}
interface Allowance { used: number; limit: number | null; left: number | null; resetLabel: string; introNote: string | null }

/** Where a video stands, in words, and its colour. Pure. */
export function editStage(e: BatchEdit): { word: string; tone: 'ok' | 'warn' | 'bad' | 'wait' } {
  if (e.status === 'failed') return { word: 'Not edited', tone: 'bad' }
  if (e.status !== 'done') return { word: e.status === 'making' ? 'Being made' : e.status === 'ready_to_make' ? 'Waiting its turn' : 'Being read', tone: 'wait' }
  const c = e.trybe?.check
  if (!c) return { word: 'Edited, not checked', tone: 'warn' }
  return c.state === 'red' ? { word: 'Breaks a rule', tone: 'bad' } : c.state === 'amber' ? { word: 'Worth a look', tone: 'warn' } : { word: 'Ready to submit', tone: 'ok' }
}
const TONE: Record<'ok' | 'warn' | 'bad' | 'wait', string> = { ok: GREEN, warn: AMBER, bad: RED, wait: 'var(--text-3)' }
const outOf = (e: BatchEdit) => (e.outputs ? Object.values(e.outputs)[0] ?? null : null)

export default function TrybeBatchEdits({ c, scripts, onEdits }: { c: Campaign; scripts: Script[]; onEdits?: (edits: BatchEdit[]) => void }) {
  const [edits, setEdits] = useState<BatchEdit[] | null>(null)
  const [allowance, setAllowance] = useState<Allowance | null>(null)
  const [look, setLook] = useState<EditSettings>(DEFAULT_SETTINGS)
  const [err, setErr] = useState<string | null>(null)
  const [from, setFrom] = useState<'computer' | 'drive' | null>(null)
  const [drive, setDrive] = useState<DriveState | null>(null)
  const [picking, setPicking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/review-edit?campaign=${encodeURIComponent(c.id)}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'Your videos for this batch could not be read.'); return }
      setErr(null)
      const list = (d.edits || []) as BatchEdit[]
      setEdits(list)
      onEdits?.(list)
      if (d.trybeAllowance) setAllowance(d.trybeAllowance)
      if (d.defaults) setLook(d.defaults)
    } catch { setErr('Your videos for this batch could not be read. Check your connection.') }
  }, [c.id, onEdits])
  useEffect(() => { void load() }, [load])
  // Videos still being read or made: looked at again every 20 seconds.
  const busy = (edits ?? []).some((e) => e.status !== 'done' && e.status !== 'failed')
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => { void load() }, 20_000)
    return () => clearInterval(t)
  }, [busy, load])

  const loadDrive = useCallback(async (): Promise<DriveState | null> => {
    try {
      const r = await fetch('/api/review-edit/drive', { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      const st: DriveState = r.ok ? d : { connected: false, appId: null, key: null, error: d.error || 'Google Drive could not be checked.' }
      setDrive(st)
      return st
    } catch { setDrive({ connected: false, appId: null, key: null, error: 'Google Drive could not be checked. Check your connection.' }); return null }
  }, [])
  useEffect(() => { if (from === 'drive' && !drive) void loadDrive() }, [from, drive, loadDrive])

  const pickScript = async (id: string, idx: number) => {
    setPicking(id)
    try {
      const r = await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'script', id, idx }), signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(d.error || 'The script was not set.')
      else { toast.success(`Reading it again with script ${idx}.`); await load() }
    } finally { setPicking(null) }
  }

  const titleOf = useMemo(() => new Map(scripts.map((s) => [s.idx, s.title])), [scripts])
  const counts = useMemo(() => {
    const list = edits ?? []
    return { all: list.length, ready: list.filter((e) => editStage(e).tone === 'ok').length, look: list.filter((e) => ['warn', 'bad'].includes(editStage(e).tone)).length, working: list.filter((e) => editStage(e).tone === 'wait').length }
  }, [edits])

  return (
    <section className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} aria-label="Film and edit">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-[16px] font-bold inline-flex items-center gap-1.5"><Film size={16} style={{ color: ACCENT }} /> Film and edit</h3>
          <p className="text-[12.5px]" style={soft}>Drop the takes you filmed, any names. MVP matches each one to its script by what you say, edits it as a TRYBE ad, and checks the finished video against the brief.</p>
        </div>
        {allowance && (
          <span className="rounded-full px-3 py-1 text-[12px] font-bold" style={allowance.left === 0 ? { background: 'rgb(220 38 38 / 0.10)', color: RED } : { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>
            {allowance.limit === null ? `${allowance.used} TRYBE ads edited this month` : allowance.left === 0 ? `All ${allowance.limit} TRYBE ad edits used${allowance.resetLabel ? `, more on ${allowance.resetLabel}` : ''}` : `${allowance.used} of ${allowance.limit} TRYBE ad edits this month`}
          </span>
        )}
      </div>
      {allowance?.introNote && <p className="text-[12px]" style={soft}>{allowance.introNote}</p>}

      <div className="flex flex-wrap gap-2">
        <button className={btn} style={from === 'computer' ? { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT, border: '1px solid transparent' } : btnSoft} onClick={() => setFrom(from === 'computer' ? null : 'computer')} aria-expanded={from === 'computer'}><UploadCloud size={14} /> From this computer</button>
        <button className={btn} style={from === 'drive' ? { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT, border: '1px solid transparent' } : btnSoft} onClick={() => setFrom(from === 'drive' ? null : 'drive')} aria-expanded={from === 'drive'}><HardDrive size={14} /> From Google Drive</button>
      </div>
      {from === 'computer' && <ComputerBatch settings={{ ...look, kind: 'trybe' }} onAdded={load} left={null} trybeLeft={allowance?.left ?? null} trybe={{ campaignId: c.id }} />}
      {from === 'drive' && (drive === null
        ? <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Checking Google Drive...</p>
        : drive.connected
          ? <DriveBatch drive={drive} loadDrive={loadDrive} settings={{ ...look, kind: 'trybe' }} onAdded={load} left={null} trybeLeft={allowance?.left ?? null} trybe={{ campaignId: c.id }} />
          : <p className="text-[13px]" style={soft}>{drive.error ? `${drive.error} ` : ''}Google Drive is not connected yet. <a href="/review-editor" className="font-semibold underline" style={{ color: ACCENT }}>Connect it in the Review Editor</a>, then come back here.</p>)}

      {err && (
        <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
          <button onClick={() => void load()} className="ml-1 inline-flex items-center gap-1 font-semibold" style={{ color: ACCENT }}><RotateCcw size={12} /> Try again</button>
        </p>
      )}
      {!edits && !err && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading this batch&rsquo;s videos...</p>}
      {edits && edits.length === 0 && <p className="text-[13px]" style={soft}>No videos yet. Film a few scripts, then drop the takes here.</p>}
      {edits && edits.length > 0 && (
        <>
          <p className="text-[12.5px]" style={soft}>{counts.all} {counts.all === 1 ? 'video' : 'videos'}: {counts.ready} ready to submit, {counts.look} to look at, {counts.working} being edited.</p>
          <ul className="space-y-2">
            {edits.map((e) => {
              const st = editStage(e)
              const out = outOf(e)
              const idx = e.trybe?.idx ?? null
              return (
                <li key={e.id} className="rounded-xl border px-3 py-2.5 space-y-1.5" style={{ borderColor: st.tone === 'bad' ? RED : 'var(--border)' }}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold">{idx ? `Script ${idx}: ${titleOf.get(idx) || 'not in the batch any more'}` : e.name || 'A take'}</span>
                    <span className="text-[11.5px] font-bold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)', color: TONE[st.tone] }}>{st.word}</span>
                    {out && <span className="text-[12px] tabular-nums" style={soft}>{Math.round(out.seconds)}s</span>}
                    <span className="ml-auto inline-flex items-center gap-3">
                      {out && <a href={out.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}><Film size={12} /> Watch</a>}
                      {out && <a href={out.url} download className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}><Download size={12} /> Download</a>}
                      <a href="/review-editor" className="text-[12.5px] font-semibold" style={{ color: ACCENT }}>Change it in the Review Editor</a>
                    </span>
                  </div>
                  {e.status !== 'done' && e.note && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={{ color: e.status === 'failed' ? RED : 'var(--text-3)' }}>{e.status !== 'failed' && <Loader2 size={12} className="animate-spin" />} {e.note}</p>}
                  {!idx && e.status !== 'queued' && e.status !== 'reading' && (
                    <label className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span style={{ color: AMBER }}>MVP could not tell which script this take is.</span>
                      <select disabled={picking === e.id} defaultValue="" onChange={(ev) => { const v = Number(ev.target.value); if (v) void pickScript(e.id, v) }} className="rounded-lg border bg-transparent px-2 py-1 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                        <option value="" disabled>Pick its script</option>
                        {scripts.map((s) => <option key={s.idx} value={s.idx}>#{s.idx} {s.title}</option>)}
                      </select>
                      {picking === e.id && <Loader2 size={12} className="animate-spin" />}
                    </label>
                  )}
                  {e.trybe?.check && (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {e.trybe.check.items.map((i) => (
                        <li key={i.text} className="text-[12.5px] inline-flex items-start gap-1" style={{ color: i.tone === 'ok' ? GREEN : i.tone === 'bad' ? RED : AMBER }}>
                          {i.tone === 'ok' ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />} {i.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
