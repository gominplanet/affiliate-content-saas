'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Inbox (Labs). Seb, 2026-10-07: "reading and replying to messages
// right on MVP". The creator's TRYBE conversations, read and answered here.
//
// Nothing is kept on MVP's servers: each list, conversation and reply is a
// request SCOUT makes from the creator's own signed-in TRYBE tab
// (MVP_TRYBE_API, SCOUT 1.41.5), to TRYBE's own chat addresses:
//   GET  /backend/api/channels?page=1&limit=50              the conversations
//   GET  /backend/api/channels/<id>/messages?page=1&limit=50 one conversation
//   POST /backend/api/channels/<id>/messages                 a reply
//   POST /backend/api/channels/<id>/read                     marks it read
//
// TRYBE's field names were seen only in part, so each field is found by the
// names it is likely to have, and when nothing could be read the screen says
// which fields TRYBE sent instead of showing an empty inbox as if it were one.
// A reply counts as sent only when it shows up in the conversation after.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Send, AlertTriangle, MessageCircle, Sparkles, Undo2 } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import TrybeLink from '@/components/labs/TrybeLink'
import { replyBlanks } from '@/lib/trybe-outreach'
import { SCOUT_TRYBE_INBOX_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

const PURPLE = '#7C3AED'
const RED = '#DC2626'
const AMBER = '#B45309'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The first non-empty value under any of these keys, in order, on the object
 *  or one level inside it. */
function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) { const v = o[k]; if (v != null && v !== '') return v }
  for (const v of Object.values(o)) if (isObj(v)) for (const k of keys) { const w = v[k]; if (w != null && w !== '') return w }
  return undefined
}
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** The list inside a TRYBE answer: `data`, `data.items`, `items`, `channels`,
 *  `messages`, or the answer itself. */
export function listOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  if (!isObj(json)) return []
  for (const k of ['data', 'items', 'channels', 'messages', 'results']) {
    const v = json[k]
    if (Array.isArray(v)) return v
    if (isObj(v)) for (const k2 of ['items', 'channels', 'messages', 'data', 'results']) if (Array.isArray(v[k2])) return v[k2] as unknown[]
  }
  return []
}

export interface Conversation { id: string; name: string; last: string; at: number; unread: number; raw: Obj }
interface Message { id: string; text: string; who: string; whoId: string; whoIds: string[]; at: number; mine: boolean | null }

/** UNREAD, IN EVERY SHAPE TRYBE MAY USE (Seb, 2026-10-08: a new chat from
 *  OROS was new on TRYBE and not on MVP). A count when TRYBE gives one; else a
 *  yes/no flag; else the time it was last read against its latest message. */
function unreadOf(raw: Obj, at: number): number {
  const n = pick(raw, ['unreadCount', 'unread_count', 'unreadMessages', 'unread_messages', 'unreadMessageCount', 'newMessages', 'unread'])
  if (typeof n === 'number' && n > 0) return n
  if (typeof n === 'string' && Number(n) > 0) return Number(n)
  if (n === true) return 1
  const flag = pick(raw, ['hasUnread', 'has_unread', 'isUnread', 'is_unread', 'unseen', 'isNew'])
  if (flag === true) return 1
  const readRaw = pick(raw, ['lastReadAt', 'last_read_at', 'readAt', 'read_at', 'lastSeenAt', 'last_seen_at', 'lastViewedAt'])
  const readAt = Date.parse(str(readRaw))
  if (at > 0 && readRaw !== undefined && (!Number.isFinite(readAt) || at > readAt + 1000)) return 1
  return typeof n === 'number' ? n : 0
}

