/**
 * POST /api/youtube/shorts/mark-posted
 *
 * Stamps a rendered Short as published to a platform so the Shorts Studio UI
 * can show a "posted" pill that survives reloads. Called by the client right
 * after a successful TikTok / Instagram / YouTube cross-post. Best-effort:
 * the post already happened, this only records it.
 *
 * Body: { shortId, platform: 'tiktok' | 'instagram' | 'youtube' }
 * Returns: { ok, short } | { error }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { rowToShort } from '@/lib/shorts-row'
import type { ShortPlatform } from '@/lib/shorts-types'

export const runtime = 'nodejs'

const COLUMN: Record<ShortPlatform, string> = {
  tiktok: 'posted_tiktok',
  instagram: 'posted_instagram',
  youtube: 'posted_youtube',
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { shortId?: string; platform?: string }
    const shortId = (body.shortId || '').trim()
    const platform = body.platform as ShortPlatform
    if (!shortId) return NextResponse.json({ error: 'shortId is required.' }, { status: 400 })
    const column = COLUMN[platform]
    if (!column) return NextResponse.json({ error: 'Unknown platform.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: updated, error } = await sb.from('youtube_shorts')
      .update({ [column]: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', shortId).eq('user_id', user.id)
      .select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })

    return NextResponse.json({ ok: true, short: rowToShort(updated) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
