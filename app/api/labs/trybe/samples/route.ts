// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE samples: the ones a creator asked brands for, and the boxes they tick
// as each arrives, is filmed and is submitted (lib/trybe-week.ts plans the
// week from them). Kept per creator; a VA works on the owner's list.
//
// GET  → { samples }
// POST { action: 'add', brandName, brandId?, product, videosPlanned?, received? }
//      { action: 'tick', id, field: 'received' | 'filmed' | 'submitted', on }
//      { action: 'remove', id }
// Without migration 427 every answer says so, never an empty list.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// Only an admin sees the migration; a creator is told it is coming.
const missingWords = (tier: string | null | undefined) => tier === 'admin' ? 'Samples need migration 427 in Supabase first.' : 'Samples are finishing an update on MVP. Try again in a few minutes.'
const missing = (m: string) => /relation .*trybe_samples.* does not exist|schema cache|could not find the table/i.test(m)
const FIELDS = { received: 'received_at', filmed: 'filmed_at', submitted: 'submitted_at' } as const
const COLS = 'id, brand_id, brand_name, product, videos_planned, requested_at, received_at, filmed_at, submitted_at, ideas, ideas_at, created_at'

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const admin = createAdminClient() as Db
  const { data: intg } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('trybe_outreach', intg?.tier)) return { error: NextResponse.json({ error: 'TRYBE Outreach is part of the Pro plan.' }, { status: 403 }) }
  return { admin, ownerId, tier: intg?.tier as string | null | undefined }
}

const fail = (m: string, tier?: string | null) => NextResponse.json({ error: missing(m) ? missingWords(tier) : m, needsMigration: missing(m) }, { status: 500 })

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { data, error } = await g.admin.from('trybe_samples').select(COLS).eq('user_id', g.ownerId).order('created_at', { ascending: false }).limit(500)
  if (error) return fail(error.message, g.tier)
  return NextResponse.json({ ok: true, samples: data || [] })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, ownerId } = g
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')
  const now = new Date().toISOString()
  const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  const id = text(body.id, 60)

  if (action === 'add') {
    const brandName = text(body.brandName, 120)
    const product = text(body.product, 160)
    if (!brandName || !product) return NextResponse.json({ error: 'Name the brand and the product.' }, { status: 400 })
    const n = Number(body.videosPlanned)
    const row = {
      user_id: ownerId, brand_name: brandName, product,
      brand_id: text(body.brandId, 80) || null,
      videos_planned: Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(10, Math.round(n))) : 3,
      // Already here when added: the box starts ticked.
      ...(body.received === true ? { received_at: now } : {}),
    }
    const { data, error } = await admin.from('trybe_samples').insert(row).select(COLS).single()
    if (error) return fail(error.message, g.tier)
    return NextResponse.json({ ok: true, sample: data })
  }

  if (action === 'tick') {
    const field = FIELDS[String(body.field) as keyof typeof FIELDS]
    if (!id || !field) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    const on = body.on !== false
    // Ticking a later box ticks the earlier ones; unticking an earlier box
    // unticks the later ones. A submitted sample was received and filmed.
    const order = ['received_at', 'filmed_at', 'submitted_at'] as const
    const at = order.indexOf(field)
    const { data: cur, error: readErr } = await admin.from('trybe_samples').select(COLS).eq('user_id', ownerId).eq('id', id).maybeSingle()
    if (readErr) return fail(readErr.message, g.tier)
    if (!cur) return NextResponse.json({ error: 'That sample is not on your list.' }, { status: 404 })
    const patch: Record<string, string | null> = { updated_at: now }
    if (on) order.slice(0, at + 1).forEach((f) => { if (!cur[f]) patch[f] = now })
    else order.slice(at).forEach((f) => { patch[f] = null })
    const { data, error } = await admin.from('trybe_samples').update(patch).eq('user_id', ownerId).eq('id', id).select(COLS).single()
    if (error) return fail(error.message, g.tier)
    return NextResponse.json({ ok: true, sample: data })
  }

  if (action === 'remove') {
    if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    const { error } = await admin.from('trybe_samples').delete().eq('user_id', ownerId).eq('id', id)
    if (error) return fail(error.message, g.tier)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
