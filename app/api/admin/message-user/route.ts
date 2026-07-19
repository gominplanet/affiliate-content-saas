// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/message-user — admin-only. Email ONE user directly from the
// /admin/users card, for account-specific updates ("your Telegram is fixed",
// "your X connection expired, here's how to reconnect").
//
//   { userId, subject, body, preview?: true } → { ok, to, id? }
//
// `preview: true` resolves the recipient and returns their address WITHOUT
// sending — so the UI can show exactly who is about to be emailed. Sending a
// message to the wrong customer is not something you can take back, so the
// address is confirmed on screen before the send button does anything.
//
// Distinct from /api/admin/broadcast, which is a bulk marketing send: this is
// a 1:1 service message, so it uses the direct (non-unsubscribe) template and
// deliberately does NOT honour marketing_opt_out — opting out of marketing
// shouldn't silence a reply about your own broken integration. The UI flags
// opted-out recipients so that stays a conscious call rather than a surprise.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, isEmailConfigured } from '@/services/email'
import { renderDirectHtml, renderDirectText } from '@/lib/broadcast-email'

export const maxDuration = 60

const MAX_SUBJECT = 200
const MAX_BODY = 10_000

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      userId?: string
      subject?: string
      body?: string
      preview?: boolean
    }

    const userId = (body.userId || '').trim()
    const subject = (body.subject || '').trim().slice(0, MAX_SUBJECT)
    const messageBody = (body.body || '').trim().slice(0, MAX_BODY)
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const admin = createAdminClient()

    // Resolve the recipient from auth.users — the id in the UI comes from the
    // admin user list, but re-reading it here means a stale or hand-edited id
    // can never send mail to someone unintended.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: target, error: lookupErr } = await (admin.auth.admin as any).getUserById(userId)
    const to: string | undefined = target?.user?.email
    if (lookupErr || !to) {
      return NextResponse.json({ error: 'No user with that id, or they have no email address.' }, { status: 404 })
    }

    // Is this person opted out of marketing? Doesn't block a service message,
    // but the UI shows it so it's a deliberate choice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await (admin as any)
      .from('integrations').select('marketing_opt_out').eq('user_id', userId).maybeSingle()
    const marketingOptOut = !!integ?.marketing_opt_out

    if (body.preview) {
      return NextResponse.json({ ok: true, to, marketingOptOut, sent: false })
    }

    if (!subject) return NextResponse.json({ error: 'Subject required' }, { status: 400 })
    if (!messageBody) return NextResponse.json({ error: 'Message body required' }, { status: 400 })
    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email is not configured on the server (RESEND_API_KEY).' }, { status: 500 })
    }

    // Replies land in the admin's own inbox — a service message people can't
    // answer is worse than not sending one.
    const replyTo = user.email || undefined

    const { id } = await sendEmail({
      to,
      replyTo,
      subject,
      html: renderDirectHtml({ subject, bodyText: messageBody, replyTo }),
      text: renderDirectText(messageBody, replyTo || ''),
      tags: [{ name: 'kind', value: 'admin_direct' }],
    })

    console.log('[admin/message-user] sent', { by: user.id, to: userId, subject: subject.slice(0, 60), id })
    return NextResponse.json({ ok: true, to, marketingOptOut, sent: true, id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/message-user] failed', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
