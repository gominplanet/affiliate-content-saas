// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pre-render the designed Pinterest pin for scheduled posts BEFORE they're due,
// so the publish cron (process-scheduled, 60s) never has to build it under a
// budget and fall back to the raw thumbnail. Runs every minute with a generous
// maxDuration; picks pinterest rows scheduled in the next few minutes, builds
// the SAME art-director pin the manual composer makes, and stores it on the row
// (image_data + image_media_type). process-scheduled then posts the finished
// image with no race.
//
// Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPinAssets, composePinDescription } from '@/lib/pin-assets'
import { getAccountHeadlineStyle } from '@/lib/thumbnail-style'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Cost + time guard: at most this many pins per tick. The cron runs every
// minute, so a burst drains over a few ticks instead of one huge run.
const MAX_PER_TICK = 5
// Pins are scheduled ~5 min out; grab them once they're within this window so
// the render finishes well before the publish cron claims them (it only takes
// rows whose scheduled_at is already due).
const LOOKAHEAD_MS = 15 * 60_000

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const windowIso = new Date(now + LOOKAHEAD_MS).toISOString()

  // 1. Candidate rows: upcoming pinterest posts with no pin rendered and no
  //    render in flight.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates } = await (admin as any)
    .from('scheduled_posts')
    .select('id,user_id,blog_post_id')
    .eq('platform', 'pinterest')
    .eq('status', 'pending')
    .is('image_data', null)
    .is('image_media_type', null)
    .gt('scheduled_at', nowIso)
    .lte('scheduled_at', windowIso)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_TICK)
  const rows = (candidates ?? []) as Array<{ id: string; user_id: string; blog_post_id: string }>
  if (!rows.length) return NextResponse.json({ ok: true, rendered: 0 })

  // 2. Claim them (guard on image_media_type still null) so two overlapping
  //    ticks never render the same row.
  const ids = rows.map(r => r.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed } = await (admin as any)
    .from('scheduled_posts')
    .update({ image_media_type: 'rendering' })
    .in('id', ids)
    .is('image_media_type', null)
    .eq('status', 'pending')
    .select('id,user_id,blog_post_id')
  const claimedRows = (claimed ?? []) as Array<{ id: string; user_id: string; blog_post_id: string }>
  if (!claimedRows.length) return NextResponse.json({ ok: true, rendered: 0 })

  // Cache tier per user (buildPinAssets uses it for voice/gating).
  const tierByUser = new Map<string, string | null>()
  async function tierFor(userId: string): Promise<string | null> {
    if (tierByUser.has(userId)) return tierByUser.get(userId) ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from('integrations').select('tier').eq('user_id', userId).maybeSingle()
    const t = (data?.tier as string) ?? null
    tierByUser.set(userId, t)
    return t
  }

  let rendered = 0
  const results = await Promise.allSettled(claimedRows.map(async (row) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: post } = await (admin as any).from('blog_posts').select('*').eq('id', row.blog_post_id).maybeSingle()
      if (!post) throw new Error('post gone')
      const tier = await tierFor(row.user_id)
      const headlineStyle = await getAccountHeadlineStyle(admin, row.user_id)
      const assets = await buildPinAssets(post, { userId: row.user_id, tier }, { artDirector: true, headlineStyle })
      if (assets?.imageBase64) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('scheduled_posts').update({
          image_data: assets.imageBase64,
          image_media_type: assets.mediaType || 'image/jpeg',
          body_text: composePinDescription(assets),
        }).eq('id', row.id)
        rendered++
      } else {
        // No composed image (nothing to design from) — release the claim so the
        // publish cron falls back to its own fire-time path.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('scheduled_posts').update({ image_media_type: null }).eq('id', row.id)
      }
    } catch (e) {
      console.warn('[prerender-pins] row', row.id, 'failed:', e instanceof Error ? e.message : String(e))
      // Release the claim so a later tick (or fire-time) can retry.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await (admin as any).from('scheduled_posts').update({ image_media_type: null }).eq('id', row.id) } catch { /* ignore */ }
    }
  }))
  void results

  return NextResponse.json({ ok: true, rendered, claimed: claimedRows.length })
}
