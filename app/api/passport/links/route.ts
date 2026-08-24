// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The creator's Passport Links list + per-link group assignment (migration 292).
//   GET  ?q=&limit=&offset=  → { ok, links: [{ code, label, asin, destinationUrl,
//                                groupId, url, createdAt }], total }
//   PATCH { code, groupId }  → move a link into a group (groupId null = ungroup)
// Studio + Pro only. Reassigning is what lets creators curate the auto-grouping
// into their own campaign buckets, the Geniuslink-groups workflow.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'
import { passportLinkUrl } from '@/lib/passport-links'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gate(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  return canUsePassport(normalizeTier(data?.tier))
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  const p = new URL(request.url).searchParams
  const q = (p.get('q') || '').trim().replace(/[,%]/g, ' ').slice(0, 80)
  const limit = Math.min(100, Math.max(1, Number(p.get('limit')) || 50))
  const offset = Math.max(0, Number(p.get('offset')) || 0)
  const groupFilter = (p.get('group') || '').trim() // '' all · 'none' ungrouped · else group id

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('passport_links')
      .select('code, label, asin, destination_url, group_id, created_at', { count: 'exact' })
      .eq('user_id', user.id)
    if (q) query = query.or(`label.ilike.%${q}%,asin.ilike.%${q}%`)
    if (groupFilter === 'none') query = query.is('group_id', null)
    else if (groupFilter) query = query.eq('group_id', groupFilter)
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ ok: true, links: [], total: 0 })
    const links = ((data ?? []) as { code: string; label: string | null; asin: string | null; destination_url: string | null; group_id: string | null; created_at: string }[])
      .map((l) => ({
        code: l.code,
        label: l.label,
        asin: l.asin,
        destinationUrl: l.destination_url,
        groupId: l.group_id,
        url: passportLinkUrl(l.code),
        createdAt: l.created_at,
      }))
    return NextResponse.json({ ok: true, links, total: count ?? links.length })
  } catch {
    return NextResponse.json({ ok: true, links: [], total: 0 })
  }
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { code?: string; groupId?: string | null }
  const code = (body.code || '').trim()
  if (!code) return NextResponse.json({ error: 'Which link?' }, { status: 400 })
  const groupId = body.groupId ? String(body.groupId).trim() : null

  try {
    // If assigning to a group, confirm it belongs to this creator (defense in depth
    // on top of RLS — never let a link point at someone else's group id).
    if (groupId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: g } = await (supabase as any).from('passport_groups').select('id').eq('user_id', user.id).eq('id', groupId).maybeSingle()
      if (!g) return NextResponse.json({ error: 'That group no longer exists.' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('passport_links').update({ group_id: groupId }).eq('user_id', user.id).eq('code', code)
    if (error) return NextResponse.json({ error: 'Could not move the link.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not move the link.' }, { status: 500 })
  }
}
