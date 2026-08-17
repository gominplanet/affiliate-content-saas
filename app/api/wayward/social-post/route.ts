/**
 * POST /api/wayward/social-post — Wayward "Quick post to socials".
 *
 * Publish ONE Wayward product straight to the link-friendly socials (X, Facebook,
 * Threads, LinkedIn, Telegram, Bluesky) with a thumbnail, a price-safe caption,
 * and the creator's minted+cloaked Wayward attributed Amazon link.
 *
 * Body: { asin, name, imageUrl?, platforms: string[], caption? }
 * Gate: paid (canUseDealRadar) + a connected Wayward API key.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { executeWaywardQuickPost } from '@/lib/wayward-quick-post'
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
      return NextResponse.json({ error: 'Quick-posting is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const waywardToken = await getExternalKey(supabase, user.id, 'wayward')
    if (!waywardToken) {
      return NextResponse.json({ error: 'Connect your Wayward API key in External Integrations.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as { asin?: string; name?: string; imageUrl?: string; platforms?: unknown; caption?: string }
    const asin = (body.asin || '').trim()
    const name = (body.name || '').trim()
    if (!/^[A-Z0-9]{10}$/i.test(asin) || !name) return NextResponse.json({ error: 'A valid ASIN and product name are required.' }, { status: 400 })
    const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
      .map((p) => String(p)).filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    if (!platforms.length) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const out = await executeWaywardQuickPost({
      db: supabase, userId: user.id, tier, intRow: intRow ?? null, waywardToken,
      asin, name, imageUrl: body.imageUrl || null, platforms, caption: body.caption,
    })
    if (out.missingLink) return NextResponse.json({ error: 'Could not mint a Wayward link for that product.' }, { status: 502 })
    const anyOk = out.results.some((r) => r.ok)
    return NextResponse.json({ ok: anyOk, results: out.results, caption: out.caption, geniuslinkNote: out.geniuslinkNote }, { status: anyOk ? 200 : 502 })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 })
  }
}
