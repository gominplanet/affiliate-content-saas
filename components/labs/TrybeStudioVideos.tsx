'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE EDIT STUDIO'S VIDEOS (phase 2). Tick the options, drop vertical takes
// from this computer or Google Drive, and MVP edits each one as a TRYBE ad
// for this brand (the review editor's own queue, kind 'trybe'), checks the
// finished video against the brand's rules, and sends it to the brand on
// TRYBE in one press: the same record and send as Upload (/api/drop, then
// lib/drop-run sendDropToTrybe through SCOUT).
//
// WHAT FAILURE LOOKS LIKE: a video that breaks a rule is red with the moment
// it happens and asks before it is sent; a send TRYBE did not confirm says
// so; nothing reads as sent that did not go (lib/studio).

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Check, Download, Film, UploadCloud, HardDrive, RotateCcw, Send, SlidersHorizontal } from 'lucide-react'
import ComputerBatch from '@/components/review-editor/ComputerBatch'
import DriveBatch from '@/components/review-editor/DriveBatch'
import type { DriveState } from '@/components/review-editor/drive-picker'
import DropTrybePicker, { emptyChoice, choiceBlocker, type TrybeChoice } from '@/components/labs/DropTrybePicker'
import { DEFAULT_SETTINGS, TITLE_LOOKS, TITLE_COLORS, cleanSettings, type EditSettings, type TitleLook, type TitleColor, type LogoSize } from '@/lib/review-edit'
import { browserHttp, sendDropToTrybe } from '@/lib/drop-run'
import { requestTrybeApi, requestTrybePutFile } from '@/lib/extension-frame'
import type { MyBrand } from '@/lib/trybe-mybrands'
import { studioStage, canSendNow, needsConfirm, outputOf, studioFileName, allowanceWords, type StudioEdit, type StudioTone } from '@/lib/studio'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const RED = '#DC2626'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'
const btnSoft = { border: '1px solid var(--border)', color: 'var(--text)' }
const TONE: Record<StudioTone, string> = { ok: GREEN, warn: AMBER, bad: RED, wait: 'var(--text-3)' }
const LOOK_WORDS: Record<TitleLook, string> = { clean: 'Clean', bold: 'Bold', caps: 'Caps', highlight: 'Highlight', marker: 'Marker', tech: 'Tech', fun: 'Fun' }

interface Allowance { used: number; limit: number | null; left: number | null; resetLabel: string }

function Toggle({ on, onChange, label, says }: { on: boolean; onChange: (v: boolean) => void; label: string; says: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer rounded-xl border px-3 py-2" style={{ borderColor: on ? ACCENT : 'var(--border)' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1" style={{ accentColor: 'var(--accent)' }} />
      <span><span className="text-[13.5px] font-semibold block">{label}</span><span className="text-[12px]" style={soft}>{says}</span></span>
    </label>
  )
}

