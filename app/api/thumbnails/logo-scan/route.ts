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
// It scans the images inside the creator's published blog posts, because those
// are the ones MVP can enumerate: they are in blog_posts.content.
//
// It does NOT cover generated YouTube thumbnails, and that is worth stating
// rather than leaving somebody to assume otherwise. Those are handed to the
// creator and uploaded to YouTube by them; MVP keeps no URL for them, so there
// is nothing to enumerate. A creator who runs this and reads "no store logos"
// has learned that about their BLOG, not about their channel. The response says
// so in `covers`, and the screen repeats it.
//
// Body: { limit?: number }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { normalizeTier } from '@/lib/tier'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { LOGO_SCAN_PROMPT, readLogoReply, summariseLogoScan, type LogoFinding } from '@/lib/logo-scan'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SCAN_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40
/** Anything bigger than this is not a thumbnail and is not worth the tokens. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

/** Fetch an image as an Anthropic image block, or null with the reason. */
async function imageBlock(url: string): Promise<
  | { ok: true; block: { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } } }
  | { ok: false; reason: string }
> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 20_000 })
    if (!res.ok) return { ok: false, reason: `the image could not be fetched (${res.status})` }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!/^image\//.test(ct)) return { ok: false, reason: `that URL returned ${ct || 'no content type'} rather than an image` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'the image is too large to check' }
    const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg'
    return { ok: true, block: { type: 'image', source: { type: 'base64', media_type, data: buf.toString('base64') } } }
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : 'the image could not be fetched').slice(0, 160) }
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId, userId } = auth as { ownerId: string; userId?: string }

  const body = await request.json().catch(() => ({})) as { limit?: number }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any

  const { data: intg } = await client.from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  const tier = normalizeTier(intg?.tier)

  // Monthly AI-spend circuit breaker. Up to MAX_LIMIT vision calls per run,
  // and nothing capped how many runs an account could kick off.
  const spendBlocked = await spendGate(ownerId, tier)
  if (spendBlocked) return spendBlocked

  const { data: rows, error } = await client
    .from('blog_posts')
    .select('id,title,content,wordpress_url')
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // One image per post, the first one, which is the hero and the one a reader
  // sees. Scanning every image in every post would be the same answer at
  // several times the cost, and the creator can rerun with a bigger limit.
  const targets: Array<{ postId: string; title: string; url: string; postUrl: string | null }> = []
  for (const p of (rows ?? []) as Array<{ id: string; title: string | null; content: string | null; wordpress_url: string | null }>) {
    const m = (p.content ?? '').match(/<img[^>]*\ssrc=["']([^"']+)["']/i)
    const url = m?.[1]
    if (!url || url.startsWith('data:')) continue
    // A YouTube thumbnail is the creator's own video frame, not something MVP
    // drew, so it cannot carry a mark we put there.
    if (/ytimg\.com|youtube\.com/i.test(url)) continue
    targets.push({ postId: p.id, title: p.title ?? '', url, postUrl: p.wordpress_url })
  }

  const anthropic = createAnthropicClient()
  const findings: LogoFinding[] = []
  const results: Array<{ postId: string; title: string; url: string; postUrl: string | null; verdict: string; marks: string[]; reason?: string }> = []

  for (const t of targets) {
    const img = await imageBlock(t.url)
    if (!img.ok) {
      // NOT skipped silently. An image we could not open is unchecked, and the
      // summary must not count it as clean.
      const f: LogoFinding = { verdict: 'unreadable', marks: [], reason: img.reason }
      findings.push(f)
      results.push({ ...t, verdict: f.verdict, marks: [], reason: f.reason })
      continue
    }

    let f: LogoFinding
    try {
      const msg = await anthropic.messages.create({
        model: SCAN_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: [img.block, { type: 'text', text: LOGO_SCAN_PROMPT }] }],
      })
      recordAnthropicUsage(msg, { userId: userId ?? ownerId, tier, feature: 'thumbnail_logo_scan', model: SCAN_MODEL })
      const text = ((msg.content[0] as { type: string; text?: string }).text ?? '').trim()
      f = readLogoReply(text)
    } catch (e) {
      f = { verdict: 'unreadable', marks: [], reason: (e instanceof Error ? e.message : 'the check failed').slice(0, 160) }
    }

    findings.push(f)
    results.push({ ...t, verdict: f.verdict, marks: f.marks, reason: f.reason })
  }

  const summary = summariseLogoScan(findings)

  return NextResponse.json({
    ok: true,
    ...summary,
    // Stated, not implied. A creator reading "no store logos" needs to know
    // this looked at their blog and not at their YouTube channel.
    covers: 'The pictures published on your blog posts. It cannot see thumbnails you uploaded to YouTube yourself, because MVP does not keep a copy of those.',
    postsExamined: (rows ?? []).length,
    imagesChecked: targets.length,
    results: results.filter(r => r.verdict !== 'clean'),
    moreLikely: (rows ?? []).length === limit,
  })
}
