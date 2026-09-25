// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/live/plan { title, minutes, asins[], notes? } — build and save an
// Amazon Live plan (lib/live-plan). LABS preview (admin while testing).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { creatorVoiceBlock, CREATOR_VOICE_COLUMNS } from '@/lib/creator-voice'
import { fetchAmazonProduct } from '@/services/amazon'
import { coveredProducts, findSales, saleLabel } from '@/lib/covered-sales'
import { assemblePlan, buildLivePrompt, LIVE_MAX_PRODUCTS, type LiveProductInput } from '@/lib/live-plan'

export const runtime = 'nodejs'
export const maxDuration = 120

const MODEL = 'claude-sonnet-4-6'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  if (!canUsePreview('amazon_live', tier)) {
    return NextResponse.json({ error: 'Amazon Live prep is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const blocked = await spendGate(user.id, tier)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({})) as { title?: string; minutes?: number; asins?: string[]; notes?: string; titles?: Record<string, string> }
  const asins = [...new Set((body.asins ?? []).map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  if (asins.length === 0) return NextResponse.json({ error: 'Pick at least one product for the show.' }, { status: 400 })
  if (asins.length > LIVE_MAX_PRODUCTS) {
    return NextResponse.json({ error: `A show holds ${LIVE_MAX_PRODUCTS} products at most, so each one gets real time. Pick fewer.` }, { status: 400 })
  }
  const minutes = Math.max(10, Math.min(180, Math.round(Number(body.minutes) || 45)))
  // TWO MINUTES A PRODUCT AT LEAST, plus the opening and close, or the show
  // either overruns what was asked or gives each product seconds.
  if (minutes < asins.length * 2 + 4) {
    return NextResponse.json({ error: `${asins.length} products need a show of at least ${asins.length * 2 + 4} minutes. Pick a longer show or fewer products.` }, { status: 400 })
  }
  const title = String(body.title || '').trim().slice(0, 120) || 'Amazon Live'
  const notes = String(body.notes || '').trim().slice(0, 600)

  const admin = createAdminClient()
  const covered = new Map((await coveredProducts(admin, user.id)).map((p) => [p.asin, p]))
  const sales = new Map((await findSales(admin, asins.map((a) => covered.get(a) ?? { asin: a, title: a, image: null, sources: [] }))).map((s) => [s.asin, s]))

  // THE CREATOR'S OWN WORDS, per product, from their most-watched video on it.
  const leadVideo = new Map<string, { id: string; title: string }>()
  for (const a of asins) {
    const v = (covered.get(a)?.sources ?? []).filter((s) => s.kind === 'video').sort((x, y) => (y.views ?? 0) - (x.views ?? 0))[0]
    if (v?.id) leadVideo.set(a, { id: v.id, title: v.title || '' })
  }
  const transcripts = new Map<string, string>()
  if (leadVideo.size) {
    const { data: rows } = await admin.from('youtube_videos').select('id,transcript').in('id', [...leadVideo.values()].map((v) => v.id))
    const byId = new Map(((rows ?? []) as Array<{ id: string; transcript: string | null }>).map((r) => [r.id, r.transcript || '']))
    for (const [a, v] of leadVideo) transcripts.set(a, String(byId.get(v.id) || ''))
  }

  // THE LISTINGS, ALL AT ONCE, AGAINST ONE CLOCK. A product page read can
  // retry for most of a minute, and three rounds of those left no time for
  // the writer. Whatever has not answered in 25 seconds goes without its
  // listing: the creator's own words and the title still carry it.
  const listing = new Map<string, { title: string; bullets: string[]; image: string | null }>()
  await Promise.race([
    Promise.all(asins.map(async (a) => {
      try {
        const p = await fetchAmazonProduct(a)
        listing.set(a, { title: p.title || '', bullets: (p.bullets ?? []).slice(0, 6), image: p.imageUrl || null })
      } catch { /* the creator's words carry it */ }
    })),
    new Promise((res) => setTimeout(res, 25_000)),
  ])

  const products: LiveProductInput[] = asins.map((a) => {
    const c = covered.get(a)
    const l = listing.get(a)
    const s = sales.get(a)
    const named = [c?.title, body.titles?.[a], l?.title].find((t) => t && t !== a) || a
    return {
      asin: a,
      title: String(named).slice(0, 200),
      image: c?.image || l?.image || s?.image || null,
      bullets: l?.bullets ?? [],
      transcript: (transcripts.get(a) || '').slice(0, 1400),
      videoTitle: leadVideo.get(a)?.title || null,
      saleLabel: s ? saleLabel(s.verdict) : null,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (admin as any).from('brand_profiles')
    .select(`name,author_name,tone,target_audience,writing_sample,${CREATOR_VOICE_COLUMNS}`)
    .eq('user_id', user.id).maybeSingle()
  const voice = creatorVoiceBlock(brand as never)

  let model: unknown = null
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 6000,
      messages: [{ role: 'user', content: buildLivePrompt({ title, minutes, products, voice, notes }) }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'amazon_live_plan', model: MODEL })
    // CUT OFF IS NOT A PLAN. A reply that ran out of room parses as a partial
    // plan with blank products, which would look like a finished one.
    if (msg.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'The show was too long to write in one go. Try fewer products.' }, { status: 502 })
    }
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (m) model = JSON.parse(m[0])
  } catch (e) {
    return NextResponse.json({ error: `The plan could not be written: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }, { status: 502 })
  }
  if (!model) return NextResponse.json({ error: 'The writer did not return a plan. Try again.' }, { status: 502 })

  const plan = assemblePlan({ title, minutes, products, model })

  // SAVED so it can be opened on the day. A database without migration 373
  // still gets the plan, and is told it was not kept.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved, error: saveErr } = await (supabase as any).from('live_plans').insert({
    user_id: user.id, title: plan.title, minutes: plan.minutes, products: asins, plan,
  }).select('id').single()
  return NextResponse.json({
    ok: true, plan, id: saved?.id ?? null,
    saved: !saveErr,
    saveError: saveErr ? (/live_plans/.test(saveErr.message) ? 'Not saved: saving plans needs migration 373 in the database first.' : saveErr.message) : null,
  })
}
