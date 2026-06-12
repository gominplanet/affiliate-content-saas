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
    .select('id,user_id,email,subject,body,status,admin_response,responded_at,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status !== 'all' && (VALID_STATUS as readonly string[]).includes(status)) {
    q = q.eq('status', status)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Surface actionable tickets first: open → answered → closed, newest-first
  // within each bucket. (Can't do this in the DB order() — alphabetical sort
  // would bury "open" beneath "answered"/"closed".)
  const rank: Record<string, number> = { open: 0, answered: 1, closed: 2 }
  const tickets = ((data ?? []) as Array<{ status: string }>).slice().sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9),
  )
  return NextResponse.json({ tickets })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  let payload: { id?: string; admin_response?: string; status?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const id = (payload.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Ticket id is required.' }, { status: 400 })

  const response = typeof payload.admin_response === 'string' ? payload.admin_response.trim() : undefined
  let nextStatus: Status | undefined
  if (payload.status && (VALID_STATUS as readonly string[]).includes(payload.status)) {
    nextStatus = payload.status as Status
  }
  if (response === undefined && nextStatus === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (response !== undefined && response.length > 0) {
    patch.admin_response = response
    patch.responded_at = new Date().toISOString()
    patch.response_seen = false           // re-light the user's bell
    patch.status = nextStatus ?? 'answered'
  } else if (nextStatus !== undefined) {
    patch.status = nextStatus
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('support_tickets')
    .update(patch)
    .eq('id', id)
    .select('id,user_id,email,subject,body,status,admin_response,responded_at,created_at,updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ticket: data })
}
