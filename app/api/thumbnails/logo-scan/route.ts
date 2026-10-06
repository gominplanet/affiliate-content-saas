// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/thumbnails/logo-scan
//
// Look at the pictures already published on a creator's posts and say which
// ones carry a retailer's logo.
//
// A creator generated a thumbnail, got an Amazon logo rendered into it, and
// pulled his video down. The prompt that caused it is fixed, but that only
// helps pictures made from now on. Everything generated before it is published
// and no screen can say which ones. The Associates Operating Agreement governs
// where an associate may put Amazon's marks, and these are marks MVP put there
// on somebody's behalf.
//
// WHAT THIS COVERS, AND WHAT IT CANNOT.
//
// It scans EVERY image inside the creator's published blog posts (it used to
// look at the first one only, and on the post that started this the first one
// was fine and the logos were further down), because those are the ones MVP
// can enumerate: they are in blog_posts.content. A background run does the
// same across every post (lib/post-logo-sweep); both record what they find in
// post_logo_findings, and GET lists it.
//
// It does NOT cover generated YouTube thumbnails, and that is worth stating
// rather than leaving somebody to assume otherwise. Those are handed to the
// creator and uploaded to YouTube by them; MVP keeps no URL for them, so there
// is nothing to enumerate. A creator who runs this and reads "no store logos"
// has learned that about their BLOG, not about their channel. The response says
// so in `covers`, and the screen repeats it.
//
// POST body: { limit?: number }   check that many recent posts now
// GET                              what has been found so far, and how far along
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { createAnthropicClient } from '@/lib/anthropic'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { summariseLogoScan, type LogoFinding } from '@/lib/logo-scan'
import { scanPost, MIGRATION_MISSING } from '@/lib/post-logo-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

const COVERS = 'Every picture published on your blog posts. It cannot see thumbnails you uploaded to YouTube yourself, because MVP does not keep a copy of those.'

type Row = { post_id: string; image_url: string; verdict: 'found' | 'unreadable'; marks: string[]; reason: string | null }

/** The stored findings for an owner, with each post's title, link and WordPress id. */
async function stored(admin: ReturnType<typeof createAdminClient>, ownerId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any
  const { data: rows, error } = await a.from('post_logo_findings').select('post_id,image_url,verdict,marks,reason').eq('user_id', ownerId).limit(500)
  if (error) return { error: /post_logo_findings/.test(String(error.message)) ? MIGRATION_MISSING : String(error.message) }
  const ids = [...new Set(((rows ?? []) as Row[]).map((r) => r.post_id))]
  const posts = new Map<string, { title: string | null; wordpress_url: string | null; wordpress_post_id: number | null }>()
  if (ids.length) {
    const { data } = await a.from('blog_posts').select('id,title,wordpress_url,wordpress_post_id').in('id', ids)
    for (const p of (data ?? []) as Array<{ id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null }>) posts.set(p.id, p)
  }
  const results = ((rows ?? []) as Row[]).map((r) => ({
    postId: r.post_id, url: r.image_url, verdict: r.verdict, marks: r.marks ?? [], reason: r.reason ?? undefined,
    title: posts.get(r.post_id)?.title ?? '', postUrl: posts.get(r.post_id)?.wordpress_url ?? null,
    wordpressPostId: posts.get(r.post_id)?.wordpress_post_id ?? null,
  }))
  const [checked, waiting] = await Promise.all([
    a.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).not('wordpress_post_id', 'is', null).not('logo_checked_at', 'is', null),
    a.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).not('wordpress_post_id', 'is', null).is('logo_checked_at', null),
  ])
  return { results, checkedPosts: checked.count ?? 0, waitingPosts: waiting.count ?? 0 }
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string }
  const s = await stored(createAdminClient(), ownerId)
  if ('error' in s) return NextResponse.json({ ok: false, error: s.error }, { status: 500 })
  return NextResponse.json({ ok: true, covers: COVERS, ...s })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string; userId?: string }

  const body = await request.json().catch(() => ({})) as { limit?: number }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any
  const admin = createAdminClient()

  const { data: intg } = await client.from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  // ONE PRESS IS A VISION CALL PER IMAGE ACROSS 25 POSTS, so it answers to the same spend
  // ceiling (and the same closed trial) as every other paid route.
  const spendBlocked = await spendGate(ownerId, tier)
  if (spendBlocked) return spendBlocked

  // Unchecked posts first, newest first; then the rest, so pressing it again
  // carries on rather than rereading the same ten.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any)
    .from('blog_posts')
    .select('id,user_id,content')
    .eq('user_id', ownerId)
    .not('wordpress_post_id', 'is', null)
    .order('logo_checked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ ok: false, error: /logo_checked_at/.test(String(error.message)) ? MIGRATION_MISSING : error.message }, { status: 500 })

  const anthropic = createAnthropicClient()
  const findings: LogoFinding[] = []
  let images = 0
  const deadline = Date.now() + 240_000
  let examined = 0
  for (const p of (rows ?? []) as Array<{ id: string; user_id: string; content: string | null }>) {
    if (Date.now() > deadline) break
    const r = await scanPost(admin, anthropic, p, { tier, feature: 'thumbnail_logo_scan' })
    if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
    examined++
    images += r.images
    for (let i = 0; i < r.found; i++) findings.push({ verdict: 'found', marks: [] })
    for (let i = 0; i < r.unreadable; i++) findings.push({ verdict: 'unreadable', marks: [] })
    for (let i = 0; i < r.images - r.found - r.unreadable; i++) findings.push({ verdict: 'clean', marks: [] })
  }

  const summary = summariseLogoScan(findings)
  const s = await stored(admin, ownerId)
  return NextResponse.json({
    ok: true,
    ...summary,
    // Stated, not implied. A creator reading "no store logos" needs to know
    // this looked at their blog and not at their YouTube channel.
    covers: COVERS,
    postsExamined: examined,
    imagesChecked: images,
    moreLikely: examined === limit,
    ...('error' in s ? { results: [] } : s),
  })
}
