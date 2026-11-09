// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK, THE DAILY CHECK THE OFFICIAL WAY (lib/tiktok-video-list).
// For each creator who turned on "Check for new TikTok videos daily" and whose
// TikTok connection allows reading videos: the newest pages of their videos,
// stopping at the first page MVP already has, then the matches again when
// anything was new. Does nothing until TikTok approves the scope and the
// TIKTOK_VIDEO_LIST switch is on; until then SCOUT runs the daily check in
// the creator's Chrome.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { videoListSwitchOn, scopesIncludeVideoList, readVideoList } from '@/lib/tiktok-video-list'
import { saveVideos, recomputeMatches } from '@/lib/tiktok-library'
import { cleanHandle } from '@/lib/tiktok-videos'
import { getValidTikTokToken } from '@/services/tiktok'

export const runtime = 'nodejs'
export const maxDuration = 120

const PER_RUN = 40
const BUDGET_MS = 100_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!videoListSwitchOn()) return NextResponse.json({ ok: true, skipped: 'TIKTOK_VIDEO_LIST is off: SCOUT runs the daily check in each creator’s Chrome until TikTok approves the scope.' })

  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const dayAgo = new Date(Date.now() - 20 * 3600_000).toISOString()
  const { data: libs, error } = await sb.from('tiktok_library').select('user_id, handle, scan_finished_at, scan_status')
    .eq('daily', true).neq('scan_status', 'running').or(`scan_finished_at.is.null,scan_finished_at.lt.${dayAgo}`).limit(PER_RUN)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const done: Array<{ user: string; read: number; fresh: number; error: string | null }> = []
  for (const lib of (libs || []) as Array<{ user_id: string; handle: string }>) {
    if (Date.now() - started > BUDGET_MS) break
    const { data: intg } = await sb.from('integrations').select('tiktok_scopes, tiktok_username').eq('user_id', lib.user_id).maybeSingle()
    if (!scopesIncludeVideoList(intg?.tiktok_scopes)) continue
    const handle = cleanHandle(intg?.tiktok_username) || lib.handle
    if (handle !== lib.handle) continue
    const token = await getValidTikTokToken(sb, lib.user_id)
    if (!token) { done.push({ user: lib.user_id, read: 0, fresh: 0, error: 'no token' }); continue }
    const { data: latest } = await sb.from('tiktok_videos').select('video_id').eq('user_id', lib.user_id).order('posted_at', { ascending: false }).limit(60)
    const known = new Set(((latest || []) as Array<{ video_id: string }>).map((r) => r.video_id))
    const read = await readVideoList(token, handle, { deadline: Math.min(started + BUDGET_MS, Date.now() + 15_000), maxPages: 3, known })
    const saved = await saveVideos(sb, lib.user_id, handle, read.videos, 'tiktok')
    const fresh = read.videos.length - saved.known
    const now = new Date().toISOString()
    await sb.from('tiktok_library').update({ scan_finished_at: now, scan_updated_at: now, updated_at: now, ...(read.error ? { scan_error: `Daily check: ${read.error}` } : {}) }).eq('user_id', lib.user_id)
    if (fresh > 0) await recomputeMatches(sb, lib.user_id, { budgetMs: 15_000 })
    done.push({ user: lib.user_id, read: read.videos.length, fresh, error: read.error || saved.error })
  }
  return NextResponse.json({ ok: true, checked: done.length, done })
}
