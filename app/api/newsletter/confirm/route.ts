/**
 * GET /api/newsletter/confirm?token=… — double-opt-in landing
 *
 * The link target inside the confirmation email. When the subscriber clicks
 * it we flip status pending → active, clear the confirm_token (so the link
 * can't be replayed), stamp confirmed_at, and redirect them to a small
 * success page hosted at /newsletter-confirmed.
 *
 * Why GET and not POST: email clients open links with GET. We accept that a
 * pre-fetcher could trigger it (Outlook safe-link pre-scans, anti-virus,
 * etc.) — that's the standard double-opt-in compromise the whole industry
 * lives with. Better than asking the subscriber to "click a button" on a
 * landing page (which loses people).
 *
 * Returns 302 to the success page on happy path; a small HTML error page on
 * bad/expired token.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function htmlError(message: string): NextResponse {
  // Tiny inline page so we don't ship a whole route for the error case.
  const body = `<!doctype html><html><head><meta charset="utf-8" /><title>Subscription</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
  <div style="max-width:420px;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 2px rgba(0,0,0,.06);text-align:center;">
    <h1 style="font-size:18px;margin:0 0 8px;">Hmm — that didn't work</h1>
    <p style="font-size:14px;line-height:1.5;color:#6e6e73;margin:0;">${message}</p>
  </div>
</body></html>`
  return new NextResponse(body, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) return htmlError("That confirmation link doesn't have a token. Try clicking the original email link again.")

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from('newsletter_subscribers')
    .select('id,user_id,status')
    .eq('confirm_token', token)
    .maybeSingle()
  if (!row) return htmlError("That link is invalid or has already been used. If you meant to subscribe, please sign up again.")

  // Already active (e.g. clicked twice) — silently succeed.
  if (row.status === 'active') {
    return NextResponse.redirect(new URL('/newsletter-confirmed', req.url))
  }

  // Anything other than 'pending' (e.g. unsubscribed → re-signup token leaked)
  // — refuse instead of silently re-activating.
  if (row.status !== 'pending') {
    return htmlError("That link can't be used right now. Please sign up again.")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('newsletter_subscribers')
    .update({
      status: 'active',
      confirm_token: null,        // single-use — kill the token now
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  return NextResponse.redirect(new URL('/newsletter-confirmed', req.url))
}
