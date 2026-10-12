'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AFTER A BRAND SAYS YES (Cole Schwartz on Oink; Seb 2026-10-12). For each
// brand on TRYBE Outreach's Sent tab that has a conversation with the creator:
//   - what to do next, from who wrote last and when (lib/trybe-playbook
//     afterAccept): message before you film, waiting, no answer in N days
//     (don't film yet), or they answered (safe to film 2 or 3);
//   - the first message (thanks, video ideas, a 10 minute call, their monthly
//     ad spend) and the follow up, written by MVP, edited and sent by the
//     creator into the brand's own TRYBE chat through SCOUT;
//   - video ideas: one body and call to action, ten hooks, each a script to copy.
//
// A message counts as sent only when it shows up in the conversation after,
// the same rule as the Inbox. Every failure says what happened.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Sparkles, Copy, Check, AlertTriangle, Clapperboard, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { listOf, readMessage } from '@/components/labs/TrybeInbox'
import { afterAccept, readChat, scriptFor, HOOK_STYLE_WORDS, type VideoPlan, type ChatRead, type AfterState } from '@/lib/trybe-playbook'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

export interface AfterBrand {
  brand_id: string
  name: string
  kickoff_draft?: string | null
  kickoff_sent_at?: string | null
  followup_sent_at?: string | null
  video_plan?: (VideoPlan & { onSale?: string[]; products?: string[] }) | null
  video_plan_at?: string | null
}

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

const flat = (t: string) => t.replace(/\s+/g, ' ').trim()

