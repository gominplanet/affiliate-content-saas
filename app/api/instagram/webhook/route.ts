/**
 * Instagram webhook — comment→DM automation (Phase 1).
 *
 * GET  : Meta's subscription verification handshake (hub.challenge).
 * POST : signed comment events → processCommentEvent (auto-DM the commenter that
 *        post's affiliate link when they say the keyword).
 *
 * Goes LIVE only once the messaging/comment permissions are App-Review-approved
 * and this URL is subscribed in the Meta app dashboard. Until then it's a
 * dormant, signature-verified endpoint — safe to ship. See project_ig_comment_to_dm.
 *
 * Env:
 *   IG_WEBHOOK_VERIFY_TOKEN — arbitrary shared secret you also paste into Meta's
 *                             "Verify token" field when subscribing.
 *   INSTAGRAM_APP_SECRET    — used to verify X-Hub-Signature-256 on every POST.
 */
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { processCommentEvent, type IgCommentEvent } from '@/lib/ig-dm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── GET: subscription verification ──────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.IG_WEBHOOK_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    // Meta expects the raw challenge echoed back as text/plain.
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

// ── POST: event delivery ────────────────────────────────────────────────────
function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!secret || !header) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  // Constant-time compare; guard against length mismatch (timingSafeEqual throws).
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCommentEvents(body: any): IgCommentEvent[] {
  const out: IgCommentEvent[] = []
  for (const entry of (body?.entry ?? [])) {
    const igAccountId = String(entry?.id ?? '')
    for (const change of (entry?.changes ?? [])) {
      if (change?.field !== 'comments') continue
      const v = change.value ?? {}
      const commentId = v.id ? String(v.id) : ''
      if (!commentId) continue
      out.push({
        igAccountId,
        commentId,
        text: typeof v.text === 'string' ? v.text : '',
        commenterId: v.from?.id ? String(v.from.id) : '',
        mediaId: v.media?.id ? String(v.media.id) : null,
      })
    }
  }
  return out
}

export async function POST(req: Request) {
  const raw = await req.text()

  // Reject anything not signed by our app secret.
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null
  try { body = JSON.parse(raw) } catch { /* Meta always sends JSON; ignore junk */ }

  // Meta requires a fast 200 or it retries/disables the subscription. We still
  // process inline (Vercel can't truly background work after responding), but
  // each event is cheap and every failure is swallowed into the send log.
  try {
    const events = extractCommentEvents(body)
    for (const ev of events) {
      try {
        const outcome = await processCommentEvent(ev)
        console.log('[ig-webhook] comment', { media: ev.mediaId, account: ev.igAccountId, outcome })
      } catch (e) {
        console.error('[ig-webhook] processing error', e instanceof Error ? e.message : String(e))
      }
    }
  } catch { /* malformed payload — ack anyway */ }

  return NextResponse.json({ received: true })
}
