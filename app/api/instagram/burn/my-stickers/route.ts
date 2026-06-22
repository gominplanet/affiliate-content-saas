/**
 * GET  /api/instagram/burn/my-stickers          → list the creator's saved
 *       CTA boxes (the ones they designed via "Make one from text").
 * DELETE /api/instagram/burn/my-stickers?id=...  → remove one.
 *
 * Owner-scoped (RLS + explicit user_id filter). The PNG stays in storage on
 * delete — cheap, and avoids breaking any video already burned with it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cta_stickers')
    .select('id,url,tag,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ stickers: [] }) // table missing → empty, non-fatal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stickers = ((data ?? []) as any[]).map(s => ({ id: s.id, url: s.url, tag: s.tag || '' }))
  return NextResponse.json({ stickers })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = (new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('cta_stickers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
