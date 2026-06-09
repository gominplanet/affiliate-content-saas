import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): failures roll up to the owner's account —
  // anyone working in the same workspace sees + resolves the same failures.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { data, error } = await supabase
    .from('job_failures')
    .select('*, youtube_videos(title)')
    .eq('user_id', ownerId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// PATCH — update status (dismiss or mark resolved)
export async function PATCH(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { id, status } = await req.json()
  // Allowlist — the column is a free-form text in PG so without this any
  // string the client sends becomes the new status. Most consumers gate
  // logic off `status === 'dismissed'`, but a stray value would still
  // accumulate noise + leave the row in a state no UI knows how to render.
  const ALLOWED = new Set(['dismissed', 'resolved', 'open'])
  if (typeof status !== 'string' || !ALLOWED.has(status)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('job_failures')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', ownerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
