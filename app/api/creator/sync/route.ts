// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/creator/sync — start a Brand Radar ingestion (LABS). Amazon storefront
// runs ASYNC through Apify (a webhook finishes it at /api/creator/sync/callback);
// TikTok runs synchronously through SocialCrawl and returns its brand aggregation
// right away. Both write a creator_sync_jobs row so the UI can show status/history.
// GET returns recent jobs + which providers are configured.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'
import {
  providerFor, apifyConfigured, socialcrawlConfigured, startApifyRun,
  fetchTikTokPosts, extractTikTokBrands, type SyncSource,
} from '@/lib/creator-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APIFY_AMAZON_ACTOR = (process.env.APIFY_AMAZON_ACTOR || 'powerai~amazon-influencer-posts-scraper').trim()

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: jobs } = await sb
    .from('creator_sync_jobs')
    .select('id,source,provider,handle,status,item_count,result,error,created_at,finished_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
  return NextResponse.json({
    ok: true,
    providers: { apify: apifyConfigured(), socialcrawl: socialcrawlConfigured() },
    jobs: jobs ?? [],
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canSeeNav('labs', normalizeTier(intRow?.tier))) {
    return NextResponse.json({ error: 'Brand Radar is a Pro feature.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { source?: string; handle?: string }
  const source = (body.source === 'tiktok' ? 'tiktok' : 'amazon_storefront') as SyncSource
  const handle = (body.handle || '').trim()

  const { provider, configured } = providerFor(source)
  if (!configured) {
    return NextResponse.json({ error: `Connect ${provider === 'apify' ? 'Apify' : 'SocialCrawl'} first to run this sync.`, needsProvider: provider }, { status: 400 })
  }

  const admin = createAdminClient()
  // Create the job row up front so the UI has something to show immediately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: job } = await (admin as any).from('creator_sync_jobs')
    .insert({ user_id: user.id, source, provider, handle: handle || null, status: 'running' })
    .select('id').single()
  const jobId = job?.id as string
  if (!jobId) return NextResponse.json({ error: 'Could not start the sync.' }, { status: 500 })

  try {
    if (source === 'amazon_storefront') {
      // Apify async: start the run with a webhook back to /callback. Actor input
      // takes the storefront handle (…/shop/<handle>). Kept minimal + overridable.
      const influencer = handle.replace(/^.*\/shop\//i, '').replace(/[#?].*$/, '').trim() || handle
      const run = await startApifyRun(APIFY_AMAZON_ACTOR, { influencer_name: influencer, scope: 'ALL' }, { jobId })
      if (!run) throw new Error('provider-start-failed')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('creator_sync_jobs').update({ external_run_id: run.runId, external_dataset_id: run.datasetId }).eq('id', jobId)
      return NextResponse.json({ ok: true, jobId, status: 'running', async: true })
    }

    // TikTok via SocialCrawl — synchronous. Fetch posts, aggregate brand signals,
    // store the summary on the job. (Enrichment/LLM caption pass can come later.)
    const posts = await fetchTikTokPosts(handle)
    const signals = extractTikTokBrands(posts)
    const agg = new Map<string, { brand: string; tagged: number; mention: number; hashtag: number; sample: string | null }>()
    for (const s of signals) {
      const k = s.brand.toLowerCase()
      const cur = agg.get(k) || { brand: s.brand, tagged: 0, mention: 0, hashtag: 0, sample: null }
      cur[s.kind] += 1
      if (!cur.sample && s.sample) cur.sample = s.sample
      agg.set(k, cur)
    }
    const brands = [...agg.values()]
      .map((b) => ({ ...b, total: b.tagged + b.mention + b.hashtag, confident: b.tagged > 0 }))
      .sort((a, b) => Number(b.confident) - Number(a.confident) || b.total - a.total)
      .slice(0, 200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('creator_sync_jobs')
      .update({ status: 'succeeded', item_count: posts.length, result: { brands, postsScanned: posts.length }, finished_at: new Date().toISOString() })
      .eq('id', jobId)
    return NextResponse.json({ ok: true, jobId, status: 'succeeded', async: false, postsScanned: posts.length, brands })
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('creator_sync_jobs').update({ status: 'failed', error: e instanceof Error ? e.message : 'error', finished_at: new Date().toISOString() }).eq('id', jobId)
    return NextResponse.json({ error: 'Sync failed to start. Try again.' }, { status: 500 })
  }
}