export function readConversation(raw: unknown): Conversation | null {
  if (!isObj(raw)) return null
  const id = str(raw.id ?? raw.channelId ?? raw.channel_id ?? raw._id)
  if (!id) return null
  const lastObj = (isObj(raw.lastMessage) ? raw.lastMessage : isObj(raw.last_message) ? raw.last_message : null) as Obj | null
  const last = str(lastObj ? pick(lastObj, ['content', 'text', 'body', 'message']) : pick(raw, ['lastMessageText', 'last_message_text', 'preview']))
  const name = str(pick(raw, ['name', 'title', 'channelName', 'displayName', 'brandName', 'brand_name'])) || 'Conversation'
  const atRaw = pick(raw, ['lastMessageAt', 'last_message_at', 'updatedAt', 'updated_at', 'createdAt', 'created_at']) ?? (lastObj ? pick(lastObj, ['createdAt', 'created_at']) : undefined)
  const at = Date.parse(str(atRaw)) || 0
  return { id, name, last, at, unread: unreadOf(raw, at), raw }
}

export function readMessage(raw: unknown, me: string[], myName = ''): Message | null {
  if (!isObj(raw)) return null
  const id = str(raw.id ?? raw.messageId ?? raw._id)
  const text = str(pick(raw, ['content', 'text', 'body', 'message']))
  if (!id && !text) return null
  const sender = (isObj(raw.sender) ? raw.sender : isObj(raw.user) ? raw.user : isObj(raw.author) ? raw.author : isObj(raw.from) ? raw.from : isObj(raw.createdBy) ? raw.createdBy : null) as Obj | null
  const who = str(sender ? pick(sender, ['name', 'fullName', 'full_name', 'displayName', 'firstName']) : pick(raw, ['senderName', 'sender_name', 'userName']))
  const whoId = str(sender ? pick(sender, ['id', 'userId', 'user_id']) : pick(raw, ['senderId', 'sender_id', 'userId', 'user_id']))
  // The sender may be named by more than one id: any of them that is yours counts.
  // Only who SENT it: never a quoted message's sender, so a reply to your
  // message is not taken for yours.
  const whoIds = [whoId, ...(sender ? [sender.id, sender._id, sender.userId, sender.user_id, sender.creatorId, sender.profileId] : []),
    raw.senderId, raw.sender_id, raw.userId, raw.user_id, raw.authorId, raw.author_id, raw.fromId, raw.from_id, raw.createdById, raw.created_by,
    typeof raw.createdBy === 'string' ? raw.createdBy : '', typeof raw.from === 'string' ? raw.from : '', typeof raw.user === 'string' ? raw.user : '', typeof raw.sender === 'string' ? raw.sender : ''].map(str).filter(Boolean)
  const mineFlag = raw.isMine ?? raw.is_mine ?? raw.isOwn ?? raw.is_own ?? raw.fromMe ?? raw.from_me
  // YOUR FULL NAME, when no id matches (Seb, 2026-10-07: his own message
  // still showed on the brand's side, though TRYBE's profile id was read).
  // TRYBE shows the sender's first and last name; only the whole name counts,
  // so another Sebastien in a group chat is not taken for you.
  const senderFull = sender ? fullName(sender) : ''
  const byId = me.length && whoIds.length ? whoIds.some(w => me.includes(w)) : false
  const byName = !!myName && !!senderFull && senderFull === myName
  const mine = typeof mineFlag === 'boolean' ? mineFlag : (byId || byName) ? true : (me.length || myName ? false : null)
  const at = Date.parse(str(pick(raw, ['createdAt', 'created_at', 'sentAt', 'sent_at', 'timestamp']))) || 0
  return { id: id || `${at}-${text.slice(0, 12)}`, text, who: who || (mine ? 'You' : 'Brand'), whoId, whoIds, at, mine }
}

/** EVERY ID THAT COULD BE YOU (Seb, 2026-10-07: his own message showed on
 *  the brand's side). TRYBE's profile can carry a profile id and a user id;
 *  taking the first one found missed when messages name the other. Every id
 *  under an id-like key, three levels deep, counts. */
export function myIds(json: unknown): string[] {
  const out = new Set<string>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 3) return
    if (Array.isArray(v)) { v.slice(0, 5).forEach(x => walk(x, depth + 1)); return }
    if (!isObj(v)) return
    for (const [k, w] of Object.entries(v)) {
      if (/^(id|_id|userId|user_id|creatorId|creator_id|profileId|profile_id|authId|auth_id|uid|sub)$/.test(k) && (typeof w === 'string' || typeof w === 'number') && String(w).length >= 4) out.add(String(w))
      else if (isObj(w) || Array.isArray(w)) walk(w, depth + 1)
    }
  }
  walk(json, 0)
  return Array.from(out)
}

