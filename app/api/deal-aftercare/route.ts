// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/deal-aftercare — deal posts whose sale is over (lib/deal-aftercare-server.ts).
//
// GET                                  the creator's deal posts, each with its state
// POST { action: 'check' }             a fresh price check for posts with no passed end date
// POST { action: 'convert', postId }   turn one ended deal post into a lasting review
//
// LABS, admin only while it is tested (lib/labs-preview.ts deal_aftercare).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { listDealPosts, checkDealPrices, convertDealPost } from '@/lib/deal-aftercare-server'

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
  if (!canUsePreview('deal_aftercare', intg?.tier)) return { error: NextResponse.json({ error: 'Ended deals is still being tested.' }, { status: 403 }) }
  return { ownerId }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const r = await listDealPosts(createAdminClient(), g.ownerId)
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json(r)
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { action?: string; postId?: string; force?: boolean }
  const admin = createAdminClient()
  try {
    if (body.action === 'check') return NextResponse.json({ ok: true, ...(await checkDealPrices(admin, g.ownerId)) })
    if (body.action === 'convert') {
      if (!body.postId) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
      const r = await convertDealPost(admin, g.ownerId, String(body.postId), { force: body.force === true })
      return NextResponse.json(r, { status: r.ok ? 200 : 422 })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
