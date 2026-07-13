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
  // Only diagnose things that structurally look like a Meta webhook, so the
  // bad-signature breadcrumb can't be spammed by random unsigned POSTs.
  const looksLikeWebhook = !!(body && Array.isArray(body.entry))

  if (!sigOk) {
    // Delivered but the signature didn't match FACEBOOK_APP_SECRET → we'd 401
    // and drop it silently. Leave a breadcrumb so this is visible.
    if (looksLikeWebhook) await logFbDiag('bad-signature — event delivered but X-Hub-Signature-256 did not match FACEBOOK_APP_SECRET (wrong app secret?)')
    return new Response('Invalid signature', { status: 401 })
  }

  // Fast 200 for Meta; process inline (each event is cheap, failures swallowed).
  try {
    const events = extractCommentEvents(body)
    if (events.length === 0 && looksLikeWebhook) {
      // Verified + delivered, but nothing we act on (not a fresh top-level
      // comment). Summarise the change shape (no PII) so we can see what came in.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).map((c: any) => `${c.field}/${c.value?.item ?? '?'}/${c.value?.verb ?? '?'}`)).slice(0, 6).join(', ')
      await logFbDiag(`received + verified, 0 comment events [${summary || 'no changes'}]`)
    }
    for (const ev of events) {
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