export default function TrybeStudioVideos({ brand, brands, brandsError, canSend, hasRules }: {
  brand: { id: string; name: string }
  /** The brands this creator works with on TRYBE (for the send's program and product). */
  brands: MyBrand[] | null
  brandsError: string | null
  /** SCOUT can send to TRYBE. */
  canSend: boolean
  /** The brand's rules are read: finished videos are checked against them. */
  hasRules: boolean
}) {
  const [edits, setEdits] = useState<StudioEdit[] | null>(null)
  const [allowance, setAllowance] = useState<Allowance | null>(null)
  const [look, setLook] = useState<EditSettings>({ ...DEFAULT_SETTINGS, kind: 'trybe', formats: ['vertical'], logo: null })
  const [err, setErr] = useState<string | null>(null)
  const [from, setFrom] = useState<'computer' | 'drive' | null>(null)
  const [drive, setDrive] = useState<DriveState | null>(null)
  const [choice, setChoice] = useState<TrybeChoice>(() => ({ ...emptyChoice(), brandId: brand.id, brandName: brand.name }))
  const [sending, setSending] = useState<Record<string, string>>({})
  // Your saved look from the Review Editor, taken once as the starting options.
  const adopted = useRef(false)

  useEffect(() => { setChoice({ ...emptyChoice(), brandId: brand.id, brandName: brand.name }) }, [brand.id, brand.name])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/review-edit?studio=${encodeURIComponent(brand.id)}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error || 'Your videos for this brand could not be read.'); return }
      setErr(null)
      setEdits((d.edits || []) as StudioEdit[])
      if (d.trybeAllowance) setAllowance(d.trybeAllowance)
      // Your saved look's style (title look, colour, size) is kept, but not its
      // words or pictures: a disclosure like "Product provided in exchange for
      // review #ad" is for your own reviews, not a TRYBE ad the brand runs
      // (Seb, 2026-11-26: "This is not necessary").
      if (d.defaults && !adopted.current) { adopted.current = true; const saved = cleanSettings(d.defaults); setLook({ ...saved, kind: 'trybe', formats: ['vertical'], logo: null, pictures: [], callouts: [], captions: true, title: { ...saved.title, on: false, text: '' } }) }
    } catch { setErr('Your videos for this brand could not be read. Check your connection.') }
  }, [brand.id])
  useEffect(() => { setEdits(null); void load() }, [load])
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

  const set = (patch: Partial<EditSettings>) => setLook((l) => ({ ...l, ...patch }))
  const setTitle = (patch: Partial<EditSettings['title']>) => setLook((l) => ({ ...l, title: { ...l.title, ...patch } }))
  // Every studio video: a vertical TRYBE ad, no logo, with the options ticked.
  const settings = cleanSettings({ ...look, kind: 'trybe', formats: ['vertical'], logo: null })

  const saveSend = async (id: string, send: Record<string, unknown>) => {
    try { await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'studio_sent', id, send }), signal: AbortSignal.timeout(20_000) }) } catch { /* said on the card; the record in Drop has it too */ }
  }

  async function sendOne(e: StudioEdit, n: number) {
    const out = outputOf(e)
    if (!out) return
    const block = choiceBlocker(choice)
    if (block) { toast.error(`${block} first, above the list.`); return }
    if (needsConfirm(e) && !window.confirm(`This video breaks one of ${brand.name}'s rules. Send it anyway?`)) return
    const say = (t: string) => setSending((m) => ({ ...m, [e.id]: t }))
    say('Checking the file')
    try {
      // The file's size, which TRYBE asks for before it takes the upload.
      const head = await fetch(out.url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) })
      const size = Number(head.headers.get('content-length'))
      if (!head.ok || !(size > 0)) throw new Error('MVP could not find the finished file. Make it again in the Review Editor.')
      say('Making the record')
      const made = await browserHttp('/api/drop', { method: 'POST', body: {
        action: 'create', name: `Studio ${brand.name}`.slice(0, 80),
        items: [{ fileName: studioFileName(brand.name, e.name, n), sourceUrl: out.url, mimeType: 'video/mp4', sizeBytes: size, durationSeconds: Math.round(out.seconds), width: 1080, height: 1920,
          kind: 'vertical', toLiftoff: false, toBlog: false, toTrybe: true, places: [], trybe: choice }],
      } })
      const itemId = (made.json.items as Array<{ id: string }> | undefined)?.[0]?.id
      if (!made.ok || !itemId) throw new Error(String(made.json.error || 'MVP could not keep the record of this send.'))
      await saveSend(e.id, { state: 'sending', itemId })
      const res = await sendDropToTrybe({
        id: itemId, source_url: out.url, file_name: studioFileName(brand.name, e.name, n), mime_type: 'video/mp4', size_bytes: size,
        trybe_brand_id: choice.brandId, trybe_program_id: choice.programId, trybe_angle_id: choice.angleId,
        trybe_product_ids: choice.productIds, trybe_exclusive: choice.exclusive, trybe_notes: choice.notes,
      }, browserHttp, { api: requestTrybeApi, put: requestTrybePutFile, onStep: (t, done, total) => say(total && total > 1 ? `${t} (${done ?? 0} of ${total})` : t) })
      if (!res) { await saveSend(e.id, { state: 'failed', itemId, note: 'Another tab is already sending this one.' }); toast.error('Another tab is already sending this one.') }
      else if (res.state === 'in_review') { await saveSend(e.id, { state: 'in_review', itemId }); toast.success(`${brand.name} has it, waiting on their review.`) }
      else if (res.state === 'sent_unconfirmed') { await saveSend(e.id, { state: 'sent_unconfirmed', itemId, note: `TRYBE took it, but it is not in your ${brand.name} submissions yet. Check TRYBE before sending it again.` }) }
      else { await saveSend(e.id, { state: 'failed', itemId, note: res.error || 'TRYBE did not take it.' }); toast.error(`Not sent: ${res.error || 'TRYBE did not take it.'}`) }
    } catch (x) {
      const why = x instanceof Error ? x.message : 'The send stopped.'
      await saveSend(e.id, { state: 'failed', note: why })
      toast.error(why)
    } finally {
      setSending((m) => { const n2 = { ...m }; delete n2[e.id]; return n2 })
      await load()
    }
  }

  const aw = allowanceWords(allowance)
  const brandAsMine = (brands ?? []).filter((b) => b.id === brand.id)
  return (
    <section className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} aria-label="Your videos">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-[17px] font-bold inline-flex items-center gap-1.5"><Film size={17} style={{ color: ACCENT }} /> Your {brand.name} videos</h3>
          <p className="text-[12.5px]" style={soft}>Tick what you want, drop your vertical takes, and MVP edits each one as a TRYBE ad{hasRules ? `, checks it against ${brand.name}'s rules` : ''} and sends it to {brand.name} when you press Send.</p>
        </div>
        {aw && <span className="rounded-full px-3 py-1 text-[12px] font-bold" style={allowance?.left === 0 ? { background: 'rgb(220 38 38 / 0.10)', color: RED } : { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{aw}</span>}
      </div>
      {!hasRules && <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {brand.name}&rsquo;s rules are not read yet, so finished videos cannot be checked against them. Read them above first.</p>}

      {/* THE OPTIONS, ticked by the creator, on every video added below. */}
      <div>
        <p className="text-[11.5px] font-bold uppercase mb-2 inline-flex items-center gap-1.5" style={{ ...soft, letterSpacing: '0.07em' }}><SlidersHorizontal size={12} /> Options for every video you add</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Toggle on={look.captions} onChange={(v) => set({ captions: v })} label="Captions" says="Word by word, from what is said." />
          <Toggle on={look.broll} onChange={(v) => set({ broll: v })} label="B-roll over the talk" says="When you add B-roll files with the takes." />
          <Toggle on={look.zooms} onChange={(v) => set({ zooms: v })} label="Zooms" says="Slow push-ins on the key lines." />
          <Toggle on={look.color} onChange={(v) => set({ color: v })} label="Colour boost" says="A gentle lift to colour and contrast." />
          <Toggle on={look.title.on} onChange={(v) => setTitle({ on: v })} label="Title" says="On screen at the start. Left empty, MVP writes one for each video." />
        </div>
        {look.title.on && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
            <input value={look.title.text} onChange={(e) => setTitle({ text: e.target.value.slice(0, 80) })} placeholder="Title for every video, or empty for one each" className="flex-1 min-w-[14rem] rounded-xl border bg-transparent px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)' }} />
            <label className="inline-flex items-center gap-1.5">Look <select value={look.title.look} onChange={(e) => setTitle({ look: e.target.value as TitleLook })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}>{TITLE_LOOKS.map((l) => <option key={l} value={l}>{LOOK_WORDS[l]}</option>)}</select></label>
            <label className="inline-flex items-center gap-1.5">Colour <select value={look.title.color} onChange={(e) => setTitle({ color: e.target.value as TitleColor })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}>{(Object.keys(TITLE_COLORS) as TitleColor[]).map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
            <label className="inline-flex items-center gap-1.5">Size <select value={look.title.size} onChange={(e) => setTitle({ size: e.target.value as LogoSize })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}>{(['small', 'medium', 'large'] as LogoSize[]).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
            <label className="inline-flex items-center gap-1.5">Where <select value={look.title.position} onChange={(e) => setTitle({ position: e.target.value as 'top' | 'bottom' })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
            <label className="inline-flex items-center gap-1.5">For <select value={look.title.seconds} onChange={(e) => setTitle({ seconds: Number(e.target.value) })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}>{[2, 3, 4, 5, 6, 8, 0].map((n) => <option key={n} value={n}>{n === 0 ? 'the whole video' : `${n} seconds`}</option>)}</select></label>
          </div>
        )}
        <p className="text-[12px] mt-2" style={soft}>Coming next in the studio: caption styles, music beds, end cues, the hook, body and CTA mixer, and a voiceover over your B-roll.</p>
      </div>

      {/* THE TAKES: vertical only, from this computer or Google Drive. */}
      <div className="flex flex-wrap gap-2">
        <button className={btn} style={from === 'computer' ? { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT, border: '1px solid transparent' } : btnSoft} onClick={() => setFrom(from === 'computer' ? null : 'computer')} aria-expanded={from === 'computer'}><UploadCloud size={14} /> From this computer</button>
        <button className={btn} style={from === 'drive' ? { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT, border: '1px solid transparent' } : btnSoft} onClick={() => setFrom(from === 'drive' ? null : 'drive')} aria-expanded={from === 'drive'}><HardDrive size={14} /> From Google Drive</button>
      </div>
      {from === 'computer' && <ComputerBatch settings={settings} onAdded={load} left={null} trybeLeft={allowance?.left ?? null} studio={{ brandId: brand.id }} />}
      {from === 'drive' && (drive === null
        ? <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Checking Google Drive...</p>
        : drive.connected
          ? <DriveBatch drive={drive} loadDrive={loadDrive} settings={settings} onAdded={load} left={null} trybeLeft={allowance?.left ?? null} studio={{ brandId: brand.id }} />
          : <p className="text-[13px]" style={soft}>{drive.error ? `${drive.error} ` : ''}Google Drive is not connected yet. <a href="/review-editor" className="font-semibold underline" style={{ color: ACCENT }}>Connect it in the Review Editor</a>, then come back here.</p>)}

      {err && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err} <button onClick={() => void load()} className="ml-1 inline-flex items-center gap-1 font-semibold" style={{ color: ACCENT }}><RotateCcw size={12} /> Try again</button></p>}
      {!edits && !err && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading your {brand.name} videos...</p>}
      {edits && edits.length === 0 && <p className="text-[13px]" style={soft}>No {brand.name} videos yet. Drop your vertical takes above.</p>}

      {edits && edits.some((e) => canSendNow(e)) && (
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[13px] font-semibold inline-flex items-center gap-1.5"><Send size={14} style={{ color: ACCENT }} /> How they go to {brand.name}</p>
          {!canSend
            ? <p className="text-[12.5px]" style={{ color: AMBER }}>Sending needs SCOUT on TRYBE: install or update it, sign in to TRYBE in this Chrome, then reload.</p>
            : <DropTrybePicker brands={brandAsMine.length ? brandAsMine : brands} brandsError={brandsError} value={choice} onChange={setChoice} />}
        </div>
      )}

      {edits && edits.length > 0 && (
        <ul className="space-y-2">
          {edits.map((e, i) => {
            const st = studioStage(e, brand.name)
            const out = outputOf(e)
            const now = sending[e.id]
            return (
              <li key={e.id} className="rounded-xl border px-3 py-2.5 space-y-1.5" style={{ borderColor: st.tone === 'bad' ? RED : 'var(--border)' }}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-semibold">{e.name || `Video ${edits.length - i}`}</span>
                  <span className="text-[11.5px] font-bold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)', color: TONE[st.tone] }}>{now ?? st.word}</span>
                  {out && <span className="text-[12px] tabular-nums" style={soft}>{Math.round(out.seconds)}s</span>}
                  <span className="ml-auto inline-flex items-center gap-3">
                    {out && <a href={out.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}><Film size={12} /> Watch</a>}
                    {out && <a href={out.url} download={studioFileName(brand.name, e.name, edits.length - i)} className="text-[12.5px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT }}><Download size={12} /> Download</a>}
                    {canSendNow(e) && canSend && <button disabled={!!now} onClick={() => void sendOne(e, edits.length - i)} className={btn} style={{ background: ACCENT, color: '#fff', padding: '6px 12px' }}>{now ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to {brand.name}</button>}
                  </span>
                </div>
                {e.status !== 'done' && e.note && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={{ color: e.status === 'failed' ? RED : 'var(--text-3)' }}>{e.status !== 'failed' && <Loader2 size={12} className="animate-spin" />} {e.note}</p>}
                {e.studio?.send?.note && <p className="text-[12.5px]" style={{ color: e.studio.send.state === 'failed' ? RED : AMBER }}>{e.studio.send.note}</p>}
                {e.studio?.check && (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {e.studio.check.items.map((it) => (
                      <li key={it.text} className="text-[12.5px] inline-flex items-start gap-1" style={{ color: it.tone === 'ok' ? GREEN : it.tone === 'bad' ? RED : AMBER }}>
                        {it.tone === 'ok' ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />} {it.text}
                      </li>
                    ))}
                  </ul>
                )}
                {e.status === 'done' && <a href="/review-editor" className="text-[12px] font-semibold" style={{ color: ACCENT }}>Change the cuts in the Review Editor</a>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
