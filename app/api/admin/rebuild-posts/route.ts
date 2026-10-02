// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/admin/rebuild-posts?userId=…   a creator's video posts, with why
//                                          each would be worth rebuilding and
//                                          how the last repair of it went
// POST /api/admin/rebuild-posts            queue repairs for chosen videos
//
// WHY. Posts written from a creator's own videos while their transcript could
// not be read came out as research, some saying so under his own video. The
// fix is a rebuild now that MVP can read the audio, but asking the creator to
// rebuild costs him: rebuilds are Pro only and three per post. This is the
// same rebuild done on our side:
//
//   - IN PLACE. The live post is updated (same address, same date, same
//     featured image). A video with no live post is refused, never created.
//   - ON OUR COST. The job is queued under the admin who pressed the button,
//     so its AI spend is ours, and it does not count as one of the creator's
//     rebuilds (blog_posts.rewrite_count). The monthly allowance counts posts,
//     and an update is not a new post.
//   - ONLY WITH A TRANSCRIPT. Without one the route stops before writing and
//     the post is left exactly as it was (reason repair_no_transcript).
//   - ONE ATTEMPT. A refusal is final and shown; nothing retries on its own.
//   - NO SOCIAL POSTS. Nothing is shared again.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueGenerationJob } from '@/lib/generation-jobs'
import { researchSignals, repairReasons, hasUsableTranscript } from '@/lib/post-repair'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_QUEUE_PER_CALL = 40

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(): Promise<{ admin: any; adminId: string } | { error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((caller as any)?.tier !== 'admin') return { error: NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: createAdminClient() as any, adminId: user.id }
}

type PostRow = { id: string; title: string | null; video_id: string; wordpress_url: string | null; wordpress_site_id: string | null; content: string | null; created_at: string }

async function readPosts(admin: Sb, userId: string): Promise<PostRow[]> {
  const out: PostRow[] = []
  for (let from = 0; from < 2000; from += 500) {
    const { data, error } = await admin.from('blog_posts')
      .select('id,title,video_id,wordpress_url,wordpress_site_id,content,created_at')
      .eq('user_id', userId).not('video_id', 'is', null).not('wordpress_post_id', 'is', null)
      .order('created_at', { ascending: false }).range(from, from + 499)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as PostRow[]))
    if ((data ?? []).length < 500) break
  }
  return out
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin } = gate
  const userId = new URL(request.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 })

  try {
    const posts = await readPosts(admin, userId)
    // The videos, read in small groups: transcripts are long.
    const ids = [...new Set(posts.map((p) => p.video_id))]
    const transcribed = new Map<string, boolean>()
    for (let i = 0; i < ids.length; i += 25) {
      const { data, error } = await admin.from('youtube_videos').select('id,transcript,transcript_cues').in('id', ids.slice(i, i + 25))
      if (error) throw new Error(error.message)
      for (const v of (data ?? []) as Array<{ id: string; transcript: unknown; transcript_cues: unknown }>) {
        transcribed.set(v.id, hasUsableTranscript(v.transcript, v.transcript_cues))
      }
    }
    // The latest repair of each video, so a refusal stays on screen.
    const { data: jobs } = await admin.from('generation_jobs')
      .select('id,status,error,input,created_at,finished_at')
      .eq('owner_id', userId).eq('kind', 'blog').contains('input', { repair: true })
      .order('created_at', { ascending: false }).limit(500)
    const lastJob = new Map<string, { status: string; error: string | null; at: string }>()
    for (const j of (jobs ?? []) as Array<{ status: string; error: string | null; input: { videoId?: string }; created_at: string; finished_at: string | null }>) {
      const vid = j.input?.videoId
      if (vid && !lastJob.has(vid)) lastJob.set(vid, { status: j.status, error: j.error, at: j.finished_at || j.created_at })
    }

    const rows = posts.map((p) => {
      const hasTranscript = transcribed.get(p.video_id) ?? false
      const reasons = repairReasons({ hasTranscript, signals: researchSignals(p.content) })
      return {
        id: p.id, title: p.title, videoId: p.video_id, url: p.wordpress_url, createdAt: p.created_at,
        hasTranscript, reasons, repair: lastJob.get(p.video_id) ?? null,
      }
    })
    return NextResponse.json({ ok: true, posts: rows })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin, adminId } = gate
  const body = await request.json().catch(() => ({})) as { userId?: string; videoIds?: string[] }
  const userId = body.userId
  const videoIds = Array.isArray(body.videoIds) ? [...new Set(body.videoIds.filter((v) => typeof v === 'string'))].slice(0, MAX_QUEUE_PER_CALL) : []
  if (!userId || videoIds.length === 0) return NextResponse.json({ ok: false, error: 'userId and videoIds required' }, { status: 400 })

  // Scoped to the named creator: only their own live video posts.
  const { data: rows, error } = await admin.from('blog_posts')
    .select('video_id,wordpress_site_id')
    .eq('user_id', userId).in('video_id', videoIds).not('wordpress_post_id', 'is', null)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const site = new Map<string, string | null>()
  for (const r of (rows ?? []) as Array<{ video_id: string; wordpress_site_id: string | null }>) site.set(r.video_id, r.wordpress_site_id)

  const queued: string[] = []
  const refused: Array<{ videoId: string; reason: string }> = []
  for (const videoId of videoIds) {
    if (!site.has(videoId)) { refused.push({ videoId, reason: 'no live post for this video on this account' }); continue }
    const siteId = site.get(videoId)
    const jobId = await enqueueGenerationJob(admin, {
      userId: adminId, ownerId: userId, kind: 'blog', maxAttempts: 1,
      input: { videoId, repair: true, ...(siteId ? { siteId } : {}) },
    })
    if (jobId) queued.push(videoId)
    else refused.push({ videoId, reason: 'the job queue would not take it' })
  }
  return NextResponse.json({ ok: queued.length > 0, queued: queued.length, refused })
}
