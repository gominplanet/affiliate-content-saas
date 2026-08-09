/**
 * /api/admin/support-tickets — the founder's inbox side of the loop (Phase 3).
 *
 * GET   ?status=open|answered|closed|all (default: all, open-first) → every
 *        ticket across all users, with the submitter's email.
 * PATCH { id, admin_response?, status } → write the reply and flip status.
 *        Setting a reply stamps responded_at and resets response_seen=false so
 *        the user's bell lights up. Reads/writes go through the service-role
 *        client (bypasses RLS); both verbs are admin-tier gated.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_STATUS = ['open', 'answered', 'closed'] as const
type Status = (typeof VALID_STATUS)[number]

// Tolerate a DB where migration 238 (support_messages.image_url) hasn't run:
// retry the SELECT/INSERT without image_url so support never breaks pre-migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectMessages(sb: any, ids: string[]): Promise<any[]> {
  const base = 'id,ticket_id,sender,body,created_at'
  let res = await sb.from('support_messages').select(`${base},image_url`).in('ticket_id', ids).order('created_at', { ascending: true })
  if (res.error) res = await sb.from('support_messages').select(base).in('ticket_id', ids).order('created_at', { ascending: true })
  return Array.isArray(res.data) ? res.data : []
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectTicketThread(sb: any, ticketId: string): Promise<any[]> {
  const base = 'id,sender,body,created_at'
  let res = await sb.from('support_messages').select(`${base},image_url`).eq('ticket_id', ticketId).order('created_at', { ascending: true })
  if (res.error) res = await sb.from('support_messages').select(base).eq('ticket_id', ticketId).order('created_at', { ascending: true })
  return Array.isArray(res.data) ? res.data : []
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertMessage(sb: any, row: Record<string, unknown>): Promise<void> {
  let res = await sb.from('support_messages').insert(row)
  if (res.error && 'image_url' in row) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { image_url, ...rest } = row
    res = await sb.from('support_messages').insert(rest)
  }
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).single()
  if (caller?.tier !== 'admin') {
    return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) }
  }
  return { user }
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const status = new URL(req.url).searchParams.get('status') || 'all'
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from('support_tickets')
    .select('id,user_id,email,subject,body,status,admin_response,responded_at,created_at,updated_at,tier,priority')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status !== 'all' && (VALID_STATUS as readonly string[]).includes(status)) {
    q = q.eq('status', status)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Surface actionable tickets first: PRIORITY (Pro/Studio) above standard, then
  // open → answered → closed, newest-first within each bucket. (Can't do this in
  // the DB order() — alphabetical status sort would bury "open".)
  const rank: Record<string, number> = { open: 0, answered: 1, closed: 2 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets = ((data ?? []) as Array<{ id: string; status: string; priority?: boolean; messages?: unknown }>).slice().sort(
    (a, b) =>
      (b.priority ? 1 : 0) - (a.priority ? 1 : 0) ||
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9),
  )

  // Attach each ticket's full message thread (best-effort — a pre-migration-232
  // DB has no support_messages, so we leave the legacy body/admin_response shape).
  const ids = tickets.map(t => t.id)
  if (ids.length > 0) {
    const msgs = await selectMessages(admin, ids)
    if (msgs.length) {
      const byTicket = new Map<string, Array<Record<string, unknown>>>()
      for (const m of msgs as Array<{ ticket_id: string }>) {
        const arr = byTicket.get(m.ticket_id) ?? []
        arr.push(m as unknown as Record<string, unknown>)
        byTicket.set(m.ticket_id, arr)
      }
      for (const t of tickets) { const mm = byTicket.get(t.id); if (mm && mm.length) t.messages = mm }
    }
  }
  return NextResponse.json({ tickets })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  let payload: { id?: string; admin_response?: string; status?: string; imageUrl?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const id = (payload.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Ticket id is required.' }, { status: 400 })

  const response = typeof payload.admin_response === 'string' ? payload.admin_response.trim() : undefined
  const imageUrl = /^https?:\/\//i.test(String(payload.imageUrl || '').trim()) ? String(payload.imageUrl).trim().slice(0, 1000) : null
  const hasReply = (response !== undefined && response.length > 0) || !!imageUrl
  let nextStatus: Status | undefined
  if (payload.status && (VALID_STATUS as readonly string[]).includes(payload.status)) {
    nextStatus = payload.status as Status
  }
  if (!hasReply && nextStatus === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // A reply APPENDS an admin message to the thread AND flips the ticket to
  // answered. We also keep the ticket-level admin_response / responded_at /
  // response_seen in sync so the existing bell (which reads those) still lights
  // up without touching the notifications route.
  if (hasReply) {
    await insertMessage(admin, { ticket_id: id, sender: 'admin', body: response ?? '', image_url: imageUrl, seen: false })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (hasReply) {
    if (response !== undefined && response.length > 0) patch.admin_response = response
    patch.responded_at = new Date().toISOString()
    patch.response_seen = false           // re-light the user's bell
    patch.status = nextStatus ?? 'answered'
  } else if (nextStatus !== undefined) {
    patch.status = nextStatus
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('support_tickets')
    .update(patch)
    .eq('id', id)
    .select('id,user_id,email,subject,body,status,admin_response,responded_at,created_at,updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return the fresh thread so the admin UI can re-render without a full reload.
  const messages = await selectTicketThread(admin, id)
  return NextResponse.json({ ticket: { ...data, messages: messages.length ? messages : undefined } })
}