// ONE CHAT AT A TIME through SCOUT, kept two minutes per version of the
// chat (its latest message time), so a Sent tab of thirty brands does not
// send thirty requests to TRYBE at once and does not read them twice.
const chatCache = new Map<string, { at: number; read: ChatRead }>()
let chatChain: Promise<unknown> = Promise.resolve()
function readChatQueued(chatId: string, version: number, me: string[], myName: string): Promise<ChatRead> {
  const key = `${chatId}:${version}`
  const hit = chatCache.get(key)
  if (hit && Date.now() - hit.at < 120_000) return Promise.resolve(hit.read)
  const job = chatChain.then(async () => {
    const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(chatId)}/messages?page=1&limit=50`)
    const read: ChatRead = r.ok
      ? readChat(listOf(r.json).map((m) => readMessage(m, me, myName)).filter((m): m is NonNullable<ReturnType<typeof readMessage>> => !!m))
      : { ok: false, myAts: [], brandAts: [] }
    chatCache.set(key, { at: Date.now(), read })
    return read
  })
  chatChain = job.catch(() => null)
  return job
}

export default function TrybeAfterAccept({ b, chatId, lastAt, me, myName, canSend, onPatch, onState }: {
  b: AfterBrand
  chatId: string
  /** The conversation's latest message time: a new message means read again. */
  lastAt: number
  me: string[]
  myName: string
  /** SCOUT can read and post into the TRYBE conversation. */
  canSend: boolean
  onPatch: (p: Partial<AfterBrand>) => void
  /** The stage, told to the page so its counts match the panels. */
  onState?: (brandId: string, state: AfterState) => void
}) {
  // The chat, read message by message (null while reading).
  const [chat, setChat] = useState<ChatRead | null>(null)
  const [composer, setComposer] = useState<{ kind: 'kickoff' | 'followup'; text: string } | null>(null)
  const [writing, setWriting] = useState(false)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [plan, setPlan] = useState<AfterBrand['video_plan']>(b.video_plan || null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [planNote, setPlanNote] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => { setPlan(b.video_plan || null) }, [b.video_plan])

  // EVERY STAGE FROM THE CHAT ITSELF (review 2026-10-12): TRYBE's list often
  // does not say who wrote last, and telling it from the list told a brand
  // that answered "don't film yet". A chat that cannot be read says so.
  useEffect(() => {
    if (!canSend) { setChat({ ok: false, myAts: [], brandAts: [] }); return }
    let live = true
    setChat(null)
    void readChatQueued(chatId, lastAt, me, myName).then((r) => { if (live) setChat(r) }).catch(() => { if (live) setChat({ ok: false, myAts: [], brandAts: [] }) })
    return () => { live = false }
  }, [chatId, lastAt, canSend, me, myName])

  const st = afterAccept({ chat: true, read: chat, kickoffSentAt: b.kickoff_sent_at, followupSentAt: b.followup_sent_at })
  useEffect(() => { onState?.(b.brand_id, st.state) }, [b.brand_id, st.state, onState])
  const tone = st.state === 'answered' ? GREEN : st.state === 'no_answer' ? RED : st.state === 'send_first' ? AMBER : 'var(--text-soft)'

  async function write(kind: 'kickoff' | 'followup', fresh = false) {
    // The first message written before is opened again, not paid for twice.
    if (kind === 'kickoff' && !fresh && b.kickoff_draft) { setComposer({ kind, text: b.kickoff_draft }); setNote(null); return }
    setWriting(true); setNote(null)
    try {
      const d = await api({ action: kind, brandId: b.brand_id })
      setComposer({ kind, text: d.text })
      if (kind === 'kickoff') onPatch({ kickoff_draft: d.text })
      if (!d.researched) setNote({ tone: 'warn', text: 'MVP could not read their website, so the ideas are general. Add a product of theirs before sending.' })
    } catch (e) { setNote({ tone: 'bad', text: e instanceof Error ? e.message : 'MVP could not write it.' }) }
    finally { setWriting(false) }
  }

  async function send() {
    if (!composer) return
    const text = composer.text.trim()
    if (!text) return
    setSending(true); setNote(null)
    try {
      const read = async () => {
        const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(chatId)}/messages?page=1&limit=50`)
        return r.ok ? listOf(r.json).map((m) => readMessage(m, me, myName)).filter(Boolean) as Array<{ id: string; text: string }> : null
      }
      const before = await read()
      // ALREADY THERE (another tab, or a send that went before an error): not
      // posted a second time.
      if (before && before.some((m) => flat(m.text) === flat(text))) {
        setComposer(null)
        setNote({ tone: 'ok', text: 'This message is already in your TRYBE chat, so it was not sent again.' })
        return
      }
      const seenBefore = new Set((before || []).map((m) => m.id))
      const r = await requestTrybeApi('POST', `/backend/api/channels/${encodeURIComponent(chatId)}/messages`, { content: text })
      // Only an answer FROM TRYBE says it was refused. No status (SCOUT lost
      // the page, the tab closed, a timeout) may still have sent it, so the
      // chat is read before anything says "Not sent".
      const maybeSent = !r.ok && !r.status
      if (!r.ok && !maybeSent) { setNote({ tone: 'bad', text: `Not sent: TRYBE answered ${r.status}.` }); return }
      // SENT MEANS SEEN in the conversation, never "the request went".
      const after = await read()
      const seen = !!after && after.some((m) => !seenBefore.has(m.id) && flat(m.text) === flat(text))
      if (!seen) { setNote({ tone: 'warn', text: maybeSent ? `SCOUT lost touch with TRYBE (${r.error || 'no answer'}) and the message does not show in the chat yet. Check it on TRYBE before sending again.` : 'TRYBE did not show the message in the conversation yet. Check it on TRYBE before sending again.' }); return }
      chatCache.clear()
      const kind = composer.kind
      setComposer(null)
      setNote({ tone: 'ok', text: kind === 'kickoff' ? 'Sent. It shows in your TRYBE chat. Wait for a person to answer before you film.' : 'Follow up sent. It shows in your TRYBE chat.' })
      const at = new Date().toISOString()
      onPatch(kind === 'kickoff' ? { kickoff_sent_at: at } : { followup_sent_at: at })
      await api({ action: 'kickoff_sent', brandId: b.brand_id, kind }).catch((e) => setNote({ tone: 'warn', text: `Sent, but MVP could not save when it went: ${e instanceof Error ? e.message : 'error'}` }))
    } finally { setSending(false) }
  }

  async function makePlan() {
    setPlanning(true); setPlanNote(null)
    try {
      const d = await api({ action: 'video_plan', brandId: b.brand_id })
      const p = { ...(d.plan as VideoPlan), onSale: d.onSale || [], products: d.products || [] }
      setPlan(p); setPlanOpen(true)
      onPatch({ video_plan: p, video_plan_at: new Date().toISOString() })
      if (!d.saved) setPlanNote('These ideas are shown but could not be saved, so they will be gone next visit. Copy what you want to keep.')
    } catch (e) { setPlanNote(e instanceof Error ? e.message : 'MVP could not plan the videos.') }
    finally { setPlanning(false) }
  }

  const copy = async (i: number) => {
    if (!plan) return
    try { await navigator.clipboard.writeText(scriptFor(plan, i)); setCopied(i); setTimeout(() => setCopied(null), 2000) } catch { toast.error('Could not copy. Select the text instead.') }
  }

  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50'

  return (
    <div className="mt-2 rounded-lg border px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold" style={{ color: tone }}>{st.label}</span>
        <span style={soft}>{st.says}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {(st.state === 'send_first' || st.state === 'no_answer') && !composer && (
          <button onClick={() => void write(st.state === 'send_first' ? 'kickoff' : 'followup')} disabled={writing || !canSend} className={btn} style={{ background: PURPLE, color: '#fff' }}
            title={canSend ? undefined : 'SCOUT on TRYBE is needed to send it from here.'}>
            {writing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {st.state === 'send_first' ? 'Write the first message' : 'Write a follow up'}
          </button>
        )}
        <button onClick={() => (plan ? setPlanOpen((v) => !v) : void makePlan())} disabled={planning} className={btn}
          style={st.state === 'answered' ? { background: PURPLE, color: '#fff' } : { border: `1px solid ${PURPLE}`, color: PURPLE }}>
          {planning ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />} {plan ? (planOpen ? 'Hide video ideas' : 'Video ideas') : 'Plan videos'}
          {plan && (planOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
      </div>

      {composer && (
        <div className="mt-2">
          <textarea value={composer.text} onChange={(e) => setComposer({ ...composer, text: e.target.value })} rows={8}
            className="w-full rounded-lg border p-2.5 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <button onClick={() => void send()} disabled={sending || !composer.text.trim()} className={btn} style={{ background: PURPLE, color: '#fff' }}>
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send on TRYBE
            </button>
            <button onClick={() => void write(composer.kind, true)} disabled={writing} className={btn} style={{ border: '1px solid var(--border)' }}>
              {writing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Write it again
            </button>
            <button onClick={() => setComposer(null)} className="text-[12px] font-semibold" style={soft}>Cancel</button>
            <span className="text-[11px]" style={soft}>Sent as shown into your chat with {b.name}. Edit anything first.</span>
          </div>
        </div>
      )}
      {note && <p className="mt-1.5 inline-flex items-start gap-1" style={{ color: note.tone === 'ok' ? GREEN : note.tone === 'warn' ? AMBER : RED }}>{note.tone !== 'ok' && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}{note.text}</p>}
      {planNote && <p className="mt-1.5" style={{ color: AMBER }}>{planNote}</p>}

      {plan && planOpen && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>One body, many hooks{plan.product ? `: ${plan.product}` : ''}</p>
            <p className="mt-1 text-[13px]">{plan.body}</p>
            {plan.onSale && plan.onSale.length > 0
              ? <p className="mt-1" style={{ color: GREEN }}>On sale on their store now: {plan.onSale.slice(0, 3).join(', ')}</p>
              : <p className="mt-1" style={soft}>Nothing marked down on their store right now, so no sale line is offered.</p>}
          </div>
          <div>
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
          </div>
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
            {planning ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} New ideas
          </button>
        </div>
      )}
    </div>
  )
}
