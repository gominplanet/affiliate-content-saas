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
import { Loader2, RefreshCw, Send, AlertTriangle, MessageCircle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
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
function listOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  if (!isObj(json)) return []
  for (const k of ['data', 'items', 'channels', 'messages', 'results']) {
    const v = json[k]
    if (Array.isArray(v)) return v
    if (isObj(v)) for (const k2 of ['items', 'channels', 'messages', 'data', 'results']) if (Array.isArray(v[k2])) return v[k2] as unknown[]
  }
  return []
}

interface Conversation { id: string; name: string; last: string; at: number; unread: number; raw: Obj }
interface Message { id: string; text: string; who: string; whoId: string; at: number; mine: boolean | null }

function readConversation(raw: unknown): Conversation | null {
  if (!isObj(raw)) return null
  const id = str(raw.id ?? raw.channelId ?? raw.channel_id ?? raw._id)
  if (!id) return null
  const lastObj = (isObj(raw.lastMessage) ? raw.lastMessage : isObj(raw.last_message) ? raw.last_message : null) as Obj | null
  const last = str(lastObj ? pick(lastObj, ['content', 'text', 'body', 'message']) : pick(raw, ['lastMessageText', 'last_message_text', 'preview']))
  const name = str(pick(raw, ['name', 'title', 'channelName', 'displayName', 'brandName', 'brand_name'])) || 'Conversation'
  const atRaw = pick(raw, ['lastMessageAt', 'last_message_at', 'updatedAt', 'updated_at', 'createdAt', 'created_at']) ?? (lastObj ? pick(lastObj, ['createdAt', 'created_at']) : undefined)
  const unread = Number(pick(raw, ['unreadCount', 'unread_count', 'unread', 'unreadMessages'])) || 0
  return { id, name, last, at: Date.parse(str(atRaw)) || 0, unread, raw }
}

function readMessage(raw: unknown, me: string | null): Message | null {
  if (!isObj(raw)) return null
  const id = str(raw.id ?? raw.messageId ?? raw._id)
  const text = str(pick(raw, ['content', 'text', 'body', 'message']))
  if (!id && !text) return null
  const sender = (isObj(raw.sender) ? raw.sender : isObj(raw.user) ? raw.user : isObj(raw.author) ? raw.author : null) as Obj | null
  const who = str(sender ? pick(sender, ['name', 'fullName', 'full_name', 'displayName', 'firstName']) : pick(raw, ['senderName', 'sender_name', 'userName']))
  const whoId = str(sender ? pick(sender, ['id', 'userId', 'user_id']) : pick(raw, ['senderId', 'sender_id', 'userId', 'user_id']))
  const mineFlag = raw.isMine ?? raw.is_mine ?? raw.isOwn ?? raw.is_own ?? raw.fromMe ?? raw.from_me
  const mine = typeof mineFlag === 'boolean' ? mineFlag : (me && whoId ? whoId === me : null)
  const at = Date.parse(str(pick(raw, ['createdAt', 'created_at', 'sentAt', 'sent_at', 'timestamp']))) || 0
  return { id: id || `${at}-${text.slice(0, 12)}`, text, who: who || (mine ? 'You' : 'Brand'), whoId, at, mine }
}

