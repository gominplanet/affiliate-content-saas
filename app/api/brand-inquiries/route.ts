// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/brand-inquiries        — the creator's inbox (owner + VA scoped).
// PATCH /api/brand-inquiries       — mark read / unread / archive, or markAllRead.
//
// Reads/updates are RLS-scoped (owner or accepted VA). Inserts happen only via
// the public /api/brand-inquiry endpoint (service role).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('brand_inquiries')
    .select('id, brand_name, contact_name, contact_email, message, source_url, read_at, created_at')
    .eq('owner_id', ownerId)
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const inquiries = (data ?? []) as Array<{ read_at: string | null }>
  const unread = inquiries.filter(i => !i.read_at).length
  return NextResponse.json({ inquiries, unread })
}

export async function PATCH(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await req.json().catch(() => ({})) as { id?: string; action?: 'read' | 'unread' | 'archive'; markAllRead?: boolean }

  // Mark every unread inquiry read (called when the inbox is opened).
  if (body.markAllRead) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('brand_inquiries')
      .update({ read_at: new Date().toISOString() })
      .eq('owner_id', ownerId)
      .is('read_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> =
    body.action === 'archive' ? { archived: true }
    : body.action === 'unread' ? { read_at: null }
    : { read_at: new Date().toISOString() }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('brand_inquiries')
    .update(patch)
    .eq('owner_id', ownerId)
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
