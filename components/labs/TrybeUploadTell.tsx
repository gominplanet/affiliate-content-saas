'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Tell <brand> about it", under the videos just sent to that brand
// (lib/trybe-upload-note). One ready message, editable, for all of them; Send
// puts it in the brand's TRYBE chat through SCOUT and says Sent only once it
// shows in the chat (trybe-chat-send); Open the chat opens it in the Inbox.
// No chat yet, telling them already today, a message that talks pay: each is
// said, so a box that did nothing never looks like one that sent.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, MessageCircle, Check, AlertTriangle, ExternalLink } from 'lucide-react'
import type { Conversation } from '@/components/labs/TrybeInbox'
import { sendInTrybeChat } from '@/components/labs/trybe-chat-send'
import { termsHits } from '@/lib/trybe-outreach'
import { uploadNoteText, readTold, rememberTold, toldToday } from '@/lib/trybe-upload-note'
import { brandPageUrl } from '@/lib/trybe-brand-page'

const soft = { color: 'var(--text-soft)' }
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export default function TrybeUploadTell({ brandId, brandName, videos, chat, chatsRead, canChat, me, myName, onOpenChat }: {
  brandId: string
  brandName: string
  /** The videos now in this brand's review, with the products each was tagged with. */
  videos: { products: string[] }[]
  chat: Conversation | null
  /** The chat list was read; a null chat then means there is none. */
  chatsRead: boolean
  /** SCOUT can send in TRYBE chats. */
  canChat: boolean
  me: string[]
  myName: string
  onOpenChat?: (chatId: string) => void
}) {
  const draft = uploadNoteText(brandName, videos, myName)
  const [text, setText] = useState(draft)
  const edited = useRef(false)
  // A new video for this brand rewrites the message, unless it was edited.
  useEffect(() => { if (!edited.current) setText(draft) }, [draft])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [told, setTold] = useState<Date | null>(null)
  const [again, setAgain] = useState(false)
  useEffect(() => { setTold(toldToday(readTold(), brandId)) }, [brandId])

  const payWords = termsHits(text)
  const send = async () => {
    if (!chat || payWords.length) return
    setSending(true); setResult(null)
    try {
      const r = await sendInTrybeChat(chat.id, text.trim(), me, myName)
      if (r.sent) {
        const at = new Date()
        rememberTold(brandId, at)
        setTold(at); setAgain(false)
        setResult({ ok: true, text: r.already ? `That message was already in your ${brandName} chat.` : `Sent in your ${brandName} chat at ${time(at)}.` })
      } else setResult({ ok: false, text: r.text })
    } catch (e) {
      setResult({ ok: false, text: `Not sent: ${e instanceof Error ? e.message : 'SCOUT did not answer'}.` })
    } finally { setSending(false) }
  }

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: '#C4B5FD', background: 'rgba(124,58,237,0.05)' }}>
      <p className="text-[14px] font-semibold inline-flex items-center gap-1.5"><MessageCircle size={15} /> Tell {brandName} about {videos.length === 1 ? 'it' : `your ${videos.length} videos`}</p>

      {told && !again ? (
        <div className="mt-2 text-[13px]">
          <p className="inline-flex items-center gap-1.5" style={{ color: '#15803D' }}><Check size={14} /> {result?.ok ? result.text : `You told ${brandName} at ${time(told)} today.`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chat && onOpenChat && <button type="button" onClick={() => onOpenChat(chat.id)} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>Open the chat</button>}
            <button type="button" onClick={() => { setAgain(true); setResult(null) }} className="text-[12.5px] underline" style={soft}>Write another message</button>
          </div>
        </div>
      ) : (
        <>
          <textarea value={text} onChange={(e) => { edited.current = true; setText(e.target.value) }} rows={5} maxLength={1500}
            className="mt-2 w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          {payWords.length > 0 && (
            <p className="text-[12.5px] mt-1 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> <span>TRYBE messages never talk pay. Take out: {payWords.join(', ')}.</span></p>
          )}
          {!canChat ? (
            <p className="text-[12.5px] mt-2" style={soft}>Sending in TRYBE chats needs SCOUT with TRYBE chats switched on. You can copy the message and send it on TRYBE.</p>
          ) : !chatsRead ? (
            <p className="text-[12.5px] mt-2 inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your TRYBE chats</p>
          ) : !chat ? (
            <p className="text-[12.5px] mt-2" style={soft}>
              You do not have a chat with {brandName} on TRYBE yet.{' '}
              <a href={brandPageUrl(brandId)} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">Open {brandName} on TRYBE <ExternalLink size={11} /></a>
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void send()} disabled={sending || !text.trim() || payWords.length > 0}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send in {brandName} chat
              </button>
              {onOpenChat && <button type="button" onClick={() => onOpenChat(chat.id)} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>Open the chat</button>}
            </div>
          )}
          {result && <p className="text-[12.5px] mt-2" style={{ color: result.ok ? '#15803D' : '#B45309' }}>{result.text}</p>}
        </>
      )}
    </div>
  )
}
