/**
 * PATCH /api/youtube/shorts/update
 *
 * Edit a planned Short before (or after) rendering: adjust the trim window and
 * tweak the on-screen hook + post caption. The in-app editor (ShortsStudioModal)
 * saves through here; the next render uses the edited values.
 *
 * Body: { shortId, startSec?, endSec?, hook?, caption? }
 * Returns: { ok, short } | { error }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { rowToShort } from '@/lib/shorts-row'

export async function PATCH(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    shortId?: string; startSec?: number; endSec?: number; hook?: string; caption?: string
  }
  const shortId = (body.shortId || '').trim()
  if (!shortId) return NextResponse.json({ error: 'shortId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: short } = await sb.from('youtube_shorts')
    .select('id,start_sec,end_sec').eq('id', shortId).eq('user_id', user.id).maybeSingle()
  if (!short) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })

  // Only write fields that were actually provided. Trim is validated together so
  // start/end can't cross; length is clamped to a sane Short window (3–180s).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  let start = Number(short.start_sec)
  let end = Number(short.end_sec)
  if (Number.isFinite(Number(body.startSec))) start = Math.max(0, Math.round(Number(body.startSec) * 10) / 10)
  if (Number.isFinite(Number(body.endSec))) end = Math.max(0, Math.round(Number(body.endSec) * 10) / 10)
  if (body.startSec !== undefined || body.endSec !== undefined) {
    if (!(end > start)) return NextResponse.json({ error: 'End must be after start.' }, { status: 400 })
    const len = end - start
    if (len < 3) return NextResponse.json({ error: 'Clip must be at least 3 seconds.' }, { status: 400 })
    if (len > 180) return NextResponse.json({ error: 'Clip must be under 3 minutes.' }, { status: 400 })
    patch.start_sec = start
    patch.end_sec = end
  }
  if (typeof body.hook === 'string') patch.hook = body.hook.slice(0, 90).trim()
  if (typeof body.caption === 'string') patch.caption = body.caption.slice(0, 600).trim()

  const { data: updated, error } = await sb.from('youtube_shorts')
    .update(patch).eq('id', shortId).eq('user_id', user.id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, short: updated ? rowToShort(updated) : null })
}