/** What TRYBE sent, when nothing could be read from it, for the screen. */
function shapeOf(json: unknown): string {
  const top = isObj(json) ? Object.keys(json).slice(0, 12).join(', ') : Array.isArray(json) ? 'a list' : typeof json
  const first = listOf(json)[0]
  return `${top}${isObj(first) ? `; first item: ${Object.keys(first).slice(0, 16).join(', ')}` : ''}`
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

export default function TrybeInbox({ scoutVersion, allowed }: { scoutVersion: string | null; allowed: boolean }) {
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
  const [me, setMe] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const [readNote, setReadNote] = useState<string | null>(null)
  const ready = allowed && scoutAtLeast(scoutVersion, SCOUT_TRYBE_INBOX_MIN_VERSION)

  const loadList = useCallback(async (): Promise<Conversation[] | null> => {
    setLoadingList(true); setListNote(null)
    try {
      // Who "you" are on TRYBE, to tell your messages from the brand's.
      if (!me) {
        const p = await requestTrybeApi('GET', '/backend/api/profile')
        const po = isObj(p.json) ? (isObj(p.json.data) ? p.json.data : p.json) : null
        const id = po ? str(pick(po as Obj, ['id', 'userId', 'user_id'])) : ''
        if (id) setMe(id)
      }
      const r = await requestTrybeApi('GET', '/backend/api/channels?page=1&limit=50')
      if (!r.ok) { setListNote(errWords(r)); setConvos([]); return null }
      const list = listOf(r.json).map(readConversation).filter((c): c is Conversation => !!c).sort((a, b) => b.at - a.at)
      setConvos(list)
      if (!list.length) setListNote(listOf(r.json).length ? `MVP could not read TRYBE's conversations. TRYBE sent: ${shapeOf(r.json)}.` : 'No conversations on TRYBE yet.')
      return list
    } finally { setLoadingList(false) }
  }, [me])

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) { setLoadingMsgs(true); setMsgNote(null) }
    try {
      const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(id)}/messages?page=1&limit=50`)
      if (!r.ok) { setMsgNote(errWords(r)); if (!quiet) setMsgs([]); return [] as Message[] }
      const list = listOf(r.json).map(m => readMessage(m, me)).filter((m): m is Message => !!m).sort((a, b) => a.at - b.at)
      setMsgs(list)
      if (!list.length && listOf(r.json).length) setMsgNote(`MVP could not read these messages. TRYBE sent: ${shapeOf(r.json)}.`)
      return list
    } finally { if (!quiet) setLoadingMsgs(false) }
  }, [me])

  useEffect(() => { if (ready && convos === null) void loadList() }, [ready, convos, loadList])
  // THE THREAD SCROLLS, NOT THE PAGE (Seb, 2026-10-07: "the window always
  // kind of jumps up. And then comes back down"). scrollIntoView moved every
  // scrolling box up to the page itself to bring the last message into view.
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight }, [msgs])

  async function open(c: Conversation) {
    setOpenId(c.id); setMsgs(null); setReply(''); setSendNote(null); setReadNote(null)
    const list = await loadMessages(c.id)
    if (c.unread > 0) await markRead(c, list)
  }

  /** READ ON TRYBE, NOT JUST HERE (Seb, 2026-10-07: "if I've read the message
   *  it should not be there"). Opening a conversation tells TRYBE it was read,
   *  then the list is read again from TRYBE, so the purple count shows what
   *  TRYBE now says rather than what MVP hopes. A count TRYBE keeps is said. */
  async function markRead(c: Conversation, list: Message[]) {
    const path = `/backend/api/channels/${encodeURIComponent(c.id)}/read`
    let r = await requestTrybeApi('POST', path, {})
    const lastId = list.length ? list[list.length - 1].id : ''
    if (!r.ok && r.status && r.status >= 400 && r.status < 500 && lastId) r = await requestTrybeApi('POST', path, { messageId: lastId })
    if (!r.ok) { setReadNote(`TRYBE did not mark this read: ${errWords(r)}`); return }
    const fresh = await loadList()
    const now = fresh?.find(x => x.id === c.id)
    if (now && now.unread > 0) setReadNote(`TRYBE still counts ${now.unread} unread here. It may clear when you open it on TRYBE.`)
  }

  async function sendReply() {
    const text = reply.trim()
    if (!openId || !text) return
    setSending(true); setSendNote(null)
    try {
      // The reply's shape. Confirmed 2026-10-07: a reply sent from MVP this way
      // showed in the conversation on TRYBE (Seb checked it on TRYBE's side).
      const r = await requestTrybeApi('POST', `/backend/api/channels/${encodeURIComponent(openId)}/messages`, { content: text })
      if (!r.ok) { setSendNote({ tone: 'bad', text: `Not sent: ${errWords(r)}${r.text ? ` (${r.text.slice(0, 160)})` : ''}` }); return }
      // SENT MEANS SEEN: read the conversation again and look for it.
      const after = await loadMessages(openId, true)
      // Compared with spacing flattened: TRYBE may store line breaks or runs
      // of spaces differently, and that is still the same reply.
      const flat = (t: string) => t.replace(/\s+/g, ' ').trim()
      const seen = after.some(m => flat(m.text) === flat(text))
      if (seen) { setReply(''); setSendNote({ tone: 'ok', text: 'Sent. It shows in the conversation on TRYBE.' }) }
      else setSendNote({ tone: 'warn', text: 'TRYBE accepted the reply but it does not show in the conversation yet. Check it on TRYBE before sending it again.' })
    } finally { setSending(false) }
  }

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
            <div className="px-4 py-3 border-b text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}>{openConvo.name}</div>
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
              <div className="flex items-center gap-3 mt-2">
                {sendNote && (
                  <span className="text-[12px] inline-flex items-center gap-1" style={{ color: sendNote.tone === 'ok' ? '#16A34A' : sendNote.tone === 'bad' ? RED : AMBER }}>
                    {sendNote.tone !== 'ok' && <AlertTriangle size={12} />} {sendNote.text}
                  </span>
                )}
                <button onClick={() => void sendReply()} disabled={sending || !reply.trim()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: PURPLE }}>
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