/** First and last name, lower case, or a whole-name field: '' when only part
 *  of a name is there. */
export function fullName(o: Obj): string {
  const first = str(o.firstName ?? o.first_name).trim(), last = str(o.lastName ?? o.last_name).trim()
  const whole = first && last ? `${first} ${last}` : str(o.fullName ?? o.full_name).trim()
  return whole.replace(/\s+/g, ' ').toLowerCase()
}

/** What TRYBE sent, when nothing could be read from it, for the screen. */
function shapeOf(json: unknown): string {
  const top = isObj(json) ? Object.keys(json).slice(0, 12).join(', ') : Array.isArray(json) ? 'a list' : typeof json
  const first = listOf(json)[0]
  return `${top}${isObj(first) ? `; first item: ${Object.keys(first).slice(0, 16).join(', ')}` : ''}`
}

/** Sender ids learned from replies sent here, kept in this browser so your
 *  messages line up from the first look next time. Best-effort storage. */
const ME_KEY = 'mvp-trybe-me-ids'
function savedMe(): string[] {
  try { const v = JSON.parse(localStorage.getItem(ME_KEY) || '[]'); return Array.isArray(v) ? v.map(String).slice(0, 20) : [] } catch { return [] }
}

/** Who wrote a conversation's last message: you (true), them (false), or
 *  unknown (null). */
export function lastIsMine(c: Conversation, me: string[], myName: string): boolean | null {
  const lastObj = isObj(c.raw.lastMessage) ? c.raw.lastMessage : isObj(c.raw.last_message) ? c.raw.last_message : null
  if (!lastObj) return null
  return readMessage(lastObj, me, myName)?.mine ?? null
}

/** The conversation list and who you are, for the page around the inbox:
 *  unread counts and which sent brands answered. */
export async function fetchTrybeInbox(): Promise<{ ok: true; convos: Conversation[]; me: string[]; myName: string } | { ok: false; error: string }> {
  const p = await requestTrybeApi('GET', '/backend/api/profile')
  const po = isObj(p.json) && isObj(p.json.data) ? p.json.data : isObj(p.json) ? p.json : null
  const me = Array.from(new Set([...(p.ok ? myIds(p.json) : []), ...(typeof window === 'undefined' ? [] : savedMe())]))
  const myName = po ? fullName(po as Obj) : ''
  const r = await requestTrybeApi('GET', '/backend/api/channels?page=1&limit=100')
  if (!r.ok) return { ok: false, error: errWords(r) }
  return { ok: true, convos: listOf(r.json).map(readConversation).filter((c): c is Conversation => !!c), me, myName }
}

const SAY: Record<string, string> = {
  'no-access': 'SCOUT is not allowed on TRYBE yet. Allow it at the top of this page.',
  'not-allowed': 'SCOUT refused that request: it only reads and answers TRYBE conversations.',
  'could-not-open-trybe': 'SCOUT could not open TRYBE in this Chrome.',
  'no-answer-from-page': 'The TRYBE page did not answer.',
  timeout: 'TRYBE took too long to answer.',
}
const errWords = (r: { error?: string; status?: number }) =>
  r.error ? (SAY[r.error] || r.error) : r.status === 401 || r.status === 403 ? `TRYBE refused it (${r.status}): open jointrybe.com, sign in, and try again.` : `TRYBE answered ${r.status ?? 'nothing'}.`

