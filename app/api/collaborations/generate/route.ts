/**
 * POST /api/collaborations/generate
 *
 * Pro-only. Researches the target brand, composes a tailored
 * collaboration pitch email, saves it to `collaborations`, returns it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { TIERS, billingWindow, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
import { generateCollabEmail, type CollabInput } from '@/lib/collab'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    // 2026-06-09 Phase 2 (VA): resource reads (integrations, brand,
    // collaborations) go through ownerId; collab cap + AI usage tracked
    // under user.id (caller).
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { user, ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: intRow }, { data: brand }] = await Promise.all([
      supabase.from('integrations').select('tier,subscription_period_start,subscription_period_end').eq('user_id', ownerId).single(),
      supabase.from('brand_profiles').select('*').eq('user_id', ownerId).single(),
    ])
    const tier = normalizeTier(intRow?.tier)
    // Tier restructure 2026-06-04: Collabs is Creator+ minimum per matrix
    // (Creator 5/mo, Studio 15/mo, Pro 100/mo). Was incorrectly gated to
    // publishAll (Pro-only), which both over-restricted Creator/Studio AND
    // short-circuited the per-tier collab cap enforcement below.
    if (TIERS[tier].collabsPerMonth === 0) {
      return NextResponse.json({
        error: 'Brand-collab pitch emails are a paid-tier feature. Upgrade to Creator+ to start landing deals.',
        currentTier: tier,
        code: 'tier_not_allowed',
      }, { status: 403 })
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
      const { count } = await supabase
        .from('collaborations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId)
        .gte('created_at', startISO)
      if ((count ?? 0) >= collabCap) {
        const next = nextTierFor(tier, 'collabsPerMonth')
        const nextHint = next
          ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} / month`}.`
          : ''
        return NextResponse.json({
          error: `You've reached your ${collabCap} collaboration emails for this billing period on the ${TIERS[tier].label} plan.${nextHint} Resets ${resetLabel}.`,
          limitReached: true,
          cap: 'collabs',
          currentTier: tier,
          upgrade: next ? { tier: next.tier, label: next.label, limit: next.limit } : null,
        }, { status: 429 })
      }
    }

    const body = await request.json().catch(() => ({})) as Partial<CollabInput>
    const brandName = (body.brandName ?? '').trim()
    if (!brandName) return NextResponse.json({ error: 'Brand name is required' }, { status: 400 })

    // If the creator typed an ASIN (or pasted an Amazon URL containing
    // one), look the product up so the email can reference it by name,
    // price, and 1–2 actual features. Scrape failures are non-fatal —
    // we just fall back to the raw string the user typed.
    const productOrAsinRaw = body.productOrAsin?.toString().trim() || ''
    const asin = productOrAsinRaw ? extractAsin(productOrAsinRaw.toUpperCase()) : null
    let productData: CollabInput['productData'] = null
    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        if (p.title) {
          productData = {
            asin: p.asin,
            title: p.title,
            bullets: p.bullets,
            price: p.price,
            rating: p.rating,
          }
        }
      } catch (e) {
        console.warn('[collab] amazon lookup failed for', asin, e instanceof Error ? e.message : e)
      }
    }

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
      productOrAsin: productOrAsinRaw,
      productData,
      // Fall back to the Brand Profile's linktree_url so the email always
      // includes the creator's link hub when they've set one — even if
      // they didn't re-type it into the collab form.
      portfolioUrl: body.portfolioUrl?.toString().trim()
        || ((brand as Record<string, unknown> | null)?.linktree_url as string | undefined)?.trim()
        || '',
      // Media kit URL — form override wins; falls back to the saved
      // brand_profiles.media_kit_url so the email always includes it
      // when the user has set one. Migration 102.
      mediaKitUrl: body.mediaKitUrl?.toString().trim()
        || ((brand as Record<string, unknown> | null)?.media_kit_url as string | undefined)?.trim()
        || '',
      collabsDone: body.collabsDone?.toString().trim() || '',
      exampleLinks: Array.isArray(body.exampleLinks)
        ? body.exampleLinks.map(s => String(s).trim()).filter(Boolean).slice(0, 3)
        : [],
      extraNotes: body.extraNotes?.toString().trim() || '',
      // Extra reach-out channels for the email's contact block. Empty
      // strings get filtered out inside generateCollabEmail (it skips
      // the line entirely when the value is blank), so .trim() suffices.
      whatsapp: body.whatsapp?.toString().trim() || '',
      wechat:   body.wechat?.toString().trim()   || '',
      lark:     body.lark?.toString().trim()     || '',
    }

    const { subject, body: emailBody, email, citations } = await generateCollabEmail(input, brand, { userId: user.id, tier })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await supabase
      .from('collaborations')
      .insert({
        user_id: ownerId,
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
