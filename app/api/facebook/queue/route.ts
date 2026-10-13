// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/facebook/queue  the creator's Facebook posts waiting for their
//                           Group (lib/facebook-queue), newest first.
// POST /api/facebook/queue  { id, action: 'sent', groupPostUrl, pagePostUrl }
//                           or { id, action: 'dismiss' }.
//
// "Sent" is written only by Meta Hub after the Group post went up, with the
// addresses it read, so the queue never says sent for a post nobody pressed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { facebookSetupEnabled } from '@/lib/facebook-link-budget'

export const dynamic = 'force-dynamic'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: integ } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!facebookSetupEnabled(integ?.tier)) return { res: NextResponse.json({ ok: true, on: false, items: [] }) }
  return { user, admin }
}

const missing = (m: string | undefined) => /facebook_queue/.test(m || '')

export async function GET() {
  const g = await gate()
  if ('res' in g) return g.res
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (g.admin as any).from('facebook_queue')
    .select('id,source,source_id,title,body,link,image_url,created_at')
    .eq('user_id', g.user.id).eq('status', 'waiting').order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json(missing(error.message) ? { ok: true, on: true, items: [], needsMigration: true } : { ok: false, error: error.message }, { status: missing(error.message) ? 200 : 500 })
  return NextResponse.json({ ok: true, on: true, items: data ?? [] })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null
  if (!id) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
  const fb = (v: unknown) => (typeof v === 'string' && /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//i.test(v.trim()) ? v.trim().slice(0, 500) : null)
  let patch: Record<string, unknown>
  if (b.action === 'dismiss') patch = { status: 'dismissed' }
  else if (b.action === 'sent') {
    const groupPostUrl = fb(b.groupPostUrl)
    if (!groupPostUrl) return NextResponse.json({ error: 'Sent needs the Group post it went to.' }, { status: 400 })
    patch = { status: 'sent', group_post_url: groupPostUrl, page_post_url: fb(b.pagePostUrl), sent_at: new Date().toISOString() }
  } else return NextResponse.json({ error: 'Send or dismiss?' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (g.admin as any).from('facebook_queue').update(patch).eq('id', id).eq('user_id', g.user.id)
  if (error) return NextResponse.json({ ok: false, error: missing(error.message) ? 'Needs migration 426.' : error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
