// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/deal-aftercare — deal posts whose sale is over (lib/deal-aftercare-server.ts).
//
// GET                                  the creator's deal posts, each with its state
// POST { action: 'check' }             a fresh price check for posts with no passed end date
// POST { action: 'convert', postId }   turn one ended deal post into a lasting review
// POST { action: 'revive', postId }    bring the deal back on a lasting review on sale again
// POST { action: 'auto', on }          switch the automatic job on or off (migration 380)
//
// LABS, admin only while it is tested (lib/labs-preview.ts deal_aftercare).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { listDealPosts, checkDealPrices, convertDealPost, reviveDealPost } from '@/lib/deal-aftercare-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('deal_aftercare', intg?.tier)) return { error: NextResponse.json({ error: 'Ended Deals is part of Pro.' }, { status: 403 }) }
  return { ownerId, isAdmin: intg?.tier === 'admin' }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const r = await listDealPosts(admin, g.ownerId)
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 })
  const a = await admin.from('integrations').select('deal_aftercare_auto, deal_aftercare_auto_chosen_at').eq('user_id', g.ownerId).maybeSingle()
  const autoColumn = !a.error
  const auto = autoColumn
    ? a.data?.deal_aftercare_auto === true && (g.isAdmin || !!a.data?.deal_aftercare_auto_chosen_at)
    : g.isAdmin
  return NextResponse.json({ ...r, auto, autoColumn })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { action?: string; postId?: string; force?: boolean; on?: boolean }
  const admin = createAdminClient()
  try {
    if (body.action === 'check') return NextResponse.json({ ok: true, ...(await checkDealPrices(admin, g.ownerId)) })
    if (body.action === 'convert') {
      if (!body.postId) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
      const r = await convertDealPost(admin, g.ownerId, String(body.postId), { force: body.force === true })
      return NextResponse.json(r, { status: r.ok ? 200 : 422 })
    }
    if (body.action === 'revive') {
      if (!body.postId) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
      const r = await reviveDealPost(admin, g.ownerId, String(body.postId))
      return NextResponse.json(r, { status: r.ok ? 200 : 422 })
    }
    if (body.action === 'auto') {
      const on = (body as { on?: boolean }).on === true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).from('integrations').update({ deal_aftercare_auto: on, deal_aftercare_auto_chosen_at: new Date().toISOString() }).eq('user_id', g.ownerId).select('deal_aftercare_auto')
      if (error) {
        const missing = /deal_aftercare_auto/.test(error.message)
        return NextResponse.json({ ok: false, error: missing ? 'The switch needs migrations 380 and 386, so nothing was changed.' : error.message }, { status: missing ? 422 : 500 })
      }
      if (!(data ?? []).length) return NextResponse.json({ ok: false, error: 'Your account settings row was not found, so nothing was changed.' }, { status: 404 })
      return NextResponse.json({ ok: true, auto: data[0].deal_aftercare_auto === true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
