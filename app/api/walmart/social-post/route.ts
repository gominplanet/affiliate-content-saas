/**
 * POST /api/walmart/social-post — Walmart "Quick post to socials".
 *
 * Publish ONE Walmart offer straight to the link-friendly socials (X, Facebook,
 * Threads, LinkedIn, Telegram, Bluesky) with a thumbnail, a price-safe caption,
 * and the creator's minted+cloaked Walmart affiliate link. The Walmart twin of
 * /api/deal-radar/social-post.
 *
 * Body: { itemId, name, imageUrl?, url?, platforms: string[], caption? }
 * Gate: paid (canUseDealRadar), plus a connected PartnerBoost token (to mint).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { executeWalmartQuickPost } from '@/lib/walmart-quick-post'
import { getExternalKey } from '@/lib/external-keys'
import { toUserMessage } from '@/lib/friendly-error'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Deal Radar posting is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const pbToken = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!pbToken) {
      return NextResponse.json({ error: 'Connect your PartnerBoost API key in External Integrations to post Walmart deals.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as { itemId?: string; name?: string; imageUrl?: string; url?: string; platforms?: unknown; caption?: string }
    const itemId = (body.itemId || '').trim()
    const name = (body.name || '').trim()
    if (!itemId || !name) return NextResponse.json({ error: 'A Walmart item id and name are required.' }, { status: 400 })
    const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
      .map((p) => String(p)).filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    if (!platforms.length) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const out = await executeWalmartQuickPost({
      db: supabase, userId: user.id, tier, intRow: intRow ?? null, pbToken,
      itemId, name, imageUrl: body.imageUrl || null, fallbackUrl: body.url || null,
      platforms, caption: body.caption,
    })
    if (out.missingLink) return NextResponse.json({ error: 'Could not create a tracking link for that item.' }, { status: 502 })
    const anyOk = out.results.some((r) => r.ok)
    return NextResponse.json({ ok: anyOk, results: out.results, caption: out.caption, geniuslinkNote: out.geniuslinkNote }, { status: anyOk ? 200 : 502 })
  } catch (err) {
    console.error('[walmart/social-post]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't post just now. Please try again in a moment.") }, { status: 500 })
  }
}
