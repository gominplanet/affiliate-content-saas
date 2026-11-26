'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRAND'S RULES, IN THE EDIT STUDIO (phase 1; lib/studio-rules). What MVP
// read for this brand, each with the day it was read; a spot to add what the
// brand sent you (a link, a PDF or a picture, pasted words, your chat); and
// the do's and don'ts MVP wrote from all of it, which you can change. Where
// the sources disagree, a question for you, never a quiet choice.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Link2, FileUp, Type, MessageCircle, RefreshCw, X, Pencil, Check, ShieldCheck, HelpCircle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandCard } from '@/lib/trybe-brand-page'
import { hashText, sheetCount, POLICY_WORDS, type StudioSheet, type RuleQuestion, type Policy, type SourceKind } from '@/lib/studio-rules'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const RED = '#DC2626'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const card = 'rounded-2xl border p-5'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'
const btnSoft = { border: '1px solid var(--border)', color: 'var(--text)' }

interface SourceView { id: string; kind: SourceKind; label: string; url: string | null; readAt: string; error: string | null; hash: string; words: number; preview: string }
interface RulesView { sources: SourceView[]; history: Array<{ id: string; label: string; readAt: string; replacedAt: string }>; sheet: StudioSheet | null; questions: RuleQuestion[]; builtAt: string | null; editedAt: string | null }

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

async function call(body: Record<string, unknown>, ms = 60_000): Promise<RulesView & { uploadUrl?: string; path?: string }> {
  const r = await fetch('/api/labs/trybe-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `MVP answered ${r.status}`)
  return j
}

/** One part of the sheet, as a list. */
function Part({ title, tone, items }: { title: string; tone?: 'good' | 'bad'; items: string[] }) {
  if (!items.length) return null
  const color = tone === 'good' ? GREEN : tone === 'bad' ? RED : 'var(--text)'
  return (
    <div>
      <p className="text-[11.5px] font-bold uppercase mb-1" style={{ ...soft, letterSpacing: '0.07em' }}>{title}</p>
      <ul className="space-y-1">{items.map((t, i) => <li key={i} className="text-[13px] flex items-start gap-1.5" style={{ color: 'var(--text)' }}><span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{t}</li>)}</ul>
    </div>
  )
}

const withFrom = (x: { text: string; from?: string; bySec?: number | null }) => `${x.text}${x.bySec != null ? ` (by ${x.bySec} s)` : ''}${x.from ? `, from ${x.from}` : ''}`

/** The sheet, read. */
function SheetView({ s }: { s: StudioSheet }) {
  const policies: Array<[string, Policy]> = [['AI voice', s.aiVoice], ['AI music', s.aiMusic], ['AI footage', s.aiFootage], ['New hooks on the same video', s.hookSwaps]]
  return (
    <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
      <Part title="Do" tone="good" items={s.dos.map(withFrom)} />
      <Part title="Don't" tone="bad" items={s.donts.map(withFrom)} />
      <Part title="Claims you may make" tone="good" items={s.approvedClaims.map(withFrom)} />
      <Part title="Never say or show" tone="bad" items={s.neverSay} />
      <Part title="Must say" items={s.mustSay.map(withFrom)} />
      <Part title="Must show" items={s.mustShow.map(withFrom)} />
      <Part title="Names, as written (and said)" items={[...(s.product ? [`Product: ${s.product}`] : []), ...s.spellings.map((x) => (x.say ? `${x.write}, said "${x.say}"` : x.write))]} />
      <Part title="Captions" items={[...s.captionFixes.map((x) => `"${x.heard}" shows as ${x.show}`), ...s.keepTogether.map((x) => `Keep "${x}" on one line`), ...(s.captions ? [s.captions] : [])]} />
      <Part title="Offer" items={s.offer ? [`${s.offer.text}${s.offer.from || s.offer.to ? ` (${s.offer.from ?? '?'} to ${s.offer.to ?? '?'})` : ''}${s.offer.where ? `. ${s.offer.where}` : ''}`] : []} />
      <Part title="Disclaimer on screen" items={s.disclaimer ? [s.disclaimer] : []} />
      <Part title="Length and format" items={[`${s.lengthSec[0]} to ${s.lengthSec[1]} seconds`, s.size, ...(s.productDelaySec ? [`No product, brand or category before ${s.productDelaySec} seconds`] : []), ...(s.noPrices ? ['No prices'] : []), ...(s.noPercentOff ? ['No percent off'] : [])]} />
      <Part title="Hand in" items={s.deliver} />
      <Part title="Filming" items={s.filming} />
      <Part title="AI and versions" items={[...policies.map(([k, v]) => `${k}: ${POLICY_WORDS[v]}`), ...(s.versionsPerHook ? [`${s.versionsPerHook} versions per hook`] : []), ...(s.duplicates ? [`Duplicates: ${s.duplicates}`] : [])]} />
    </div>
  )
}

const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)
const joinItems = (xs: Array<{ text: string; from?: string }>) => xs.map((x) => x.text).join('\n')
const keepFrom = (old: Array<{ text: string; from?: string }>, text: string) => lines(text).map((t) => ({ text: t, ...(old.find((o) => o.text === t)?.from ? { from: old.find((o) => o.text === t)!.from } : {}) }))

