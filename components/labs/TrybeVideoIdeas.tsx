'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// VIDEO IDEAS FOR ONE BRAND, NEXT TO WHAT ALREADY WINS FOR IT (Cole on Oink;
// Seb 2026-10-12: "build 1, 2 and 3"). Cole studies a brand's best videos
// before he films, then makes one body with many hooks. Here:
//   - the brand's own best videos on TRYBE (brand details, read through
//     SCOUT), with their words when TRYBE shares them;
//   - the video plan (one body, ten hooks), planned from those words when
//     there are any, so it copies an angle that already sells.
// Used on the Sent tab (after a brand accepts) and on My brands. Every empty
// or failed read says which it is.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Copy, Check, Clapperboard, ChevronDown, ChevronUp, RotateCcw, Trophy, Play, AlertTriangle, Printer, FileText } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { scriptFor, ideaText, planText, HOOK_STYLE_WORDS, VIDEO_IDEAS, type VideoPlan } from '@/lib/trybe-playbook'
import { readBrandCard } from '@/lib/trybe-brand-page'
import { readTopVideos, readScript, keysOf, type TopVideo } from '@/lib/trybe-mybrands'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'

export type SavedPlan = (VideoPlan & { onSale?: string[]; products?: string[] }) | null

interface Winners { videos: Array<TopVideo & { words: string | null }>; wordsRead: number; wordsTried: number; note: string | null }

// Read once per brand per visit: the best videos change slowly.
const winnersCache = new Map<string, { at: number; w: Winners }>()
const KEEP_MS = 15 * 60_000

const apiWords = (e: string | undefined) => e === 'not-allowed' ? 'This needs SCOUT 1.46.0 or newer. Update SCOUT, then reload this page.' : (e || 'SCOUT did not answer.')

async function loadWinners(brandId: string, isAdmin: boolean): Promise<Winners> {
  const hit = winnersCache.get(brandId)
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.w
  const id = encodeURIComponent(brandId)
  const d = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${id}/details`)
  let videos = d.ok ? readTopVideos(d.json) : []
  let seen = d.ok ? `details: ${keysOf(d.json)}` : ''
  if (!videos.length) {
    const f = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${id}/top-formats`)
    if (f.ok) { videos = readTopVideos(f.json); seen += `${seen ? '; ' : ''}top-formats: ${keysOf(f.json)}` }
    else if (!d.ok) return { videos: [], wordsRead: 0, wordsTried: 0, note: `MVP could not read this brand's best videos: ${apiWords(d.error || f.error)}${d.status ? ` (TRYBE answered ${d.status})` : ''}` }
  }
  if (!videos.length) {
    return { videos: [], wordsRead: 0, wordsTried: 0, note: `TRYBE shows no top videos for this brand yet.${isAdmin && seen ? ` (TRYBE sent ${seen})` : ''}` }
  }
  // Their words, for the first three, one at a time.
  const out: Winners['videos'] = []
  let wordsRead = 0
  const top = videos.slice(0, 6)
  for (let i = 0; i < top.length; i++) {
    let words: string | null = null
    if (i < 3) {
      const s = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(top[i].id)}/script`)
      words = s.ok ? readScript(s.json) : null
      if (words) wordsRead++
    }
    out.push({ ...top[i], words })
  }
  const w: Winners = { videos: out, wordsRead, wordsTried: Math.min(3, top.length), note: null }
  winnersCache.set(brandId, { at: Date.now(), w })
  return w
}

/** The brand's creative brief on TRYBE, read through SCOUT. Which of the
 *  three it is (words, a document only, none) is kept and said. */
async function loadBrief(brandId: string): Promise<{ brief: string | null; state: 'text' | 'link_only' | 'none' | 'unread' }> {
  try {
    const d = await requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(brandId)}/details`)
    if (!d.ok) return { brief: null, state: 'unread' }
    const c = readBrandCard(d.json)
    if (c.brief) return { brief: c.brief, state: 'text' }
    return { brief: null, state: c.briefUrl ? 'link_only' : 'none' }
  } catch { return { brief: null, state: 'unread' } }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A clean page to print or save as PDF, opened from the press itself. */
