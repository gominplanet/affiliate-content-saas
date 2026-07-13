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
import { createAdminClient } from '@/lib/supabase/admin'

// Diagnostic breadcrumb → ig_dm_sends (shows up in the Auto-DM status panel's
// "Recent attempts"). Lets us SEE whether Meta is delivering events at all, vs.
// us dropping them (bad signature / a non-comment event). No PII stored.
async function logFbDiag(error: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createAdminClient() as any).from('ig_dm_sends').insert({
      comment_id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'skipped',
      error: error.slice(0, 400),
      platform: 'facebook',
    })
  } catch { /* best-effort */ }
}

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
  const sigOk = verifySignature(raw, req.headers.get('x-hub-signature-256'))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null
  try { body = JSON.parse(raw) } catch { /* Meta always sends JSON; ignore junk */ }

  // TEMP diagnostic: log EVERY inbound JSON POST (Meta's Test button, real
  // events, anything) so we can definitively see whether Meta is reaching us
  // and whether the signature matches. Bounded to JSON bodies. Remove once
  // comment→DM is confirmed live.
  if (body && typeof body === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = Array.isArray(body.entry)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (body.entry as any[]).flatMap((e: any) => (e.changes ?? []).map((c: any) => `${c.field}/${c.value?.item ?? '?'}/${c.value?.verb ?? '?'}`)).slice(0, 6).join(', ')
      : Object.keys(body).slice(0, 6).join(',')
    await logFbDiag(`POST received (sig=${sigOk ? 'ok' : 'BAD'}) [${shape || 'empty'}]`)
  }

  if (!sigOk) return new Response('Invalid signature', { status: 401 })

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
