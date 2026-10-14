'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WRITING LIKE YOU (Seb, 2026-10-14: "can mvp check the history of messages
// written to brands (the ones not written by mvp) so mvp is able to emulate
// closely what type of responds or info to share to brands").
//
// Once a day, from the Inbox, SCOUT reads the creator's recent TRYBE
// conversations; the messages they sent are checked by the server
// (voice_check), which leaves out what MVP wrote, and the rest are kept in
// this browser. Every writer (a reply, the first message after a yes, a
// follow up, an outreach message) gets them as examples of the creator's
// voice. What MVP suggests is remembered here too, so it is never learned
// back as the creator's own writing. Browser storage only: a page without it
// still writes, just without the examples.

import { useCallback, useEffect, useState } from 'react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { listOf, readMessage, type Conversation } from '@/components/labs/TrybeInbox'
import type { VoiceSample } from '@/lib/trybe-voice'

const VOICE_KEY = 'mvp-trybe-voice'
const MVP_KEY = 'mvp-trybe-mvp-texts'
const DAY = 86_400_000
/** Conversations read for it, newest first. */
export const VOICE_CHATS = 20
/** Chats that are communities, not one brand: what the creator writes there is not how they write to a brand. */
const NOT_A_BRAND = /\b(hub|community|creators?|general|announcements?|vault|lounge|club|team trybe|support)\b/i

export interface VoiceRead { at: number; voice: VoiceSample[]; read: number; chats: number }

const load = <T,>(k: string, fallback: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback } catch { return fallback } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode: not kept */ } }

/** The creator's own messages, for a writer's request body. */
export function readVoice(): VoiceSample[] {
  const v = load<VoiceRead | null>(VOICE_KEY, null)
  return v && Array.isArray(v.voice) ? v.voice.slice(0, 12) : []
}

/** Something MVP wrote (a suggestion, a message after a yes, a follow up),
 *  kept so it is never learned back as the creator's own writing. */
export function rememberMvpText(text: string) {
  const t = String(text || '').trim()
  if (t.length < 20) return
  const list = load<string[]>(MVP_KEY, [])
  save(MVP_KEY, [t.slice(0, 2000), ...list.filter((x) => x !== t)].slice(0, 100))
}

/** Reads the creator's own messages from their recent TRYBE chats and keeps
 *  the ones they wrote themselves. */
export async function collectVoice(convos: Conversation[], me: string[], myName: string, onProgress?: (done: number, total: number) => void): Promise<VoiceRead> {
  const chats = convos.filter((c) => !NOT_A_BRAND.test(c.name)).slice(0, VOICE_CHATS)
  const candidates: VoiceSample[] = []
  for (let i = 0; i < chats.length; i++) {
    onProgress?.(i, chats.length)
    const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(chats[i].id)}/messages?page=1&limit=50`).catch(() => null)
    if (!r || !r.ok) continue
    for (const raw of listOf(r.json)) {
      const m = readMessage(raw, me, myName)
      if (m && m.mine === true && m.text.trim()) candidates.push({ brand: chats[i].name, text: m.text, at: m.at })
    }
  }
  onProgress?.(chats.length, chats.length)
  const res = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000), body: JSON.stringify({ action: 'voice_check', candidates, mvpTexts: load<string[]>(MVP_KEY, []) }) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`)
  const out: VoiceRead = { at: Date.now(), voice: Array.isArray(d.voice) ? d.voice : [], read: candidates.length, chats: chats.length }
  save(VOICE_KEY, out)
  return out
}

/** The Inbox's view of it: what is kept, read again once a day by itself. */
export function useTrybeVoice(convos: Conversation[] | null, me: string[], myName: string, ready: boolean) {
  const [state, setState] = useState<VoiceRead | null>(() => (typeof window === 'undefined' ? null : load<VoiceRead | null>(VOICE_KEY, null)))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!convos || !convos.length || busy) return
    setBusy('Reading your messages...'); setError(null)
    try { setState(await collectVoice(convos, me, myName, (d, t) => setBusy(`Reading your messages: ${d} of ${t} chats`))) }
    catch (e) { setError(`MVP could not read your messages to learn from: ${e instanceof Error ? e.message : 'no answer'}`) }
    finally { setBusy(null) }
  }, [convos, me, myName, busy])
  // Once a day, by itself, once the conversations and who you are are known.
  useEffect(() => {
    if (!ready || !convos?.length || (!me.length && !myName) || busy) return
    if (state && Date.now() - state.at < DAY) return
    void refresh()
  }, [ready, convos, me.length, myName]) // eslint-disable-line react-hooks/exhaustive-deps
  return { state, busy, error, refresh }
}