function printPlan(plan: VideoPlan, brand: string): boolean {
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return false
  const blocks = planText(plan, brand).split('\n\n').map((b, i) => i === 0 ? `<h1>${esc(b)}</h1>` : `<section>${esc(b).replace(/\n/g, '<br>')}</section>`).join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(brand)} video ideas</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 16px}h1{font-size:18px}section{border-top:1px solid #ddd;padding:12px 0;break-inside:avoid}</style></head><body>${blocks}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* the page stays open to print by hand */ } }, 300)
  return true
}

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

export default function TrybeVideoIdeas({ brandId, name, plan: initial, canRead, isAdmin = false, emphasize = false, onPlan, sampleId }: {
  /** Empty for a sample from a brand MVP has no TRYBE id for. */
  brandId: string
  /** The week plan: ideas about this sample's product, kept on the sample. */
  sampleId?: string
  name: string
  plan: SavedPlan
  /** SCOUT 1.46.0+ on TRYBE: the brand's best videos can be read. */
  canRead: boolean
  isAdmin?: boolean
  /** The brand answered: planning videos is the next step. */
  emphasize?: boolean
  onPlan?: (p: SavedPlan) => void
}) {
  const [plan, setPlan] = useState<SavedPlan>(initial)
  const [planOpen, setPlanOpen] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [planNote, setPlanNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [winners, setWinners] = useState<Winners | null>(null)
  const [winOpen, setWinOpen] = useState(false)
  const [winLoading, setWinLoading] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => { setPlan(initial) }, [initial])

  async function showWinners() {
    if (winners) { setWinOpen((v) => !v); return }
    setWinOpen(true); setWinLoading(true)
    try { setWinners(await loadWinners(brandId, isAdmin)) }
    catch (e) { setWinners({ videos: [], wordsRead: 0, wordsTried: 0, note: e instanceof Error ? e.message : 'MVP could not read the best videos.' }) }
    finally { setWinLoading(false) }
  }

  const winnerWords = (winners?.videos || []).map((v) => v.words || v.caption || '').filter((t) => t.length >= 12)

  async function makePlan() {
    setPlanning(true); setPlanNote(null)
    try {
      // The brief first: what the brand asked creators for.
      setStep('Reading the brand\'s creative brief on TRYBE')
      const b = canRead && brandId ? await loadBrief(brandId) : { brief: null, state: 'unread' as const }
      setStep(`Writing ${VIDEO_IDEAS} video ideas from ${b.brief ? 'the brief, ' : ''}the brand and its website. This takes about a minute.`)
      const d = await api({ action: 'video_plan', brandId, ...(sampleId ? { sampleId } : {}), winners: winnerWords, ...(b.brief ? { brief: b.brief } : b.state !== 'unread' ? { briefState: b.state } : {}) })
      const p = { ...(d.plan as VideoPlan), onSale: d.onSale || [], products: d.products || [] }
      setPlan(p); setPlanOpen(true)
      onPlan?.(p)
      const fromWin = d.fromWinners ? `Planned from the words of ${d.fromWinners} of their best video${d.fromWinners === 1 ? '' : 's'}.` : ''
      const briefSaid = b.state === 'text' ? 'Planned from their creative brief.'
        : b.state === 'link_only' ? 'Their brief is a document MVP cannot open: check these ideas against it.'
        : b.state === 'none' ? 'TRYBE shows no brief for this brand, so these come from the brand and its website.'
        : !brandId ? 'MVP has no TRYBE page for this brand, so these come from the product and what MVP knows of the brand.'
        : canRead ? 'MVP could not read their brief on TRYBE, so these come from the brand and its website.' : 'Update SCOUT to 1.46.0 or newer and MVP also plans from the brand\'s brief.'
      const from = [briefSaid, fromWin].filter(Boolean).join(' ')
      if (d.onList === false) setPlanNote({ tone: 'warn', text: `${from ? `${from} ` : ''}${name} is not on your MVP list, so these ideas are shown but not kept. Copy what you want.` })
      else if (!d.saved) setPlanNote({ tone: 'warn', text: `${from ? `${from} ` : ''}These ideas are shown but could not be saved, so they will be gone next visit. Copy what you want to keep.` })
      else if (from) setPlanNote({ tone: 'ok', text: from })
    } catch (e) { setPlanNote({ tone: 'warn', text: e instanceof Error ? (/abort|timed? ?out/i.test(e.message) ? 'The ideas took too long to write. Try again.' : e.message) : 'MVP could not plan the videos.' }) }
    finally { setPlanning(false); setStep(null) }
  }

  const copyText = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 2000) } catch { toast.error('Could not copy. Select the text instead.') }
  }

  const copy = async (i: number) => {
    if (!plan) return
    try { await navigator.clipboard.writeText(scriptFor(plan, i)); setCopied(i); setTimeout(() => setCopied(null), 2000) } catch { toast.error('Could not copy. Select the text instead.') }
  }

  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50'

  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => (plan ? setPlanOpen((v) => !v) : void makePlan())} disabled={planning} className={btn}
          style={emphasize ? { background: PURPLE, color: '#fff' } : { border: `1px solid ${PURPLE}`, color: PURPLE }}>
          {planning ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />} {plan ? (planOpen ? 'Hide video ideas' : 'Video ideas') : winnerWords.length ? 'Plan videos like their winners' : 'Plan videos'}
          {plan && (planOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
        {brandId && <button onClick={() => void showWinners()} disabled={!canRead || winLoading} className={btn} style={{ border: '1px solid var(--border)' }}
          title={canRead ? 'The videos that already sell best for this brand on TRYBE' : 'Needs SCOUT 1.46.0 or newer, allowed on TRYBE.'}>
          {winLoading ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />} Their best videos
          {winners && (winOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>}
      </div>

      {winOpen && (
        <div className="mt-2 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {winLoading && <p className="inline-flex items-center gap-1" style={soft}><Loader2 size={12} className="animate-spin" /> Reading {name}&rsquo;s best videos on TRYBE through SCOUT.</p>}
          {winners?.note && <p className="inline-flex items-start gap-1" style={{ color: AMBER }}><AlertTriangle size={12} className="mt-0.5 shrink-0" />{winners.note}</p>}
          {winners && winners.videos.length > 0 && (<>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>What already sells for {name}: copy the angle, not the words</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {winners.videos.map((v, i) => (
                <div key={v.id} className="shrink-0 w-[132px]">
                  <a href={v.video || v.thumbnail || '#'} target="_blank" rel="noopener noreferrer" className="relative block rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)', aspectRatio: '9 / 16', background: 'var(--surface-2, rgba(0,0,0,0.05))' }}
                    title={v.video ? 'Watch it' : 'Open the cover'}>
                    {v.thumbnail
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={v.thumbnail} alt={`${name} top video ${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      : <span className="absolute inset-0 flex items-center justify-center" style={soft}>No cover</span>}
                    {v.video && <span className="absolute bottom-1.5 right-1.5 rounded-full p-1" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Play size={11} /></span>}
                    <span className="absolute top-1.5 left-1.5 rounded-full px-1.5 text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>#{i + 1}</span>
                  </a>
                  {(v.words || v.caption) && <p className="mt-1 text-[11px] line-clamp-4" title={v.words || v.caption || ''}>{v.words || v.caption}</p>}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px]" style={winners.wordsRead ? { color: GREEN } : soft}>
              {winners.wordsRead
                ? `TRYBE shared the words of ${winners.wordsRead} of these. ${plan ? 'Press New ideas' : 'Plan videos'} to build hooks from them.`
                : `TRYBE did not share the words of ${winners.wordsTried === 1 ? 'this video' : 'these videos'}. Watch them, then plan: note the first 2 seconds and what they show.`}
            </p>
          </>)}
        </div>
      )}

      {planning && step && <p className="mt-1.5 inline-flex items-center gap-1" style={soft}><Loader2 size={12} className="animate-spin" /> {step}</p>}
      {planNote && <p className="mt-1.5" style={{ color: planNote.tone === 'ok' ? GREEN : AMBER }}>{planNote.text}</p>}

      {plan && planOpen && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void copyText('all', planText(plan, name))} className={btn} style={{ border: '1px solid var(--border)' }}>
              {copiedKey === 'all' ? <Check size={12} /> : <Copy size={12} />} {copiedKey === 'all' ? 'Copied' : 'Copy all'}
            </button>
            <button onClick={() => { if (!printPlan(plan, name)) toast.error('Your browser blocked the print window. Allow pop ups for MVP, or use Copy all.') }} className={btn} style={{ border: '1px solid var(--border)' }}>
              <Printer size={12} /> Print or save as PDF
            </button>
          </div>
          {((plan.wants?.length ?? 0) > 0 || (plan.avoid?.length ?? 0) > 0) && (
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={soft}><FileText size={11} /> What their brief asks for</p>
              {plan.wants && plan.wants.length > 0 && <ul className="mt-1 list-disc pl-4 space-y-0.5">{plan.wants.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              {plan.avoid && plan.avoid.length > 0 && (<>
                <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: AMBER }}>It rules out</p>
                <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{plan.avoid.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </>)}
            </div>
          )}
          {plan.brief === 'link_only' && <p style={{ color: AMBER }}>Their brief is a document MVP cannot open. Open it from the brand page and check these ideas against it.</p>}
          {plan.videos && plan.videos.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>{plan.videos.length} videos, {plan.videos.length} angles{plan.product ? `: ${plan.product}` : ''}</p>
              <ol className="mt-1 space-y-1.5">
                {plan.videos.map((v, i) => (
                  <li key={i} className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-[11px] font-bold mt-0.5" style={soft}>{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold">{v.angle || HOOK_STYLE_WORDS[v.style]}</span>
                          <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{HOOK_STYLE_WORDS[v.style]}</span>
                        </span>
                        <span className="block mt-0.5"><b>Hook:</b> {v.hook}</span>
                        {v.shot && <span className="block" style={soft}>First 2 seconds: {v.shot}</span>}
                        <ol className="mt-1 list-decimal pl-4 space-y-0.5">{v.beats.map((b, j) => <li key={j}>{b}</li>)}</ol>
                        {v.cta && <span className="block mt-0.5"><b>Close:</b> {v.cta}</span>}
                        {v.forBrief && <span className="block mt-0.5" style={{ color: GREEN }}>For the brief: {v.forBrief}</span>}
                      </span>
                      <button onClick={() => void copyText(`v${i}`, ideaText(v, i + 1))} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: PURPLE }} title="Copy this video's plan">
                        {copiedKey === `v${i}` ? <Check size={12} /> : <Copy size={12} />} {copiedKey === `v${i}` ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>One body, many hooks{plan.product ? `: ${plan.product}` : ''}</p>
            <p className="mt-1 text-[13px]">{plan.body}</p>
            {plan.onSale && plan.onSale.length > 0
              ? <p className="mt-1" style={{ color: GREEN }}>On sale on their store now: {plan.onSale.slice(0, 3).join(', ')}</p>
              : <p className="mt-1" style={soft}>Nothing marked down on their store right now, so no sale line is offered.</p>}
          </div>
          {!plan.videos?.length && <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>Hooks: film the body once, swap the first 2 seconds</p>
            <ol className="mt-1 space-y-1.5">
              {plan.hooks.map((h, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <span className="shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 mt-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{HOOK_STYLE_WORDS[h.style]}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold">{h.line}</span>
                    {h.shot && <span className="block" style={soft}>{h.shot}</span>}
                  </span>
                  <button onClick={() => void copy(i)} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: PURPLE }} title="Copy hook, body and call to action as one script">
                    {copied === i ? <Check size={12} /> : <Copy size={12} />} {copied === i ? 'Copied' : 'Script'}
                  </button>
                </li>
              ))}
            </ol>
          </div>}
          {plan.ctas.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>Calls to action</p>
              <ul className="mt-1 space-y-0.5">{plan.ctas.map((c, i) => <li key={i}>{c.line}</li>)}</ul>
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>One video per stage</p>
            <ul className="mt-1 space-y-0.5">
              {plan.funnel.top && <li><b>New to the problem:</b> {plan.funnel.top}</li>}
              {plan.funnel.middle && <li><b>Comparing:</b> {plan.funnel.middle}</li>}
              {plan.funnel.bottom && <li><b>Ready to buy:</b> {plan.funnel.bottom}</li>}
            </ul>
          </div>
          <button onClick={() => void makePlan()} disabled={planning} className={btn} style={{ border: '1px solid var(--border)' }}>
            {planning ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} New ideas{winnerWords.length ? ' from their winners' : ''}
          </button>
        </div>
      )}
    </div>
  )
}
