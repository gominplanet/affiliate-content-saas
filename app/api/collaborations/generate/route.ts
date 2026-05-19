/**
 * POST /api/collaborations/generate
 *
 * Pro-only. Researches the target brand, composes a tailored
 * collaboration pitch email, saves it to `collaborations`, returns it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsPublishAll, TIERS, billingWindow, type Tier } from '@/lib/tier'
import { generateCollabEmail, type CollabInput } from '@/lib/collab'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: intRow }, { data: brand }] = await Promise.all([
      (supabase as any).from('integrations').select('tier,subscription_period_start,subscription_period_end').eq('user_id', user.id).single(),
      (supabase as any).from('brand_profiles').select('*').eq('user_id', user.id).single(),
    ])
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsPublishAll(tier)) {
      return NextResponse.json({ error: 'Collaborations is a Pro plan feature.' }, { status: 403 })
    }

    // Per-BILLING-PERIOD cap from the single source of truth
    // (lib/tier.ts). null = unlimited (admin). Window honors the user's
    // actual Stripe billing cycle when present, falls back to calendar
    // month otherwise — same logic the dashboard's usage card uses.
    const collabCap = TIERS[tier].collabsPerMonth
    if (collabCap !== null) {
      const { startISO, resetLabel } = billingWindow({
        periodStart: (intRow as Record<string, unknown> | null)?.subscription_period_start as string | null,
        periodEnd: (intRow as Record<string, unknown> | null)?.subscription_period_end as string | null,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any)
        .from('collaborations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startISO)
      if ((count ?? 0) >= collabCap) {
        return NextResponse.json({
          error: `You've reached your ${collabCap} collaboration emails for this billing period on the ${TIERS[tier].label} plan. Resets ${resetLabel}.`,
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
