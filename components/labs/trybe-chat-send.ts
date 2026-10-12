// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE MESSAGE INTO A BRAND'S TRYBE CHAT, THROUGH SCOUT, shared by the first
// message after a brand accepts (TrybeAfterAccept) and the nudge for videos
// stuck in review (TrybeMyBrands). Sent means SEEN in the conversation after,
// never "the request went"; a message already there is not posted twice; a
// lost answer is read again before anything says "Not sent".

import { requestTrybeApi } from '@/lib/extension-frame'
import { listOf, readMessage } from '@/components/labs/TrybeInbox'

export type ChatSend =
  | { sent: true; already: boolean }
  | { sent: false; tone: 'warn' | 'bad'; text: string }

const flat = (t: string) => t.replace(/\s+/g, ' ').trim()

export async function sendInTrybeChat(chatId: string, text: string, me: string[], myName: string): Promise<ChatSend> {
  const read = async () => {
    const r = await requestTrybeApi('GET', `/backend/api/channels/${encodeURIComponent(chatId)}/messages?page=1&limit=50`)
    return r.ok ? listOf(r.json).map((m) => readMessage(m, me, myName)).filter(Boolean) as Array<{ id: string; text: string }> : null
  }
  const before = await read()
  // ALREADY THERE (another tab, or a send that went before an error).
  if (before && before.some((m) => flat(m.text) === flat(text))) return { sent: true, already: true }
  const seenBefore = new Set((before || []).map((m) => m.id))
  const r = await requestTrybeApi('POST', `/backend/api/channels/${encodeURIComponent(chatId)}/messages`, { content: text })
  // Only an answer FROM TRYBE says it was refused. No status (SCOUT lost the
  // page, the tab closed, a timeout) may still have sent it.
  const maybeSent = !r.ok && !r.status
  if (!r.ok && !maybeSent) return { sent: false, tone: 'bad', text: `Not sent: TRYBE answered ${r.status}.` }
  const after = await read()
  const seen = !!after && after.some((m) => !seenBefore.has(m.id) && flat(m.text) === flat(text))
  if (!seen) {
    return {
      sent: false, tone: 'warn',
      text: maybeSent
        ? `SCOUT lost touch with TRYBE (${r.error || 'no answer'}) and the message does not show in the chat yet. Check it on TRYBE before sending again.`
        : 'TRYBE did not show the message in the conversation yet. Check it on TRYBE before sending again.',
    }
  }
  return { sent: true, already: false }
}
