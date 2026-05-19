/**
 * POST /api/collaborations/generate
 *
 * Pro-only. Researches the target brand, composes a tailored
 * collaboration pitch email, saves it to `collaborations`, returns it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsPublishAll, type Tier } from '@/lib/tier'
import { generateCollabEmail, type CollabInput } from '@/lib/collab'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: intRow }, { data: brand }] = await Promise.all([
      (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single(),
      (supabase as any).from('brand_profiles').select('*').eq('user_id', user.id).single(),
    ])
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsPublishAll(tier)) {
      return NextResponse.json({ error: 'Collaborations is a Pro plan feature.' }, { status: 403 })
    }

    // Monthly cap — collab generation is the most expensive per-action
    // feature (Sonnet + web search). Generous enough that real outreach
    // never hits it; stops runaway/abuse. Admins are unlimited.
    const COLLAB_MONTHLY_CAP = 100
    if (tier !== 'admin') {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any)
        .from('collaborations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', monthStart)
      if ((count ?? 0) >= COLLAB_MONTHLY_CAP) {
        const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
          .toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        return NextResponse.json({
          error: `You've reached your ${COLLAB_MONTHLY_CAP} collaboration emails this month on the Pro plan. Resets ${resets}.`,
        }, { status: 429 })
      }
    }

    const body = await request.json().catch(() => ({})) as Partial<CollabInput>
    const brandName = (body.brandName ?? '').trim()
    if (!brandName) return NextResponse.json({ error: 'Brand name is required' }, { status: 400 })

    const input: CollabInput = {
      brandName,
      amazonStorefront: body.amazonStorefront?.toString().trim() || '',
      websiteUrl: body.websiteUrl?.toString().trim() || '',
      youtubeUrl: body.youtubeUrl?.toString().trim() || '',
      platforms: Array.isArray(body.platforms) ? body.platforms.filter(Boolean) : [],
      bannerAds: !!body.bannerAds,
      bannerAdsAmount: body.bannerAdsAmount?.toString().trim() || '',
      freeSample: !!body.freeSample,
      productionFee: !!body.productionFee,
      productionFeeAmount: body.productionFeeAmount?.toString().trim() || '',
      shareAddress: !!body.shareAddress,
      livestreams: !!body.livestreams,
      livestreamLink: body.livestreamLink?.toString().trim() || '',
      productOrAsin: body.productOrAsin?.toString().trim() || '',
      portfolioUrl: body.portfolioUrl?.toString().trim() || '',
      collabsDone: body.collabsDone?.toString().trim() || '',
      exampleLinks: Array.isArray(body.exampleLinks)
        ? body.exampleLinks.map(s => String(s).trim()).filter(Boolean).slice(0, 3)
        : [],
      extraNotes: body.extraNotes?.toString().trim() || '',
    }

    const { subject, body: emailBody, email, citations } = await generateCollabEmail(input, brand, { userId: user.id, tier })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('collaborations')
      .insert({
        user_id: user.id,
        brand_name: input.brandName,
        amazon_storefront: input.amazonStorefront || null,
        website_url: input.websiteUrl || null,
        youtube_url: input.youtubeUrl || null,
        platforms: input.platforms,
        banner_ads: input.bannerAds,
        banner_ads_amount: input.bannerAdsAmount || null,
        free_sample: input.freeSample,
        production_fee: input.productionFee,
        production_fee_amount: input.productionFeeAmount || null,
        share_address: input.shareAddress,
        product_or_asin: input.productOrAsin || null,
        portfolio_url: input.portfolioUrl || null,
        example_links: input.exampleLinks ?? [],
        collabs_done: input.collabsDone || null,
        extra_notes: input.extraNotes || null,
        generated_email: email,
      })
      .select('id')
      .single()

    return NextResponse.json({ ok: true, id: row?.id ?? null, subject, body: emailBody, email, citations })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
