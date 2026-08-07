/**
 * /api/support/tickets — the user side of the in-app help thread.
 *
 * GET   → the caller's own tickets (newest first), each WITH its full message
 *         thread. Side-effect: marks any unseen admin messages (and the ticket's
 *         response_seen flag) as seen — opening /support IS "reading the reply",
 *         so the bell clears here. Done via the admin client (users have no
 *         UPDATE policy on tickets).
 * POST  → start a NEW ticket { subject, body }. Creates the ticket + the first
 *         user message, and fires a best-effort founder alert.
 * PATCH → reply into an EXISTING ticket { ticketId, body }. Appends a user
 *         message and REOPENS the ticket (status → open) so it resurfaces in the
 *         admin inbox. A closed ticket can be reopened this way too.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, isEmailConfigured } from '@/services/email'
import { notifyDiscord } from '@/lib/discord'

export interface SupportMessage {
  id: string
  sender: 'user' | 'admin'
  body: string
  created_at: string
}

export interface SupportTicket {
  id: string
  subject: string
  body: string
  status: 'open' | 'answered' | 'closed'
  admin_response: string | null
  responded_at: string | null
  created_at: string
  messages?: SupportMessage[]
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

  // Pull the thread for each ticket in one query (RLS scopes to the caller's
  // own tickets). Falls back to the legacy single-body/response shape if the
  // support_messages table isn't there yet (pre-migration-232 DB).
  const ids = tickets.map(t => t.id)
  if (ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: msgs } = await (supabase as any)
      .from('support_messages')
      .select('id,ticket_id,sender,body,created_at')
      .in('ticket_id', ids)
      .order('created_at', { ascending: true })
      .then((r: { data: unknown }) => r, () => ({ data: null }))
    if (Array.isArray(msgs)) {
      const byTicket = new Map<string, SupportMessage[]>()
      for (const m of msgs as Array<{ id: string; ticket_id: string; sender: 'user' | 'admin'; body: string; created_at: string }>) {
        const arr = byTicket.get(m.ticket_id) ?? []
        arr.push({ id: m.id, sender: m.sender, body: m.body, created_at: m.created_at })
        byTicket.set(m.ticket_id, arr)
      }
      for (const t of tickets) t.messages = byTicket.get(t.id) ?? []
    }
  }

  // Mark unseen admin replies as read now the user is viewing them: the ticket
  // response_seen flag (drives the bell) AND the per-message seen flag. Users
  // have no UPDATE policy, so use the service-role client. Best-effort.
  const hasAnswered = tickets.some(t => t.status === 'answered')
  if (hasAnswered || ids.length > 0) {
    try {
      const admin = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('support_tickets')
        .update({ response_seen: true })
        .eq('user_id', user.id)
        .eq('status', 'answered')
        .eq('response_seen', false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('support_messages')
        .update({ seen: true })
        .in('ticket_id', ids)
        .eq('sender', 'admin')
        .eq('seen', false)
        .then((r: unknown) => r, () => null)
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

  // Seed the thread with the opening user message. Best-effort: if the table
  // isn't there yet the ticket still works off its legacy body field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('support_messages')
    .insert({ ticket_id: data.id, sender: 'user', body, seen: true })
    .then((r: unknown) => r, () => null)

  await alertFounder({ user, tier, priority, subject, body, kind: 'new' })

  const ticket = { ...(data as SupportTicket), messages: [{ id: `${data.id}:seed`, sender: 'user' as const, body, created_at: data.created_at }] }
  return NextResponse.json({ ticket })
}

export async function PATCH(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: { ticketId?: string; body?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const ticketId = (payload.ticketId || '').trim()
  const body = (payload.body || '').trim()
  if (!ticketId) return NextResponse.json({ error: 'ticketId is required.' }, { status: 400 })
  if (!body) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 })
  if (body.length > 5000) return NextResponse.json({ error: 'Message is too long (5000 characters max).' }, { status: 400 })

  // Verify the ticket is the caller's (RLS on select already scopes it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ticket, error: tErr } = await (supabase as any)
    .from('support_tickets')
    .select('id,subject,status,tier,priority')
    .eq('id', ticketId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })

  // Append the user's message (RLS insert policy allows sender='user' on own ticket).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: msg, error: mErr } = await (supabase as any)
    .from('support_messages')
    .insert({ ticket_id: ticketId, sender: 'user', body, seen: true })
    .select('id,sender,body,created_at')
    .single()
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Reopen the ticket so it resurfaces in the admin inbox. Users have no UPDATE
  // policy on tickets, so flip status with the service-role client.
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('support_tickets')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', ticketId)
  } catch { /* non-fatal — the message is saved either way */ }

  const tier = (ticket.tier as string) || 'trial'
  await alertFounder({ user, tier, priority: !!ticket.priority, subject: `Re: ${ticket.subject}`, body, kind: 'reply' })

  return NextResponse.json({ message: msg })
}

/** Best-effort founder alert (email + Discord) — never blocks the request. */
async function alertFounder(opts: {
  user: { email?: string | null; id: string }
  tier: string; priority: boolean; subject: string; body: string; kind: 'new' | 'reply'
}) {
  const { user, tier, priority, subject, body, kind } = opts
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
  const tierLabel = priority ? `PRIORITY · ${tier}` : tier
  const verb = kind === 'reply' ? 'replied on a help ticket' : 'opened a help ticket'

  if (isEmailConfigured()) {
    const alertTo = process.env.SUPPORT_ALERT_EMAIL || 'gominunlimited@gmail.com'
    try {
      await sendEmail({
        to: alertTo,
        subject: `${priority ? '⚡ Priority ' : ''}MVP help ${kind === 'reply' ? 'reply' : 'ticket'} (${tier}): ${subject}`,
        text: `${user.email ?? 'A user'} [${tierLabel}] ${verb}.\n\nSubject: ${subject}\n\n${body}\n\nReply in the admin inbox: ${appUrl}/admin/support-tickets`,
        html: `<p><strong>${user.email ?? 'A user'}</strong> <em>[${escapeHtml(tierLabel)}]</em> ${verb}.</p>`
          + `<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>`
          + `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`
          + `<p><a href="${appUrl}/admin/support-tickets">Reply in the admin inbox →</a></p>`,
      })
    } catch { /* alert is a convenience; the ticket/message is already saved */ }
  }

  await notifyDiscord(
    `${priority ? '🔴 **PRIORITY** support' : '🆕 Support'} ${kind === 'reply' ? 'reply' : 'ticket'} (${tier})\n`
    + `**${subject}**\n`
    + `${body.length > 280 ? body.slice(0, 280) + '…' : body}\n`
    + `From: ${user.email ?? user.id}\n`
    + `→ ${appUrl}/admin/support-tickets`,
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
