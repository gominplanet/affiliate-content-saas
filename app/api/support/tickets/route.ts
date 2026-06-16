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
import { notifyDiscord } from '@/lib/discord'

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

  // Stamp the submitter's tier + priority flag (migration 130) so the admin
  // inbox surfaces paying customers first and the Discord ping can flag them.
  // This is the real backing for the "priority support" plan claim.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (tierRow?.tier as string) || 'trial'
  const priority = tier === 'pro' || tier === 'studio'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('support_tickets')
    .insert({ user_id: user.id, email: user.email ?? null, subject, body, tier, priority })
    .select('id,subject,body,status,admin_response,responded_at,created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
  const tierLabel = priority ? `PRIORITY · ${tier}` : tier

  // Best-effort founder alert — never block ticket creation on the email.
  if (isEmailConfigured()) {
    const alertTo = process.env.SUPPORT_ALERT_EMAIL || 'gominunlimited@gmail.com'
    try {
      await sendEmail({
        to: alertTo,
        subject: `${priority ? '⚡ Priority ' : ''}MVP help ticket (${tier}): ${subject}`,
        text: `${user.email ?? 'A user'} [${tierLabel}] opened a help ticket.\n\nSubject: ${subject}\n\n${body}\n\nReply in the admin inbox: ${appUrl}/admin/support-tickets`,
        html: `<p><strong>${user.email ?? 'A user'}</strong> <em>[${escapeHtml(tierLabel)}]</em> opened a help ticket.</p>`
          + `<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>`
          + `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`
          + `<p><a href="${appUrl}/admin/support-tickets">Reply in the admin inbox →</a></p>`,
      })
    } catch { /* alert is a convenience; the ticket is already saved */ }
  }

  // Best-effort Discord ping (dormant until DISCORD_WEBHOOK_URL is set). Priority
  // tickets are flagged so Pro/Studio support genuinely jumps the queue.
  await notifyDiscord(
    `${priority ? '🔴 **PRIORITY** support ticket' : '🆕 Support ticket'} (${tier})\n`
    + `**${subject}**\n`
    + `${body.length > 280 ? body.slice(0, 280) + '…' : body}\n`
    + `From: ${user.email ?? user.id}\n`
    + `→ ${appUrl}/admin/support-tickets`,
  )

  return NextResponse.json({ ticket: data as SupportTicket })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
