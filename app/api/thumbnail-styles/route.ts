/**
 * GET    /api/thumbnail-styles                  → list { id, name, reference_url }[]
 * POST   /api/thumbnail-styles { name, referenceUrl } → create one
 *
 * Saved style presets the studio's "Style reference" picker offers as one-click
 * chips. Each preset just stores a name + the image URL the user already
 * uploaded for a style reference — the thumbnail route extracts the visual
 * brief on-demand when the user generates with that preset selected.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): saved thumbnail styles belong to the owner's
  // workspace so anyone generating sees the same chips.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from('thumbnail_styles')
    .select('id,name,reference_url,created_at')
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
  return NextResponse.json({ ok: true, styles: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await request.json().catch(() => ({})) as { name?: string; referenceUrl?: string }
  const name = (body.name || '').trim().slice(0, 60)
  const referenceUrl = (body.referenceUrl || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!referenceUrl || !/^https?:\/\//i.test(referenceUrl)) {
    return NextResponse.json({ error: 'a valid referenceUrl is required' }, { status: 400 })
  }

  // Cap at 12 presets per user — sane upper bound, plenty for a creator who
  // wants a few "review", "comparison", "review-dark" looks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await supabase
    .from('thumbnail_styles')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ownerId)
  if ((count ?? 0) >= 12) {
    return NextResponse.json({ error: 'You\'ve reached the 12-preset limit. Delete one to add a new one.' }, { status: 422 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase
    .from('thumbnail_styles')
    .insert({ user_id: ownerId, name, reference_url: referenceUrl })
    .select('id,name,reference_url,created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, style: data })
}