export default function TrybeInbox({ scoutVersion, allowed, openRequest, onOpened, onConvos, brandLink, scoutOpens = false }: {
  scoutVersion: string | null; allowed: boolean
  /** A conversation the page asked to open (Sent's "Open chat"). */
  openRequest?: { id: string; n: number } | null
  /** Told once the requested conversation is open, so it is not opened again
   *  on the next visit to the Inbox tab. */
  onOpened?: () => void
  /** Every fresh conversation list, so the page's unread count follows. */
  onConvos?: (convos: Conversation[]) => void
  /** The brand's own TRYBE page for a conversation, when it is a brand on
   *  the creator's list. */
  brandLink?: (conversationName: string) => { id: string; name: string } | null
  /** SCOUT can open the brand's own popup (1.41.8). */
  scoutOpens?: boolean
}) {
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [listNote, setListNote] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const [msgNote, setMsgNote] = useState<string | null>(null)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const [me, setMe] = useState<string[]>(() => (typeof window === 'undefined' ? [] : savedMe()))
  const [myName, setMyName] = useState('')
  const threadRef = useRef<HTMLDivElement | null>(null)
  // The conversation on screen, for answers that arrive late: an answer for
  // another conversation is dropped, never shown under this one's name.
  const openRef = useRef<string | null>(null)
  const listing = useRef(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  // SUGGEST A REPLY (Seb, 2026-10-08 upgrade 2): what the box held before, to
  // put back, and the [brackets] the suggestion left for the creator to fill.
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNote, setSuggestNote] = useState<string | null>(null)
  const [beforeSuggest, setBeforeSuggest] = useState<string | null>(null)
  const [blanks, setBlanks] = useState<string[]>([])
  const ready = allowed && scoutAtLeast(scoutVersion, SCOUT_TRYBE_INBOX_MIN_VERSION)

  const loadList = useCallback(async (): Promise<Conversation[] | null> => {
    if (listing.current) return null
    listing.current = true
    setLoadingList(true); setListNote(null)
    try {
      // Who "you" are on TRYBE, to tell your messages from the brand's.
      if (!myName) {
        const p = await requestTrybeApi('GET', '/backend/api/profile')
        const ids = p.ok ? myIds(p.json) : []
        if (ids.length) setMe(prev => Array.from(new Set([...prev, ...ids])))
        const po = isObj(p.json) && isObj(p.json.data) ? p.json.data : isObj(p.json) ? p.json : null
        if (po) setMyName(fullName(po as Obj))
      }
      const r = await requestTrybeApi('GET', '/backend/api/channels?page=1&limit=100')
      if (!r.ok) { setListNote(errWords(r)); setConvos([]); return null }
      const list = listOf(r.json).map(readConversation).filter((c): c is Conversation => !!c).sort((a, b) => b.at - a.at)
      setConvos(list)
      onConvos?.(list)
      if (!list.length) setListNote(listOf(r.json).length ? `MVP could not read TRYBE's conversations. TRYBE sent: ${shapeOf(r.json)}.` : 'No conversations on TRYBE yet.')
      return list
    } finally { setLoadingList(false); listing.current = false }
  }, [myName, onConvos]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) { setLoadingMsgs(true); setMsgNote(null) }
    try {
      const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(id)}/messages?page=1&limit=50`)
      const current = openRef.current === id
      if (!r.ok) { if (current) { setMsgNote(errWords(r)); if (!quiet) setMsgs([]) } return [] as Message[] }
      const list = listOf(r.json).map(m => readMessage(m, me, myName)).filter((m): m is Message => !!m).sort((a, b) => a.at - b.at)
      if (current) {
        setMsgs(list)
        if (!list.length && listOf(r.json).length) setMsgNote(`MVP could not read these messages. TRYBE sent: ${shapeOf(r.json)}.`)
      }
      return list
    } finally { if (!quiet && openRef.current === id) setLoadingMsgs(false) }
  }, [me, myName])

  useEffect(() => { if (ready && convos === null) void loadList() }, [ready, convos, loadList])
  // KEPT CURRENT: the list is read again every two minutes while the page is
  // in view, so a new conversation shows without pressing Refresh.
  useEffect(() => {
    if (!ready) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') void loadList() }, 120_000)
    return () => clearInterval(t)
  }, [ready, loadList])
  // Sent's "Open chat": open that conversation once the list is here.
  const handled = useRef(0)
  useEffect(() => {
    if (!openRequest || !convos || handled.current === openRequest.n) return
    const c = convos.find(x => x.id === openRequest.id)
    if (c) { handled.current = openRequest.n; void open(c); onOpened?.() }
  }, [openRequest, convos]) // eslint-disable-line react-hooks/exhaustive-deps
  // THE THREAD SCROLLS, NOT THE PAGE (Seb, 2026-10-07: "the window always
  // kind of jumps up. And then comes back down"). scrollIntoView moved every
  // scrolling box up to the page itself to bring the last message into view.
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs])

  async function open(c: Conversation) {
    openRef.current = c.id
    setOpenId(c.id); setMsgs(null); setReply(''); setSendNote(null); setReadNote(null); setSuggestNote(null); setBeforeSuggest(null); setBlanks([])
    const list = await loadMessages(c.id)
    if (c.unread > 0) await markRead(c, list)
  }

  /** READ ON TRYBE, NOT JUST HERE (Seb, 2026-10-07: "if I've read the message
   *  it should not be there"). Opening a conversation tells TRYBE it was read,
   *  then the list is read again from TRYBE, so the purple count shows what
   *  TRYBE now says rather than what MVP hopes. A count TRYBE keeps is said. */
  async function markRead(c: Conversation, list: Message[]) {
    const path = `/backend/api/channels/${encodeURIComponent(c.id)}/read`
    // TRYBE's own read request, seen 2026-10-07: { messageId } of the latest
    // message, the one read up to.
    const lastId = list.length ? list[list.length - 1].id : ''
    if (!lastId) { setReadNote('MVP could not mark this read: no message was read from TRYBE.'); return }
    const r = await requestTrybeApi('POST', path, { messageId: lastId })
    if (!r.ok) { setReadNote(`TRYBE did not mark this read: ${errWords(r)}`); return }
    const fresh = await loadList()
    const now = fresh?.find(x => x.id === c.id)
    if (now && now.unread > 0) setReadNote(`TRYBE still counts ${now.unread} unread here. It may clear when you open it on TRYBE.`)
  }

  async function suggestReply() {
    const id = openId, convo = convos?.find(c => c.id === id)
    if (!id || !msgs?.length) return
    setSuggesting(true); setSuggestNote(null)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'suggest_reply', brandName: convo?.name || '', messages: msgs.slice(-30).map(m => ({ mine: m.mine, who: m.who, text: m.text })),
      }) })
      const d = await r.json().catch(() => ({}))
      if (openRef.current !== id) return // another conversation is open now
      if (!r.ok || !d.text) { setSuggestNote(d.error || `MVP could not write a suggestion (${r.status}).`); return }
      // Suggest another keeps what the creator wrote themselves to go back to.
      setBeforeSuggest(b => b ?? reply)
      setReply(d.text)
      setBlanks(Array.isArray(d.blanks) ? d.blanks : replyBlanks(d.text))
      setSendNote(null)
    } catch {
      if (openRef.current === id) setSuggestNote('MVP could not write a suggestion. Check your connection and try again.')
    } finally { setSuggesting(false) }
  }

  async function sendReply() {
    const text = reply.trim()
    if (!openId || !text) return
    setSending(true); setSendNote(null)
    // ONLY A NEW MESSAGE CONFIRMS IT: an older message with the same words (a
    // brand's "Thanks!") neither confirms this reply nor teaches who you are.
    const before = new Set((msgs || []).map(m => m.id))
    try {
      // The reply's shape. Confirmed 2026-10-07: a reply sent from MVP this way
      // showed in the conversation on TRYBE (Seb checked it on TRYBE's side).
      const r = await requestTrybeApi('POST', `/backend/api/channels/${encodeURIComponent(openId)}/messages`, { content: text })
      // A REPLY THAT TIMED OUT MAY HAVE GONE: the conversation is read again
      // before anything says "Not sent", so it is never sent twice by mistake.
      const timedOut = !r.ok && (r.error === 'timeout' || r.error === 'SCOUT did not answer.')
      if (!r.ok && !timedOut) { setSendNote({ tone: 'bad', text: `Not sent: ${errWords(r)}${r.text ? ` (${r.text.slice(0, 160)})` : ''}` }); return }
      // SENT MEANS SEEN: read the conversation again and look for it.
      const after = await loadMessages(openId, true)
      // Compared with spacing flattened: TRYBE may store line breaks or runs
      // of spaces differently, and that is still the same reply.
      const flat = (t: string) => t.replace(/\s+/g, ' ').trim()
      const mineNow = after.filter(m => !before.has(m.id) && flat(m.text) === flat(text))
      const seen = mineNow.length > 0
      if (seen) {
        setReply(''); setBeforeSuggest(null); setBlanks([]); setSendNote({ tone: 'ok', text: 'Sent. It shows in the conversation on TRYBE.' })
        // A REPLY SENT HERE IS YOURS FOR CERTAIN: whatever id TRYBE gave its
        // sender is you, so every message from that id lines up as yours.
        const learned = mineNow.flatMap(m => m.whoIds)
        if (learned.length) {
          const next = Array.from(new Set([...me, ...learned]))
          setMe(next)
          try { localStorage.setItem(ME_KEY, JSON.stringify(next.slice(0, 20))) } catch { /* this browser only */ }
          setMsgs(ms => (ms || []).map(m => m.whoIds.some(w => next.includes(w)) ? { ...m, mine: true } : m))
        }
        // The list shows the new latest message.
        void loadList()
      }
      else setSendNote({ tone: 'warn', text: timedOut ? 'TRYBE did not answer in time, and the reply does not show in the conversation yet. Check it on TRYBE before sending it again.' : 'TRYBE accepted the reply but it does not show in the conversation yet. Check it on TRYBE before sending it again.' })
    } finally { setSending(false) }
  }

  // Brackets from a suggestion still in the box: the reply is not ready yet.
  const blanksLeft = blanks.filter(b => reply.includes(b))
  const lastIsYours = !!msgs?.length && msgs[msgs.length - 1].mine === true
  const openConvo = useMemo(() => convos?.find(c => c.id === openId) || null, [convos, openId])
  const card = 'rounded-2xl border'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const soft = { color: 'var(--text-soft)' }

  if (!allowed) return <div className={`${card} p-5 text-[13px]`} style={cardStyle}>Allow SCOUT on TRYBE at the top of this page to read your TRYBE conversations here.</div>
  if (!scoutAtLeast(scoutVersion, SCOUT_TRYBE_INBOX_MIN_VERSION)) {
    return <div className={`${card} p-5 text-[13px]`} style={{ ...cardStyle, color: AMBER }}>Reading TRYBE conversations needs SCOUT {SCOUT_TRYBE_INBOX_MIN_VERSION}. Yours is {scoutVersion || 'unknown'}; Chrome updates it by itself.</div>
  }

  return (
    <div className={`${card} overflow-hidden`} style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <MessageCircle size={15} style={{ color: PURPLE }} />
        <p className="text-[14px] font-semibold">TRYBE inbox</p>
        <span className="text-[12px]" style={soft}>Read live from TRYBE through SCOUT; nothing is stored on MVP.</span>
        <button onClick={() => { void loadList(); if (openId) void loadMessages(openId) }} disabled={loadingList} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold disabled:opacity-50" style={{ color: PURPLE }}>
          {loadingList ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>
      <div className="grid md:grid-cols-[18rem_1fr] min-h-[28rem]">
        <div className="border-r overflow-y-auto max-h-[36rem]" style={{ borderColor: 'var(--border)' }}>
          {convos === null && <p className="p-4 text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your conversations...</p>}
          {listNote && <p className="p-4 text-[12px]" style={{ color: convos?.length ? 'inherit' : AMBER }}>{listNote}</p>}
          {(convos || []).map(c => (
            <button key={c.id} onClick={() => void open(c)} className="w-full text-left px-4 py-3 border-b block"
              style={{ borderColor: 'var(--border)', background: c.id === openId ? 'rgba(124,58,237,0.08)' : 'transparent' }}>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-[13px] truncate">{c.name}</span>
                {c.unread > 0 && <span className="ml-auto text-[10px] font-bold rounded-full px-1.5 py-0.5 text-white" style={{ background: PURPLE }}>{c.unread}</span>}
              </span>
              {c.last && <span className="block text-[12px] truncate mt-0.5" style={soft}>{c.last}</span>}
              {c.at > 0 && <span className="block text-[11px] mt-0.5" style={soft}>{new Date(c.at).toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-col">
          {!openConvo && <p className="m-auto text-[13px]" style={soft}>Pick a conversation.</p>}
          {openConvo && (<>
            <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
              <span className="text-[13px] font-semibold">{openConvo.name}</span>
              {(() => { const b = brandLink?.(openConvo.name); return b ? (
                <span className="ml-auto"><TrybeLink brandId={b.id} name={b.name} scout={scoutOpens} label="Brand page on TRYBE" /></span>) : null })()}
            </div>
            <div ref={threadRef} className="flex-1 overflow-y-auto max-h-[28rem] px-4 py-3 space-y-2">
              {loadingMsgs && <p className="text-[12px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading the conversation...</p>}
              {msgNote && <p className="text-[12px]" style={{ color: AMBER }}>{msgNote}</p>}
              {readNote && <p className="text-[12px]" style={{ color: AMBER }}>{readNote}</p>}
              {(msgs || []).map(m => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%] rounded-2xl px-3 py-2 text-[13px] whitespace-pre-wrap"
                    style={m.mine ? { background: PURPLE, color: '#fff' } : { background: 'var(--surface-2, rgba(0,0,0,0.05))' }}>
                    {!m.mine && <span className="block text-[11px] font-semibold mb-0.5" style={soft}>{m.who}</span>}
                    {m.text}
                    {m.at > 0 && <span className="block text-[10px] mt-1 opacity-70">{new Date(m.at).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} placeholder="Write a reply. Line breaks are kept."
                className="w-full rounded-lg border p-2.5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
              {blanksLeft.length > 0 && (
                <p className="text-[12px] mt-1.5 inline-flex items-start gap-1" style={{ color: AMBER }}>
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Fill in before sending: {blanksLeft.join(', ')}. MVP never guesses a rate, an address or a date for you.
                </p>
              )}
              {suggestNote && <p className="text-[12px] mt-1.5" style={{ color: RED }}>{suggestNote}</p>}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <button onClick={() => void suggestReply()} disabled={suggesting || sending || !msgs?.length || lastIsYours}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${PURPLE}`, color: PURPLE }}
                  title={lastIsYours ? 'The last message is yours. MVP suggests a reply once the brand answers.' : !msgs?.length ? 'Open a conversation with messages first.' : 'MVP writes a reply to the brand\u2019s latest message in your voice. You edit it, then send.'}>
                  {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {beforeSuggest !== null ? 'Suggest another' : 'Suggest a reply'}
                </button>
                {beforeSuggest !== null && (
                  <button onClick={() => { setReply(beforeSuggest); setBeforeSuggest(null); setBlanks([]) }} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--text-soft)' }}>
                    <Undo2 size={12} /> {beforeSuggest ? 'Back to what you wrote' : 'Clear'}
                  </button>
                )}
                {sendNote && (
                  <span className="text-[12px] inline-flex items-center gap-1" style={{ color: sendNote.tone === 'ok' ? '#16A34A' : sendNote.tone === 'bad' ? RED : AMBER }}>
                    {sendNote.tone !== 'ok' && <AlertTriangle size={12} />} {sendNote.text}
                  </span>
                )}
                <button onClick={() => void sendReply()} disabled={sending || suggesting || !reply.trim() || blanksLeft.length > 0}
                  title={blanksLeft.length ? `Fill in ${blanksLeft.join(', ')} first.` : undefined} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
                  {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send reply
                </button>
              </div>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}
