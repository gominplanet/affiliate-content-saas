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

  const body = await req.json().catch(() => ({})) as { videoId?: string; markets?: string[]; asin?: string }
  const videoId = (body.videoId || '').trim()
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
    return { job_id: job.id, user_id: user.id, domain, lang: mkt.lang, dub: mkt.needsTranslation, asin, state: 'pending' as const }
  })
  await sb.from('global_sync_targets').insert(targetRows)

  // Fire-and-forget: localize each market's metadata, then mark the job done.
  // (Milestone 2 will also produce captions + dub here.)
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
      await sb.from('global_sync_jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id)
    } catch {
      await sb.from('global_sync_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id)
    }
  })()

  return NextResponse.json({ ok: true, jobId: job.id, markets: domains.length })
}
