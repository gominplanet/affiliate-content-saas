// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CRUD for Passport Links groups (migration 292) — the Geniuslink-style buckets
// creators organize their links into and read clicks by.
//   GET    → { ok, groups: [{ id, name, links }] }   (link counts per group)
//   POST   { name }            → create a group
//   PATCH  { id, name }        → rename a group
//   DELETE ?id=<id>            → delete a group (its links become ungrouped)
// Studio + Pro only, same gate as the rest of Passport.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'
import { cleanGroupName } from '@/lib/passport-links'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gate(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  return canUsePassport(normalizeTier(data?.tier))
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: groups } = await (supabase as any)
      .from('passport_groups').select('id, name, created_at').eq('user_id', user.id).order('name', { ascending: true })
    // Link counts per group (one bounded read, tallied in JS).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links } = await (supabase as any)
      .from('passport_links').select('group_id').eq('user_id', user.id)
    const counts = new Map<string, number>()
    let ungrouped = 0
    for (const l of ((links ?? []) as { group_id: string | null }[])) {
      if (l.group_id) counts.set(l.group_id, (counts.get(l.group_id) || 0) + 1)
      else ungrouped++
    }
    const out = ((groups ?? []) as { id: string; name: string }[]).map((g) => ({ id: g.id, name: g.name, links: counts.get(g.id) || 0 }))
    return NextResponse.json({ ok: true, groups: out, ungrouped })
  } catch {
    return NextResponse.json({ ok: true, groups: [], ungrouped: 0 })
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { name?: string }
  const name = cleanGroupName(body.name)
  if (!name) return NextResponse.json({ error: 'Give the group a name.' }, { status: 400 })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('passport_groups').insert({ user_id: user.id, name }).select('id, name').maybeSingle()
    if (error) {
      // Unique index (user_id, lower(name)) → duplicate name.
      if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return NextResponse.json({ error: 'You already have a group with that name.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Could not create the group.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, group: { id: data.id, name: data.name, links: 0 } })
  } catch {
    return NextResponse.json({ error: 'Could not create the group.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { id?: string; name?: string }
  const id = (body.id || '').trim()
  const name = cleanGroupName(body.name)
  if (!id || !name) return NextResponse.json({ error: 'A group id and a new name are required.' }, { status: 400 })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('passport_groups').update({ name }).eq('user_id', user.id).eq('id', id)
    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return NextResponse.json({ error: 'You already have a group with that name.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Could not rename the group.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not rename the group.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await gate(supabase, user.id))) return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })

  const id = (new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'Which group?' }, { status: 400 })
  try {
    // Links keep existing; their group_id resets to null via the FK (ON DELETE SET NULL).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('passport_groups').delete().eq('user_id', user.id).eq('id', id)
    if (error) return NextResponse.json({ error: 'Could not delete the group.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not delete the group.' }, { status: 500 })
  }
}
