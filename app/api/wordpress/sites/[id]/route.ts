/**
 * PATCH  /api/wordpress/sites/[id]   — relabel or set as default
 * DELETE /api/wordpress/sites/[id]   — disconnect this site
 *
 * Per-site mutations only. List/add live at /api/wordpress/sites.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { removeSite, setDefaultSite } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): mutations target owner's wordpress_sites row.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    label?: string
    makeDefault?: boolean
  }

  // makeDefault wins over label change when both are sent — the user
  // clicked "set as default" or "rename", not both in one request.
  if (body.makeDefault === true) {
    const result = await setDefaultSite(supabase, ownerId, id)
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
      .eq('user_id', ownerId)
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Nothing to update (send `label` or `makeDefault`).' }, { status: 400 })
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { id } = await ctx.params
  const result = await removeSite(supabase, ownerId, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