/** The sheet, editable: each list one line per item. */
function SheetEdit({ s, onSave, saving }: { s: StudioSheet; onSave: (s: StudioSheet) => void; saving: boolean }) {
  const [d, setD] = useState({
    dos: joinItems(s.dos), donts: joinItems(s.donts), claims: joinItems(s.approvedClaims), never: s.neverSay.join('\n'),
    mustSay: joinItems(s.mustSay), mustShow: joinItems(s.mustShow), product: s.product, disclaimer: s.disclaimer,
    lo: String(s.lengthSec[0]), hi: String(s.lengthSec[1]), delay: String(s.productDelaySec), deliver: s.deliver.join('\n'), filming: s.filming.join('\n'),
    noPrices: s.noPrices, noPercentOff: s.noPercentOff, aiMusic: s.aiMusic, hookSwaps: s.hookSwaps,
  })
  const area = (k: keyof typeof d, label: string, rows = 4) => (
    <label className="block text-[12.5px]"><span className="font-semibold">{label}</span> <span style={soft}>one per line</span>
      <textarea rows={rows} value={String(d[k])} onChange={(e) => setD({ ...d, [k]: e.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }} /></label>
  )
  const pol = (k: 'aiMusic' | 'hookSwaps', label: string) => (
    <label className="text-[12.5px] inline-flex items-center gap-2"><span className="font-semibold">{label}</span>
      <select value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value as Policy })} className="rounded-lg border bg-transparent px-2 py-1 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
        {(['allowed', 'banned', 'not_said'] as Policy[]).map((p) => <option key={p} value={p}>{POLICY_WORDS[p]}</option>)}
      </select></label>
  )
  const save = () => onSave({
    ...s, product: d.product.trim(), disclaimer: d.disclaimer.trim(),
    dos: keepFrom(s.dos, d.dos), donts: keepFrom(s.donts, d.donts), approvedClaims: keepFrom(s.approvedClaims, d.claims), neverSay: lines(d.never),
    mustSay: keepFrom(s.mustSay, d.mustSay).map((x) => ({ ...x, bySec: s.mustSay.find((o) => o.text === x.text)?.bySec ?? null })),
    mustShow: keepFrom(s.mustShow, d.mustShow).map((x) => ({ ...x, bySec: s.mustShow.find((o) => o.text === x.text)?.bySec ?? null })),
    lengthSec: [Math.max(1, Number(d.lo) || s.lengthSec[0]), Math.max(Number(d.lo) || 1, Number(d.hi) || s.lengthSec[1])],
    productDelaySec: Math.max(0, Math.round(Number(d.delay) || 0)), deliver: lines(d.deliver), filming: lines(d.filming),
    noPrices: d.noPrices, noPercentOff: d.noPercentOff, aiMusic: d.aiMusic, hookSwaps: d.hookSwaps,
  })
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">{area('dos', 'Do')}{area('donts', "Don't")}{area('claims', 'Claims you may make')}{area('never', 'Never say or show')}{area('mustSay', 'Must say', 3)}{area('mustShow', 'Must show', 3)}{area('deliver', 'Hand in', 2)}{area('filming', 'Filming', 2)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 items-center text-[12.5px]">
        <label className="inline-flex items-center gap-2"><span className="font-semibold">Product name</span><input value={d.product} onChange={(e) => setD({ ...d, product: e.target.value })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }} /></label>
        <label className="inline-flex items-center gap-2"><span className="font-semibold">Length</span><input value={d.lo} onChange={(e) => setD({ ...d, lo: e.target.value })} className="w-14 rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }} /> to <input value={d.hi} onChange={(e) => setD({ ...d, hi: e.target.value })} className="w-14 rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }} /> seconds</label>
        <label className="inline-flex items-center gap-2"><span className="font-semibold">No product before</span><input value={d.delay} onChange={(e) => setD({ ...d, delay: e.target.value })} className="w-14 rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }} /> seconds</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={d.noPrices} onChange={(e) => setD({ ...d, noPrices: e.target.checked })} /> No prices</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={d.noPercentOff} onChange={(e) => setD({ ...d, noPercentOff: e.target.checked })} /> No percent off</label>
        {pol('aiMusic', 'AI music')}{pol('hookSwaps', 'New hooks on the same video')}
      </div>
      <label className="block text-[12.5px]"><span className="font-semibold">Disclaimer on screen</span>
        <input value={d.disclaimer} onChange={(e) => setD({ ...d, disclaimer: e.target.value })} className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }} /></label>
      <button className={btn} disabled={saving} onClick={save} style={{ background: ACCENT, color: '#fff' }}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save the rules</button>
    </div>
  )
}

