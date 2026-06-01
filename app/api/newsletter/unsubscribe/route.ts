/**
 * GET  /api/newsletter/unsubscribe?token=…   — visible footer link
 * POST /api/newsletter/unsubscribe?token=…   — RFC 8058 one-click
 *
 * Two flows, same effect: status flips to 'unsubscribed', stamp
 * unsubscribed_at. The unsub_token is NOT cleared — we keep it so a
 * subscriber who unsubs by mistake can re-subscribe and the same token
 * still works in the new confirmation flow (better UX than rotating it).
 *
 * Why both verbs:
 *   * GET handles the visible "Unsubscribe" link in the email footer
 *     (subscribers click it in their mail client). 302 to a friendly
 *     landing page when done.
 *   * POST handles RFC 8058's List-Unsubscribe=One-Click flow — Gmail,
 *     Yahoo, and Outlook surface a one-click button if our send-time
 *     headers say `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
 *     Returns 200 (the inbox provider's bot expects a 200; no redirect).
 *
 * Both are unauthenticated — the token IS the auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function flipToUnsubscribed(token: string): Promise<'ok' | 'not-found'> {
  if (!token) return 'not-found'
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await admin
    .from('newsletter_subscribers')
    .select('id,status')
    .eq('unsub_token', token)
    .maybeSingle()
  if (!row) return 'not-found'
  // Idempotent — if they're already unsubscribed, just succeed.
  if (row.status === 'unsubscribed') return 'ok'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await admin
    .from('newsletter_subscribers')
    .update({
      status: 'unsubscribed',
      unsubscribed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  return 'ok'
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  const result = await flipToUnsubscribed(token)
  if (result === 'not-found') {
    // Generic message — don't tell scrapers whether a token is valid.
    const body = `<!doctype html><html><head><meta charset="utf-8" /><title>Unsubscribe</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
<div style="max-width:420px;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 2px rgba(0,0,0,.06);text-align:center;">
<h1 style="font-size:18px;margin:0 0 8px;">Unsubscribe link invalid</h1>
<p style="font-size:14px;line-height:1.5;color:#6e6e73;margin:0;">We couldn't find a subscription matching that link. If you're still getting emails, please reply to the latest one and we'll remove you manually.</p>
</div></body></html>`
    return new NextResponse(body, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return NextResponse.redirect(new URL('/newsletter-unsubscribed', req.url))
}

export async function POST(req: NextRequest) {
  // RFC 8058 — inbox provider bots send a POST when the user hits the
  // "unsubscribe" button rendered next to the From line. The token can
  // be in the query string OR in the body; we accept both.
  const tokenFromUrl = req.nextUrl.searchParams.get('token')?.trim() || ''
  let tokenFromBody = ''
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const body = await req.json() as { token?: string }
      tokenFromBody = (body?.token || '').trim()
    } else {
      // application/x-www-form-urlencoded — RFC 8058's default
      const text = await req.text()
      const params = new URLSearchParams(text)
      tokenFromBody = (params.get('token') || '').trim()
    }
  } catch { /* leave tokenFromBody = '' */ }
  const result = await flipToUnsubscribed(tokenFromUrl || tokenFromBody)
  if (result === 'not-found') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
