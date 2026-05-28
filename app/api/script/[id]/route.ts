/**
 * GET    /api/script/[id] — fetch one saved script with its full body
 * DELETE /api/script/[id] — remove a script from the creator's history
 *
 * RLS scopes the SELECT/DELETE to the caller's own rows automatically.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('video_scripts')
    .select('id,style,input,asin,product_title,product_image_url,script,created_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ script: data })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('video_scripts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
