// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Public unsubscribe endpoint for operator broadcasts. Reached straight from
// the inbox (no session), so it authenticates via the signed token minted by
// lib/broadcast-token. GET → flips the flag + shows a confirmation page.
// POST → RFC 8058 one-click (List-Unsubscribe-Post) → 200, no body needed.
//
// Only affects marketing broadcasts. Auth + transactional email always sends.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsub } from '@/lib/broadcast-token'

async function optOut(token: string): Promise<boolean> {
  const userId = verifyUnsub(token)
  if (!userId) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('integrations')
    .update({ marketing_opt_out: true })
    .eq('user_id', userId)
  return !error
}

function page(title: string, message: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f5f7;color:#1d1d1f">
<div style="max-width:440px;margin:14vh auto;background:#fff;border:1px solid #e5e5ea;border-radius:16px;padding:32px;text-align:center">
  <div style="font-size:28px;margin-bottom:8px">${ok ? '✓' : '⚠️'}</div>
  <h1 style="font-size:19px;margin:0 0 8px">${title}</h1>
  <p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:0">${message}</p>
</div></body></html>`
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || ''
  const ok = await optOut(token)
  return ok
    ? page('You’re unsubscribed', 'You won’t receive MVP Affiliate announcement emails anymore. Account and billing emails will still be sent.', true)
    : page('Link expired', 'We couldn’t process that unsubscribe link. Please contact support and we’ll remove you manually.', false)
}

// One-click unsubscribe (Gmail/Apple Mail hit this directly).
export async function POST(request: Request) {
  const url = new URL(request.url)
  let token = url.searchParams.get('token') || ''
  if (!token) {
    try {
      const form = await request.formData()
      token = String(form.get('token') || '')
    } catch { /* no form body */ }
  }
  const ok = await optOut(token)
  return NextResponse.json({ ok })
}