export default function TrybeStudioRules({ brand, canRead, onSheet }: {
  brand: { id: string; name: string }
  /** SCOUT can read the brand's page on TRYBE. */
  canRead: boolean
  onSheet?: (s: StudioSheet | null) => void
}) {
  const [v, setV] = useState<RulesView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [trybeNote, setTrybeNote] = useState<string | null>(null)
  const [adding, setAdding] = useState<'link' | 'text' | null>(null)
  const [link, setLink] = useState('')
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [answers, setAnswers] = useState<Record<number, string>>({})

  const take = useCallback((x: RulesView) => { setV(x); onSheet?.(x.sheet) }, [onSheet])
  const run = useCallback(async (what: string, body: Record<string, unknown>, ms?: number) => {
    setBusy(what); setErr(null)
    try { take(await call({ brandId: brand.id, brandName: brand.name, ...body }, ms)); return true } catch (e) { setErr(e instanceof Error ? e.message : 'No answer'); return false } finally { setBusy(null) }
  }, [brand.id, brand.name, take])

  // What MVP has, then TRYBE's brief read through SCOUT: sent only when it is
  // new or changed, so the brief document is not read again every visit.
  useEffect(() => {
    let gone = false
    setV(null); setErr(null); setTrybeNote(null); setEditing(false)
    ;(async () => {
      let had: RulesView | null = null
      try {
        const r = await fetch(`/api/labs/trybe-studio?brand=${encodeURIComponent(brand.id)}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { if (!gone) setErr(j.error || 'The brand rules did not load.'); return }
        had = j as RulesView
        if (!gone) take(had)
      } catch { if (!gone) setErr('The brand rules did not load. Check your connection.'); return }
      if (!canRead) { if (!gone) setTrybeNote('Allow SCOUT on TRYBE so MVP can read this brand’s brief from its page.'); return }
      const d = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(brand.id)}/details`).catch(() => null)
      if (gone) return
      if (!d?.ok) { setTrybeNote(`SCOUT could not read ${brand.name}’s page on TRYBE${d?.error ? ` (${d.error})` : ''}, so its brief is not in yet.`); return }
      const c = readBrandCard(d.json)
      if (!c.brief && !c.briefUrl) { setTrybeNote(`${brand.name}’s TRYBE page has no brief. Add what they sent you below.`); return }
      const kept = had?.sources.find((s) => s.id === 'trybe_brief')
      const keptLink = had?.sources.find((s) => s.id === 'brief_link')
      const briefNew = !!c.brief && (!kept || kept.hash !== hashText(c.brief.trim()))
      const linkNew = !!c.briefUrl && (!keptLink || keptLink.url !== c.briefUrl)
      if (briefNew || linkNew) await run('trybe', { action: 'source', kind: 'trybe_brief', text: c.brief ?? '', ...(linkNew ? { briefUrl: c.briefUrl } : {}) }, 120_000)
    })()
    return () => { gone = true }
  }, [brand.id, brand.name, canRead, run, take])

  async function addFile(f: File | null) {
    if (!f) return
    setBusy('file'); setErr(null)
    try {
      const u = await call({ action: 'file_url', bytes: f.size, name: f.name })
      const put = await fetch(u.uploadUrl!, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f, signal: AbortSignal.timeout(180_000) })
      if (!put.ok) throw new Error(`The upload stopped (${put.status}). Try again.`)
      take(await call({ brandId: brand.id, brandName: brand.name, action: 'file', path: u.path, name: f.name, type: f.type }, 180_000))
    } catch (e) { setErr(e instanceof Error ? e.message : 'The file was not added.') } finally { setBusy(null) }
  }

  const sheet = v?.sheet ?? null
  const readable = (v?.sources ?? []).filter((s) => s.words > 0).length
  return (
    <section className={card} style={cardStyle} aria-label={`${brand.name} rules`}>
      <div className="flex flex-wrap items-start gap-2 mb-3">
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-[17px] font-bold inline-flex items-center gap-1.5"><ShieldCheck size={17} style={{ color: ACCENT }} /> {brand.name}&rsquo;s rules</h3>
          <p className="text-[12.5px]" style={soft}>Everything {brand.name} gave you, read by MVP: its brief on TRYBE, the documents behind it, and anything you add. Your videos are checked against these rules when they are made.</p>
        </div>
      </div>

      {!v && !err && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading what MVP has for {brand.name}...</p>}
      {err && <p className="text-[13px] inline-flex items-start gap-1.5 mb-2" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}
      {trybeNote && <p className="text-[12.5px] inline-flex items-start gap-1.5 mb-2" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {trybeNote}</p>}
      {busy === 'trybe' && <p className="text-[12.5px] inline-flex items-center gap-1.5 mb-2" style={soft}><Loader2 size={12} className="animate-spin" /> Reading {brand.name}&rsquo;s brief from TRYBE...</p>}

      {v && (
        <>
          <p className="text-[11.5px] font-bold uppercase mb-1.5" style={{ ...soft, letterSpacing: '0.07em' }}>What MVP read</p>
          {v.sources.length === 0
            ? <p className="text-[13px] mb-2" style={soft}>Nothing yet. Add the brief, a link, a PDF or the words {brand.name} sent you.</p>
            : (
              <ul className="space-y-1.5 mb-3">
                {v.sources.map((s) => (
                  <li key={s.id} className="rounded-xl border px-3 py-2 flex flex-wrap items-start gap-x-3 gap-y-1" style={{ borderColor: s.error && !s.words ? AMBER : 'var(--border)' }}>
                    <span className="text-[13px] font-semibold">{s.label}</span>
                    <span className="text-[12px]" style={soft}>{s.words ? `${s.words.toLocaleString('en-US')} words, read ${day(s.readAt)}` : `Not read, ${day(s.readAt)}`}</span>
                    <button onClick={() => void run(`rm:${s.id}`, { action: 'remove', id: s.id })} disabled={!!busy} className="ml-auto text-[12px] inline-flex items-center gap-1" style={soft} aria-label={`Remove ${s.label}`}><X size={12} /> Remove</button>
                    {s.error && <p className="w-full text-[12px]" style={{ color: AMBER }}>{s.words ? `Read again and failed: ${s.error} The words read before are kept.` : s.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          {v.history.length > 0 && <p className="text-[12px] mb-2" style={soft}>Earlier versions kept: {v.history.map((h) => `${h.label} read ${day(h.readAt)}`).join(', ')}.</p>}

          <div className="flex flex-wrap gap-2 mb-2">
            <button className={btn} style={btnSoft} onClick={() => setAdding(adding === 'link' ? null : 'link')} disabled={!!busy}><Link2 size={14} /> Add a link</button>
            <label className={`${btn} cursor-pointer`} style={btnSoft}>{busy === 'file' ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} Add a PDF or picture
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,text/plain" className="hidden" disabled={!!busy} onChange={(e) => { void addFile(e.target.files?.[0] ?? null); e.target.value = '' }} /></label>
            <button className={btn} style={btnSoft} onClick={() => setAdding(adding === 'text' ? null : 'text')} disabled={!!busy}><Type size={14} /> Paste words</button>
            <button className={btn} style={btnSoft} onClick={() => void run('chat', { action: 'chat' })} disabled={!!busy}>{busy === 'chat' ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Add what they sent in chat</button>
          </div>
          {adding === 'link' && (
            <div className="flex flex-wrap gap-2 mb-2">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/... or any page" className="flex-1 min-w-[16rem] rounded-xl border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }} />
              <button className={btn} style={{ background: ACCENT, color: '#fff' }} disabled={!!busy || !link.trim()} onClick={async () => { if (await run('link', { action: 'source', kind: 'link', url: link.trim() }, 150_000)) { setLink(''); setAdding(null) } }}>{busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : null} Read it</button>
            </div>
          )}
          {adding === 'text' && (
            <div className="space-y-2 mb-2">
              <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Paste what ${brand.name} told you: their do's and don'ts, the offer, the dates...`} className="w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }} />
              <button className={btn} style={{ background: ACCENT, color: '#fff' }} disabled={!!busy || text.trim().length < 10} onClick={async () => { if (await run('text', { action: 'source', kind: 'text', text: text.trim(), label: `Pasted ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` })) { setText(''); setAdding(null) } }}>Add these words</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <button className={btn} style={{ background: ACCENT, color: '#fff' }} disabled={!!busy || readable === 0} onClick={() => void run('build', { action: 'build' }, 200_000)}>
              {busy === 'build' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {sheet ? 'Read the rules again' : 'Read the rules'}
            </button>
            <span className="text-[12.5px]" style={soft}>{busy === 'build' ? 'MVP is reading everything above. Usually 20 to 60 seconds.' : readable === 0 ? 'Add something MVP can read first.' : sheet ? `${sheetCount(sheet)} rules, read ${day(v.builtAt)}${v.editedAt ? `, changed by you ${day(v.editedAt)}` : ''}. Read again after adding something.` : `MVP turns the ${readable} ${readable === 1 ? 'source' : 'sources'} above into one list of do's and don'ts.`}</span>
            {sheet && !editing && <button className={btn} style={btnSoft} onClick={() => setEditing(true)}><Pencil size={14} /> Change the rules</button>}
          </div>

          {v.questions.length > 0 && (
            <div className="mt-4 rounded-xl p-3 space-y-2" style={{ background: 'rgba(217,119,6,0.08)', border: `1px solid ${AMBER}` }}>
              <p className="text-[13px] font-bold inline-flex items-center gap-1.5" style={{ color: AMBER }}><HelpCircle size={14} /> The sources disagree. You decide:</p>
              {v.questions.map((q, i) => (
                <div key={i} className="text-[13px] space-y-1">
                  <p className="font-semibold">{q.q}</p>
                  {q.says && <p className="text-[12.5px]" style={soft}>{q.says}</p>}
                  <div className="flex flex-wrap gap-2">
                    <input value={answers[i] ?? q.answer ?? ''} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} placeholder="Your answer" className="flex-1 min-w-[14rem] rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)' }} />
                    <button className={btn} style={btnSoft} disabled={!!busy} onClick={() => void run(`q${i}`, { action: 'answer', idx: i, answer: answers[i] ?? q.answer ?? '' })}>{q.answer ? 'Update' : 'Save answer'}</button>
                  </div>
                </div>
              ))}
              <p className="text-[12px]" style={soft}>Then press Read the rules again so your answers count.</p>
            </div>
          )}

          {sheet && (
            <div className="mt-4">
              {editing
                ? <SheetEdit s={sheet} saving={busy === 'save'} onSave={async (s) => { if (await run('save', { action: 'save', sheet: s })) setEditing(false) }} />
                : <SheetView s={sheet} />}
            </div>
          )}
          {!sheet && readable > 0 && <p className="mt-3 text-[13px]" style={soft}>No rules yet: press Read the rules.</p>}
        </>
      )}
    </section>
  )
}

