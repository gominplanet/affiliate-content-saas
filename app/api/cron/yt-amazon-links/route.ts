// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE VS AMAZON, FINISHED IN THE BACKGROUND (Seb, 2026-11-12: "when we
// are scanning a YouTube channel ... if there's a product link, you literally
// go look at the link and figure out the ASIN"). With no Geniuslink keys, MVP
// may follow ten geni.us links a minute (geni.us's own limit), and his 1,705
// waiting links only moved while the page stayed open. Every minute, for each
// creator with links waiting on a link service, this reads ten more (the
// unread ones first, else the ten that have waited longest) with the reader
// the page uses (lib/yt-amazon-reader), so the list finishes by itself.
//
// Only creators who started a read have waiting links (a reason saved as
// "<reader>:rate-limited"), so nobody is read who did not ask.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readLinkBatch, READER } from '@/lib/yt-amazon-reader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Links a minute per creator: geni.us answers ten. */
const PER_CREATOR = 10

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const started = Date.now()
  const { data: waiting, error } = await db.from('youtube_videos').select('user_id').like('products_why', `${READER}:rate-limited%`).limit(5000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: /products_why|does not exist/i.test(error.message) ? 200 : 500 })
  const creators = Array.from(new Set(((waiting || []) as Array<{ user_id: string }>).map((r) => r.user_id)))
  const done: Array<{ creator: string; read: number; found: number; slowed: number; left: number; error?: string }> = []
  for (const creator of creators) {
    if (Date.now() - started > 90_000) break
    // The unread ones first (a run the page did not finish); else the ten
    // that have waited longest are put back in the queue.
    const { count: unread } = await db.from('youtube_videos').select('youtube_video_id', { count: 'exact', head: true }).eq('user_id', creator).is('products_read_at', null)
    if (!unread) {
      const { data: next } = await db.from('youtube_videos').select('youtube_video_id').eq('user_id', creator).like('products_why', `${READER}:rate-limited%`).order('products_read_at', { ascending: true }).limit(PER_CREATOR)
      const ids = ((next || []) as Array<{ youtube_video_id: string }>).map((r) => r.youtube_video_id)
      if (!ids.length) continue
      // A failed requeue leaves nothing unread, so the batch below would read
      // nothing and look exactly like a creator with nothing waiting. Say so.
      const { error: requeueError } = await db.from('youtube_videos').update({ products_read_at: null }).eq('user_id', creator).in('youtube_video_id', ids)
      if (requeueError) {
        done.push({ creator: creator.slice(0, 8), read: 0, found: 0, slowed: 0, left: ids.length, error: `Could not put ${ids.length} waiting links back in line: ${requeueError.message}` })
        continue
      }
    }
    const b = await readLinkBatch(db, creator, { limit: PER_CREATOR, workers: 1, budgetMs: 40_000 })
    done.push({ creator: creator.slice(0, 8), read: b.read, found: b.found, slowed: b.slowed, left: b.left, ...(b.saveError ? { error: b.saveError } : {}) })
  }
  return NextResponse.json({ ok: true, creators: creators.length, done })
}
