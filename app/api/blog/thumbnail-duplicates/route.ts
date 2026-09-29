// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/blog/thumbnail-duplicates — the copies of YouTube thumbnails the old
// heal job piled into a creator's media library (lib/thumbnail-duplicates).
//
// GET                 how many there are, and their ids. Reads only.
// POST { ids }        removes them, each checked again first, until the
//                     deadline; returns what is left for the next call.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { findDuplicateThumbnails, removeDuplicateThumbnails } from '@/lib/thumbnail-duplicates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function setup() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return { error: auth.error }
  const { ownerId } = auth
  const site = await getWordPressCredentials(supabase, ownerId, null)
  if (!site) return { error: NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 }) }
  const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
  // The creator's own videos: only files named after one of them are touched.
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('youtube_videos').select('youtube_video_id').eq('user_id', ownerId).range(from, from + 999)
    for (const r of (data ?? []) as Array<{ youtube_video_id: string | null }>) if (r.youtube_video_id) ids.add(r.youtube_video_id)
    if (!data || data.length < 1000) break
  }
  return { wp, videoIds: ids, site: site.wordpress_url }
}

export async function GET() {
  const s = await setup()
  if ('error' in s) return s.error
  try {
    const r = await findDuplicateThumbnails(s.wp, s.videoIds)
    return NextResponse.json({ ok: true, site: s.site, count: r.ids.length, ids: r.ids, scanned: r.scanned })
  } catch (e) {
    // Could not read the library or the posts: say so, and remove nothing.
    return NextResponse.json({ ok: false, error: `WordPress did not let MVP read the media library, so nothing was checked: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const s = await setup()
  if ('error' in s) return s.error
  const body = await req.json().catch(() => ({})) as { ids?: number[] }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000) : []
  if (!ids.length) return NextResponse.json({ ok: true, removed: 0, skipped: 0, failed: 0, left: [] })
  try {
    const r = await removeDuplicateThumbnails(s.wp, ids, s.videoIds, Date.now() + 230_000)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: `WordPress did not let MVP check the images again, so nothing more was removed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }, { status: 502 })
  }
}
