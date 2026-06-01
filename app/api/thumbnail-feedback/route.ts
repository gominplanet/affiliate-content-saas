/**
 * POST /api/thumbnail-feedback
 *   Body: { thumbnailUrl, reaction, styleId?, surface, modelUsed?, videoId? }
 *   Records one 👍 / 👎 row in thumbnail_feedback.
 *
 * GET /api/thumbnail-feedback?surface=youtube
 *   Returns an aggregated style summary for this user:
 *     { liked: { 'mrbeast-yellow': 5, 'impact-classic': 2 },
 *       disliked: { 'bangers-orange': 4 },
 *       total: 11 }
 *   Studio + IG modal use this to bias the random style picker —
 *   styles with strong negative signal get excluded, styles with
 *   strong positive signal get boosted.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    thumbnailUrl?: string
    reaction?: 'like' | 'dislike'
    styleId?: string | null
    surface?: 'youtube' | 'instagram'
    modelUsed?: string | null
    videoId?: string | null
  }
  if (!body.thumbnailUrl) return NextResponse.json({ error: 'thumbnailUrl required' }, { status: 400 })
  if (body.reaction !== 'like' && body.reaction !== 'dislike') {
    return NextResponse.json({ error: "reaction must be 'like' or 'dislike'" }, { status: 400 })
  }
  if (body.surface !== 'youtube' && body.surface !== 'instagram') {
    return NextResponse.json({ error: "surface must be 'youtube' or 'instagram'" }, { status: 400 })
  }

  // Record the niche this feedback belongs to so style learning can be
  // PER-NICHE (e.g. punchy banners win on tools, cleaner styles on
  // beauty). Prefer the specific video's category; fall back to the
  // user's primary brand niche when the video has none.
  let niche: string | null = null
  if (body.videoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vid } = await supabase
      .from('youtube_videos').select('selected_category').eq('id', body.videoId).eq('user_id', user.id).single()
    niche = (vid?.selected_category as string | null)?.trim() || null
  }
  if (!niche) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await supabase
      .from('brand_profiles').select('niches').eq('user_id', user.id).single()
    niche = (brand?.niches as string[] | null)?.[0] ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('thumbnail_feedback')
    .insert({
      user_id: user.id,
      video_id: body.videoId ?? null,
      thumbnail_url: body.thumbnailUrl,
      reaction: body.reaction,
      style_id: body.styleId ?? null,
      surface: body.surface,
      model_used: body.modelUsed ?? null,
      niche,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const surface = url.searchParams.get('surface') // optional filter
  const niche = url.searchParams.get('niche')?.trim() || null // optional: bias to this niche

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = supabase
    .from('thumbnail_feedback')
    .select('reaction,style_id,surface,niche')
    .eq('user_id', user.id)
  if (surface === 'youtube' || surface === 'instagram') q = q.eq('surface', surface)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // NICHE-AWARE WEIGHTING: every row counts once (overall taste), and rows
  // matching the requested niche count an EXTRA 2× — so styles that won/
  // lost on this kind of video dominate the pick, while still falling back
  // gracefully to overall taste when niche-specific data is thin.
  const liked: Record<string, number> = {}
  const disliked: Record<string, number> = {}
  let nicheRows = 0
  for (const r of (data || []) as Array<{ reaction: string; style_id: string | null; niche: string | null }>) {
    if (!r.style_id) continue
    const bucket = r.reaction === 'like' ? liked : disliked
    const weight = (niche && r.niche && r.niche.toLowerCase() === niche.toLowerCase()) ? 3 : 1
    if (weight > 1) nicheRows++
    bucket[r.style_id] = (bucket[r.style_id] || 0) + weight
  }

  return NextResponse.json({
    liked,
    disliked,
    total: (data?.length ?? 0),
    niche: niche || null,
    nicheSamples: nicheRows,
  })
}
