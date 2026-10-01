// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/video-plan — Plan this video (lib/video-plan.ts). LABS, admin only
// while it is tested (lib/labs-preview.ts video_plan).
//
// GET                                   the plans, newest first, each with
//                                       `made`: the video on the channel for
//                                       that product since the plan, or null
// POST { action: 'create', asin, campaignId?, brand?, product?, endsAt? }
// POST { action: 'delete', id }
//
// A plan is "made" only when a video for the product exists on the channel,
// read from youtube_videos, never because a button was pressed.
// Needs migration 395.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { fetchAmazonProduct } from '@/services/amazon'
import { planDates, buildPlanPrompt, parsePlan, type VideoPlan } from '@/lib/video-plan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-sonnet-4-6'
const missingTable = (m?: string) => /video_plans/.test(m || '') && /does not exist|could not find/i.test(m || '')

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('video_plan', intg?.tier)) return { error: NextResponse.json({ error: 'Plan this video is still being tested.' }, { status: 403 }) }
  return { userId: user.id, ownerId, tier: (intg?.tier as string | null) ?? null }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('video_plans').select('id,asin,campaign_id,brand,product,ends_at,plan,created_at')
    .eq('user_id', g.ownerId).order('created_at', { ascending: false }).limit(50)
  if (error) return NextResponse.json({ plans: [], error: missingTable(error.message) ? 'Migration 395 has not been run.' : error.message })
  const plans = (data ?? []) as Array<{ asin: string; created_at: string } & Record<string, unknown>>
  // Made = a video for this product on the channel since the plan was written.
  const asins = [...new Set(plans.map((p) => p.asin))]
  const { data: vids } = asins.length
    ? await admin.from('youtube_videos').select('asin,title,youtube_video_id,published_at').eq('user_id', g.ownerId).in('asin', asins)
    : { data: [] }
  const out = plans.map((p) => {
    const v = ((vids ?? []) as Array<{ asin: string; title: string | null; youtube_video_id: string | null; published_at: string | null }>)
      .filter((x) => x.asin === p.asin && x.published_at && x.published_at >= p.created_at)
      .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)))[0]
    return { ...p, made: v ? { title: v.title, youtubeVideoId: v.youtube_video_id, publishedAt: v.published_at } : null }
  })
  return NextResponse.json({ plans: out })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  if (body.action === 'delete') {
    await admin.from('video_plans').delete().eq('id', String(body.id || '')).eq('user_id', g.ownerId)
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'create') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  const asin = String(body.asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'No product to plan.' }, { status: 400 })
  // Only a campaign this account actually has.
  const { data: rows } = await admin.from('campaigns').select('asin,product_title,brand_name,ends_at,cc_campaign_id')
    .eq('user_id', g.ownerId).eq('asin', asin).limit(5)
  const row = ((rows ?? []) as Array<Record<string, string | null>>)[0]
  if (!row) return NextResponse.json({ error: 'That product is not one of your campaigns.' }, { status: 404 })
  const endsAt = (typeof body.endsAt === 'string' && body.endsAt) || row.ends_at || null
  const dates = planDates(endsAt)

  // What is known about the product. Amazon often refuses MVP's server, so a
  // missing page is said in the plan input rather than treated as fatal.
  const page = await Promise.race([
    fetchAmazonProduct(asin).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
  ])
  const product = String(body.product || row.product_title || page?.title || asin).slice(0, 300)
  const brand = String(body.brand || row.brand_name || '') || null

  const [{ data: bp }, { data: vids }] = await Promise.all([
    admin.from('brand_profiles').select('*').eq('user_id', g.ownerId).maybeSingle(),
    admin.from('youtube_videos').select('title').eq('user_id', g.ownerId).order('published_at', { ascending: false, nullsFirst: false }).limit(12),
  ])
  const voice = [bp?.writing_sample, bp?.target_audience ? `Audience: ${bp.target_audience}` : ''].filter(Boolean).join('\n')
  const { system, user } = buildPlanPrompt({
    asin, product, brand, commissionPct: null,
    bullets: page?.bullets ?? [], description: page?.description ?? '', rating: page?.rating ?? null,
    voice: String(voice || ''), pastTitles: ((vids ?? []) as Array<{ title: string | null }>).map((v) => v.title || '').filter(Boolean),
    daysLeft: dates.daysLeft,
  })

  let plan: VideoPlan | null = null
  try {
    const msg = await createAnthropicClient().messages.create({ model: MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] })
    recordAnthropicUsage(msg, { userId: g.userId, tier: g.tier, feature: 'video_plan', model: MODEL })
    plan = parsePlan((msg.content[0] as { type: string; text?: string }).text || '', dates)
  } catch (e) {
    return NextResponse.json({ error: `The plan could not be written: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` }, { status: 502 })
  }
  if (!plan) return NextResponse.json({ error: 'The plan came back unusable. Try again.' }, { status: 502 })

  const { data: saved, error } = await admin.from('video_plans').insert({
    user_id: g.ownerId, asin, campaign_id: (typeof body.campaignId === 'string' && body.campaignId) || row.cc_campaign_id || null,
    brand, product, ends_at: endsAt, plan,
  }).select('id,asin,campaign_id,brand,product,ends_at,plan,created_at').single()
  if (error) {
    // The plan is still returned so the work is not lost; the page says it was
    // not saved.
    return NextResponse.json({ plan: { asin, brand, product, ends_at: endsAt, plan, made: null }, saved: false, error: missingTable(error.message) ? 'Migration 395 has not been run, so this plan was not saved.' : error.message })
  }
  return NextResponse.json({ plan: { ...saved, made: null }, saved: true, productPage: !!page })
}
