/**
 * POST /api/instagram/burn-batch — queue up to 5 videos for the Instagram
 * Burner. Each gets its own caption + optional product; style/position are
 * shared. scheduled_at is auto-spread from a start time by a chosen interval.
 * A per-minute cron (/api/cron/process-burn-jobs) burns + publishes each.
 *
 * GET /api/instagram/burn-batch — the user's recent jobs (the queue view).
 *
 * Pro-only. Videos are uploaded client-side first; we receive their URLs.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { metaEnabled } from '@/lib/feature-flags'

const STYLES = ['white-pill', 'black-pill', 'yellow-pill', 'white-shadow']
const POSITIONS = ['lower-third', 'center']
const MAX_BATCH = 5

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!metaEnabled()) return NextResponse.json({ error: 'Instagram publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ error: 'Batch scheduling is a Pro feature.', limitReached: true, cap: 'instagram_burner', currentTier: tier, upgrade: { tier: 'pro', label: 'Pro', limit: null } }, { status: 403 })
    }

    const body = await request.json() as {
      videos?: Array<{ videoUrl?: string; caption?: string; product?: string }>
      style?: string; position?: string
      startAt?: string; intervalHours?: number
    }
    const videos = (body.videos || []).filter(v => typeof v?.videoUrl === 'string' && /^https:\/\//i.test(v.videoUrl)).slice(0, MAX_BATCH)
    if (videos.length === 0) return NextResponse.json({ error: 'Upload at least one video.' }, { status: 400 })

    const style = STYLES.includes(body.style || '') ? body.style! : 'white-pill'
    const position = POSITIONS.includes(body.position || '') ? body.position! : 'lower-third'
    const startMs = body.startAt && !isNaN(Date.parse(body.startAt)) ? Date.parse(body.startAt) : Date.now()
    const intervalHours = Math.max(0, Math.min(24 * 30, Number(body.intervalHours) || 0)) // 0 = post all ASAP

    const rows = videos.map((v, i) => ({
      user_id: user.id,
      source_video_url: v.videoUrl,
      caption_text: (v.caption || 'LINK IN BIO').trim().slice(0, 60) || 'LINK IN BIO',
      style,
      position,
      product: (v.product || '').trim() || null,
      scheduled_at: new Date(startMs + i * intervalHours * 3600_000).toISOString(),
      status: 'pending',
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('ig_burn_jobs').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, queued: rows.length, firstAt: rows[0].scheduled_at, lastAt: rows[rows.length - 1].scheduled_at })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('ig_burn_jobs')
      .select('id,caption_text,status,scheduled_at,result_url,ig_published,error_message,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(25)
    return NextResponse.json({ ok: true, jobs: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
