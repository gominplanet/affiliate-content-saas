/**
 * Facebook Page webhook — comment→DM automation.
 *
 * GET  : Meta's subscription verification handshake (hub.challenge).
 * POST : signed Page `feed` events → processFacebookCommentEvent (auto-DM the
 *        commenter that post's affiliate link when they say the keyword).
 *
 * Goes LIVE once pages_messaging is App-Review-approved and this URL is set as
 * the Page webhook callback in the Meta app dashboard. Until then it's a
 * dormant, signature-verified endpoint. See project_ig_comment_to_dm.
 *
 * Env:
 *   FB_WEBHOOK_VERIFY_TOKEN — the "Verify token" you paste into Meta's webhook
 *                             config (falls back to IG_WEBHOOK_VERIFY_TOKEN).
 *   FACEBOOK_APP_SECRET     — verifies X-Hub-Signature-256 on every POST.
 */
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { processFacebookCommentEvent, type FbCommentEvent } from '@/lib/fb-dm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── GET: subscription verification ──────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.FB_WEBHOOK_VERIFY_TOKEN || process.env.IG_WEBHOOK_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

// ── POST: event delivery ────────────────────────────────────────────────────
function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.FACEBOOK_APP_SECRET
  if (!secret || !header) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCommentEvents(body: any): FbCommentEvent[] {
  const out: FbCommentEvent[] = []
  for (const entry of (body?.entry ?? [])) {
    const pageId = String(entry?.id ?? '')
    for (const change of (entry?.changes ?? [])) {
      if (change?.field !== 'feed') continue
      const v = change.value ?? {}
      // Only fresh top-level user comments — not edits, likes, shares, or posts.
      if (v.item !== 'comment' || v.verb !== 'add') continue
      const commentId = v.comment_id ? String(v.comment_id) : ''
      if (!commentId) continue
      out.push({
        pageId,
        commentId,
        postId: v.post_id ? String(v.post_id) : null,
        commenterId: v.from?.id ? String(v.from.id) : '',
        text: typeof v.message === 'string' ? v.message : '',
      })
    }
  }
  return out
}

export async function POST(req: Request) {
  const raw = await req.text()

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null
  try { body = JSON.parse(raw) } catch { /* Meta always sends JSON; ignore junk */ }

  // Fast 200 for Meta; process inline (each event is cheap, failures swallowed).
  try {
    for (const ev of extractCommentEvents(body)) {
      try {
        const outcome = await processFacebookCommentEvent(ev)
        console.log('[fb-webhook] comment', { post: ev.postId, page: ev.pageId, outcome })
      } catch (e) {
        console.error('[fb-webhook] processing error', e instanceof Error ? e.message : String(e))
      }
    }
  } catch { /* malformed payload — ack anyway */ }

  return NextResponse.json({ received: true })
}
