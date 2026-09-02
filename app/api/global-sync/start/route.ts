// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/start — Milestone 1.
// Creates a Global Storefront Sync job for one master video and the markets the
// creator picked, then localizes the title + description per market in the
// background. Milestone 2 adds captions + dub; Milestone 3 delivers via SCOUT.
//   body: { videoId, markets: string[] (domains), asin? }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { MARKETS, marketByDomain, localizeMetadata } from '@/lib/global-sync'
import { buildProductThumbnail } from '@/lib/product-thumbnail'

export const runtime = 'nodejs'
export const maxDuration = 300

// Extract a bare ASIN from a product URL or a raw ASIN string.
function asinFrom(v: string | null | undefined): string | null {
  const s = (v || '').trim()
  if (!s) return null
  if (/^[A-Z0-9]{10}$/.test(s)) return s
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  // Heavy, cross-market feature: Pro (and admin) only, like Clip Factory.
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Global Storefront Sync is a Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
  }
  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  const body = await req.json().catch(() => ({})) as { videoId?: string; markets?: string[]; asin?: string; marketAsins?: Record<string, string> }
  const videoId = (body.videoId || '').trim()
  // Optional per-market ASIN overrides (Video Launchpad's local-ASIN resolution):
  // a product relisted abroad under a different code is delivered against THAT
  // code in that marketplace. Normalized; anything invalid falls back to the base.
  const marketAsins: Record<string, string> = {}
  if (body.marketAsins && typeof body.marketAsins === 'object') {
    for (const [dom, a] of Object.entries(body.marketAsins)) {
      const na = asinFrom(typeof a === 'string' ? a : '')
      if (na && marketByDomain(dom)) marketAsins[dom] = na
    }
  }
  const domains = Array.isArray(body.markets) ? body.markets.filter(d => !!marketByDomain(d)) : []
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })
  if (domains.length === 0) return NextResponse.json({ error: 'Pick at least one marketplace.' }, { status: 400 })

  // Master video + the creator's voice.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,title,generated_title,description,generated_description,transcript,product_url,channel_id')
    .eq('id', videoId).eq('user_id', user.id).maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const asin = asinFrom(body.asin) || asinFrom(video.product_url as string | null)
  const masterTitle = ((video.generated_title as string) || (video.title as string) || '').trim()
  const masterDesc = ((video.generated_description as string) || (video.description as string) || '').trim()

  const { data: brand } = await sb
    .from('brand_profiles').select('learn_profile,voice_fingerprint,channel_voice_fingerprints').eq('user_id', user.id).maybeSingle()

  // Create the job + one pending target per market.
  const { data: job } = await sb
    .from('global_sync_jobs')
    .insert({ user_id: user.id, video_id: videoId, asin, status: 'localizing' })
    .select('id').single()
  if (!job) return NextResponse.json({ error: 'Could not start the sync.' }, { status: 500 })

  const targetRows = domains.map(domain => {
    const mkt = marketByDomain(domain)!
    // Per-market ASIN when the product is listed under a different local code,
    // else the base ASIN (validated per host at delivery time regardless).
    return { job_id: job.id, user_id: user.id, domain, lang: mkt.lang, dub: mkt.needsTranslation, asin: marketAsins[domain] || asin, state: 'pending' as const }
  })
  await sb.from('global_sync_targets').insert(targetRows)

  // Fire-and-forget: localize each market's metadata, then mark the job done.
  // (Milestone 2 will also produce captions + dub here.)
  // Non-English storefronts get a text-free thumbnail (the branded one bakes an
  // English hook into the image, which reads wrong to a French/German shopper).
  // Generate that clean variant once per video, only when this sync actually
  // includes a non-English market and we haven't already cached one. Cheap: it's
  // one extra image, cached on the video for every future sync.
  const needsClean = domains.some(d => marketByDomain(d)?.needsTranslation)

  void (async () => {
    try {
      for (const domain of domains) {
        const mkt = marketByDomain(domain)!
        const meta = await localizeMetadata(
          { title: masterTitle, description: masterDesc }, mkt,
          brand as { learn_profile?: unknown; voice_fingerprint?: string | null; channel_voice_fingerprints?: unknown },
          { userId: user.id, tier },
        )
        await sb.from('global_sync_targets')
          .update({ title: meta.title, description: meta.description, state: 'localized', updated_at: new Date().toISOString() })
          .eq('job_id', job.id).eq('domain', domain)
      }
      if (needsClean && asin) {
        // Read the cached clean thumbnail defensively: the column is added by
        // migration 306, so tolerate its absence (older DB) — a failure here
        // just means we regenerate, and the deliver queue falls back to the
        // text thumbnail either way.
        let hasClean = false
        try {
          const { data: v } = await sb.from('youtube_videos').select('thumbnail_clean_url').eq('id', videoId).maybeSingle()
          hasClean = !!(v?.thumbnail_clean_url)
        } catch { /* column not present yet */ }
        if (!hasClean) {
          try {
            const clean = await buildProductThumbnail(sb, { userId: user.id, tier, title: masterTitle, asin, withText: false })
            if (clean) await sb.from('youtube_videos').update({ thumbnail_clean_url: clean }).eq('id', videoId)
          } catch { /* non-fatal: non-English markets fall back to the text thumbnail */ }
        }
      }
      await sb.from('global_sync_jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id)
    } catch {
      await sb.from('global_sync_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id)
    }
  })()

  return NextResponse.json({ ok: true, jobId: job.id, markets: domains.length })
}
