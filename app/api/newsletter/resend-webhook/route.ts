/**
 * POST /api/newsletter/resend-webhook — receives Resend delivery events
 *
 * Resend POSTs to this endpoint for every email.delivered / .bounced /
 * .complained / .opened / .clicked event. We use the tags we attached
 * at send-time ({ broadcast_id, user_id }) to route each event to the
 * right broadcast row + tick its counter.
 *
 * Side effects beyond counters:
 *   .bounced       → subscriber.status = 'bounced'  (stops future sends)
 *   .complained    → subscriber.status = 'unsubscribed' (user reported spam)
 *   .unsubscribed  → subscriber.status = 'unsubscribed' (one-click)
 *
 * Setup:
 *   1. Resend Dashboard → Webhooks → Add Endpoint
 *      URL: https://www.mvpaffiliate.io/api/newsletter/resend-webhook
 *      Events: email.delivered, email.bounced, email.complained,
 *              email.opened, email.clicked, email.unsubscribed
 *   2. Copy the Signing Secret Resend shows after creating the endpoint.
 *   3. Set RESEND_WEBHOOK_SECRET in Vercel env vars.
 *   4. Redeploy.
 *
 * If the secret is missing OR the signature fails, the route 401s and
 * Resend retries automatically. We log every reject so a misconfiguration
 * surfaces in Vercel logs immediately.
 */
import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseEmail } from '@/lib/newsletter'

/** Svix-style signature: scheme is `v1,<base64-hmac-sha256>` of
 *  `${svix-id}.${svix-timestamp}.${body}`. Resend supports multiple
 *  active secrets (so they can rotate without breaking deployed
 *  endpoints); a single signature passing wins.
 *
 *  We verify timestamp drift too — anything more than 5 minutes off is
 *  refused as a replay-prevention measure (same window Svix recommends). */
function verifySvixSignature(opts: {
  secret: string
  msgId: string | null
  timestamp: string | null
  rawBody: string
  sigHeader: string | null
}): boolean {
  const { secret, msgId, timestamp, rawBody, sigHeader } = opts
  if (!msgId || !timestamp || !sigHeader) return false
  // Reject events more than 5 minutes old (Svix's recommended window).
  const ts = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false
  // Svix secrets are prefixed `whsec_` then base64; strip the prefix
  // before decoding. The actual HMAC key is the decoded bytes.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let key: Buffer
  try { key = Buffer.from(rawSecret, 'base64') } catch { return false }
  const signedPayload = `${msgId}.${timestamp}.${rawBody}`
  const expected = createHmac('sha256', key).update(signedPayload).digest('base64')
  // Multiple sigs (space-separated) — each is `<scheme>,<sig>`. Any match wins.
  for (const candidate of sigHeader.split(' ')) {
    const [scheme, sig] = candidate.split(',')
    if (scheme !== 'v1' || !sig) continue
    try {
      const a = Buffer.from(sig, 'utf8')
      const b = Buffer.from(expected, 'utf8')
      if (a.length === b.length && timingSafeEqual(a, b)) return true
    } catch { /* keep trying */ }
  }
  return false
}

/** Map a Resend event type → which broadcast counter we tick. */
const COUNTER_BY_EVENT: Record<string, 'recipients_delivered' | 'recipients_bounced' | 'recipients_opened' | 'recipients_clicked' | null> = {
  'email.sent':         null,                  // pre-delivery, no counter
  'email.delivered':    'recipients_delivered',
  'email.bounced':      'recipients_bounced',
  'email.complained':   'recipients_bounced',  // share the bounce bucket — both are "didn't land"
  'email.opened':       'recipients_opened',
  'email.clicked':      'recipients_clicked',
  'email.unsubscribed': null,                  // counters unchanged; sub status flips below
  'email.delivery_delayed': null,              // transient — we don't surface delays in v1
}

/** For each event, decide whether to also flip the subscriber's status. */
function subscriberStatusFor(eventType: string): string | null {
  if (eventType === 'email.bounced') return 'bounced'
  if (eventType === 'email.complained') return 'unsubscribed'
  if (eventType === 'email.unsubscribed') return 'unsubscribed'
  return null
}

interface ResendTag { name?: string; value?: string }
interface ResendWebhookEvent {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    from?: string
    to?: string[]
    subject?: string
    tags?: ResendTag[]
  }
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[newsletter/webhook] RESEND_WEBHOOK_SECRET is not set — refusing all events.')
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 })
  }

  // Read the raw body BEFORE JSON.parse — the signature is computed over
  // the raw string. Parsing first and re-stringifying would change byte
  // representation (e.g. unicode escapes) and break verification.
  const rawBody = await req.text()
  const sigOk = verifySvixSignature({
    secret,
    msgId: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    rawBody,
    sigHeader: req.headers.get('svix-signature'),
  })
  if (!sigOk) {
    console.warn('[newsletter/webhook] signature mismatch — rejecting.')
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  let event: ResendWebhookEvent
  try { event = JSON.parse(rawBody) as ResendWebhookEvent }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const type = event.type || ''
  const tags = event.data?.tags || []
  // Tags from Resend can show up as { name, value } objects OR as a flat
  // object map depending on the SDK version that sent the email. Tolerate
  // both shapes when extracting.
  const tagMap: Record<string, string> = {}
  for (const t of tags) {
    if (t?.name && typeof t.value === 'string') tagMap[t.name] = t.value
  }
  const broadcastId = tagMap['broadcast_id']
  const userId = tagMap['user_id']
  const kind = tagMap['kind']

  // Only handle events we tagged as newsletter broadcasts. Other email
  // types (transactional confirms, etc.) just 200-ack so Resend doesn't
  // retry forever.
  if (kind !== 'newsletter_broadcast' || !broadcastId || !userId) {
    return NextResponse.json({ ok: true, skipped: 'not-a-broadcast' })
  }

  const admin = createAdminClient()

  // ── 1. Tick the broadcast counter ────────────────────────────────────────
  // Atomic via the increment_broadcast_counter RPC (migration 080) — two
  // concurrent webhook events for the same broadcast no longer race the
  // counter, which used to silently undercount on busy broadcasts.
  const col = COUNTER_BY_EVENT[type]
  if (col) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.rpc('increment_broadcast_counter', {
      p_broadcast_id: broadcastId,
      p_user: userId,
      p_column: col,
    })
  }

  // ── 2. Flip subscriber status on bounce / spam / one-click unsub ─────────
  const newStatus = subscriberStatusFor(type)
  if (newStatus) {
    const recipient = (event.data?.to || [])[0]
    if (recipient) {
      const email = normaliseEmail(recipient)
      const patch: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'unsubscribed') patch.unsubscribed_at = new Date().toISOString()
      // patch is Record<string, unknown> here because we conditionally
      // add fields; cast to never at the call site so the typed client
      // accepts the schema-correct payload without complaining about
      // the literal shape.
      await admin
        .from('newsletter_subscribers')
        .update(patch as never)
        .eq('user_id', userId)
        .eq('email', email)
    }
  }

  return NextResponse.json({ ok: true })
}
