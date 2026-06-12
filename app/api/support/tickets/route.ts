/**
 * /api/support/tickets — the user side of the in-app help-ticket loop (Phase 3).
 *
 * GET   → the caller's own tickets, newest first. Side-effect: marks any
 *         answered+unseen tickets as seen (via the admin client, since users
 *         have no UPDATE policy) — opening /support IS "seeing the reply", so
 *         the bell notification clears here.
 * POST  → create a ticket { subject, body }. Fires a best-effort one-line email
 *         alert to the founder so they don't have to poll the admin inbox. The
 *         reply itself is read back in-app; no email delivers it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, isEmailConfigured } from '@/services/email'

export interface SupportTicket {
  id: string
  subject: string
  body: string
  status: 'open' | 'answered' | 'closed'
  admin_response: string | null
  responded_at: string | null
  created_at: string
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('support_tickets')
    .select('id,subject,body,status,admin_response,responded_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tickets = (data ?? []) as SupportTicket[]

  // Mark answered-but-unseen replies as seen now that the user is viewing them.
  // Users have no UPDATE policy, so use the service-role client. Best-effort —
  // a failure here must not break the list read.
  const unseen = tickets.filter(t => t.status === 'answered')
  if (unseen.length > 0) {
    try {
      const admin = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('support_tickets')
        .update({ response_seen: true })
        .eq('user_id', user.id)
        .eq('status', 'answered')
        .eq('response_seen', false)
    } catch { /* the bell will just show one extra tick — non-fatal */ }
  }

  return NextResponse.json({ tickets })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: { subject?: string; body?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject = (payload.subject || '').trim()
  const body = (payload.body || '').trim()
  if (!subject || !body) {
    return NextResponse.json({ error: 'A subject and a message are both required.' }, { status: 400 })
  }
  if (subject.length > 200) {
    return NextResponse.json({ error: 'Subject is too long (200 characters max).' }, { status: 400 })
  }
  if (body.length > 5000) {
    return NextResponse.json({ error: 'Message is too long (5000 characters max).' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('support_tickets')
    .insert({ user_id: user.id, email: user.email ?? null, subject, body })
    .select('id,subject,body,status,admin_response,responded_at,created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort founder alert — never block ticket creation on the email.
  if (isEmailConfigured()) {
    const alertTo = process.env.SUPPORT_ALERT_EMAIL || 'gominunlimited@gmail.com'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mvpaffiliate.io'
    try {
      await sendEmail({
        to: alertTo,
        subject: `New MVP help ticket: ${subject}`,
        text: `${user.email ?? 'A user'} opened a help ticket.\n\nSubject: ${subject}\n\n${body}\n\nReply in the admin inbox: ${appUrl}/admin/support-tickets`,
        html: `<p><strong>${user.email ?? 'A user'}</strong> opened a help ticket.</p>`
          + `<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>`
          + `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`
          + `<p><a href="${appUrl}/admin/support-tickets">Reply in the admin inbox →</a></p>`,
      })
    } catch { /* alert is a convenience; the ticket is already saved */ }
  }

  return NextResponse.json({ ticket: data as SupportTicket })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
