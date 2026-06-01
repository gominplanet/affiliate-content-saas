/**
 * PATCH  /api/wordpress/sites/[id]   — relabel or set as default
 * DELETE /api/wordpress/sites/[id]   — disconnect this site
 *
 * Per-site mutations only. List/add live at /api/wordpress/sites.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { removeSite, setDefaultSite } from '@/lib/wordpress-sites'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    label?: string
    makeDefault?: boolean
  }

  // makeDefault wins over label change when both are sent — the user
  // clicked "set as default" or "rename", not both in one request.
  if (body.makeDefault === true) {
    const result = await setDefaultSite(supabase, user.id, id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (typeof body.label === 'string') {
    const label = body.label.trim().slice(0, 60)
    if (!label) {
      return NextResponse.json({ error: 'Label cannot be empty.' }, { status: 400 })
    }
    const { error } = await supabase
      .from('wordpress_sites')
      .update({ label })
      .eq('user_id', user.id)
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Nothing to update (send `label` or `makeDefault`).' }, { status: 400 })
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const result = await removeSite(supabase, user.id, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
