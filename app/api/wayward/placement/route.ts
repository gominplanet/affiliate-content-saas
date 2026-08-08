/**
 * Wayward "Post a placement" builder.
 *
 * Wayward has NO API to create a placement, so MVP does the hard part — asking
 * the right questions (mostly tick-boxes, informed by the creator's Brand
 * Profile) and composing copy-paste-ready copy for every field of Wayward's
 * "Post a placement" form: Basics → Title, Description → About this placement,
 * Expectations → Non-negotiables, plus the plain values (rate, end date,
 * retailers) the creator sets directly.
 *
 *   GET  → { ok, brand: {...} }   prefill hints from the Brand Profile
 *   POST → { ok, placement: {...} } composed, copy-paste-ready fields
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-sonnet-4-6'
const RETAILERS = ['Amazon', 'Walmart', 'DTC', 'Other']

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const { data: brand } = await supabase.from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (brand || {}) as any
  return NextResponse.json({
    ok: true,
    brand: {
      name: b.brand_name || b.name || null,
      niche: b.niche || null,
      audience: b.target_audience || null,
      voice: b.brand_voice || null,
      contentStyle: b.content_style || null,
      website: b.website_url || null,
      hasProfile: !!brand,
    },
  })
}

interface PlacementInput {
  contentTypes?: string[]
  audience?: string
  audienceSize?: string
  includePastPerformance?: boolean
  pastPerformanceNote?: string
  hooks?: string[]
  editorialAutonomy?: string
  performanceGuarantee?: string
  exclusivity?: string
  leadTime?: string
  pastExamplesUrl?: string
  rate?: number | string
  endsOn?: 'always' | 'date'
  endDate?: string
  retailers?: string[]
  notes?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const { data: brand } = await supabase.from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (brand || {}) as any

    const body = await request.json().catch(() => ({})) as PlacementInput
    const arr = (v: unknown, cap = 12) => Array.isArray(v) ? v.map(x => String(x).slice(0, 120)).slice(0, cap) : []
    const str = (v: unknown, cap = 800) => (v == null ? '' : String(v)).slice(0, cap)

    const contentTypes = arr(body.contentTypes)
    const hooks = arr(body.hooks)
    const audience = str(body.audience, 600)
    const audienceSize = str(body.audienceSize, 120)
    const includePastPerformance = !!body.includePastPerformance
    const pastPerformanceNote = str(body.pastPerformanceNote, 600)
    const editorialAutonomy = str(body.editorialAutonomy, 200)
    const performanceGuarantee = str(body.performanceGuarantee, 200)
    const exclusivity = str(body.exclusivity, 200)
    const leadTime = str(body.leadTime, 60)
    const pastExamplesUrl = str(body.pastExamplesUrl, 400)
    const notes = str(body.notes, 800)
    const rate = body.rate != null && body.rate !== '' ? Math.max(1, Math.round(Number(body.rate))) : null
    const retailers = (arr(body.retailers).filter(r => RETAILERS.includes(r)))
    const selectedRetailers = retailers.length ? retailers : ['Amazon']

    const brandBits = [
      b.brand_name || b.name ? `Creator/brand: ${b.brand_name || b.name}` : '',
      b.niche ? `Niche: ${b.niche}` : '',
      b.target_audience ? `Profile audience: ${b.target_audience}` : '',
      b.brand_voice ? `Voice: ${b.brand_voice}` : '',
      b.content_style ? `Content style: ${b.content_style}` : '',
      b.website_url ? `Site: ${b.website_url}` : '',
    ].filter(Boolean).join('\n')

    const answers = [
      contentTypes.length ? `Content type(s): ${contentTypes.join(', ')}` : '',
      audience ? `Audience for this placement: ${audience}` : '',
      audienceSize ? `Audience size/reach: ${audienceSize}` : '',
      includePastPerformance ? `Include past performance. ${pastPerformanceNote || '(no numbers given — speak to it generally, do NOT invent stats)'}` : 'Do NOT mention past performance.',
      hooks.length ? `The hook / what makes this compelling: ${hooks.join(', ')}` : '',
      editorialAutonomy ? `Editorial autonomy stance: ${editorialAutonomy}` : '',
      performanceGuarantee ? `Performance guarantees: ${performanceGuarantee}` : '',
      exclusivity ? `Exclusivity: ${exclusivity}` : '',
      leadTime ? `Lead time: ${leadTime}` : '',
      pastExamplesUrl ? `Links to past examples: ${pastExamplesUrl}` : '',
      notes ? `Extra notes: ${notes}` : '',
      `Supported retailers: ${selectedRetailers.join(', ')}`,
      rate ? `Creator's rate (USD per product inclusion): ${rate}` : 'No rate set — suggest one.',
    ].filter(Boolean).join('\n')

    const system =
      'You help a content creator post a "placement" on Wayward, a marketplace where brands pitch products for the creator to feature. ' +
      'A placement is a future article/post the creator opens up; matching brands pitch a product + short pitch; the creator picks which to accept, publishes, and is paid per accepted inclusion through Wayward. ' +
      'Write in the creator\'s own confident, specific, human voice — never generic, no corporate filler, no em-dashes. ' +
      'Only use facts given; never invent metrics. Return ONLY valid JSON, no prose.'

    const user_prompt =
      `Compose a Wayward placement listing from the creator's answers below.\n\n` +
      `CREATOR PROFILE:\n${brandBits || '(sparse — infer sensible defaults from the niche)'}\n\n` +
      `CREATOR'S ANSWERS:\n${answers}\n\n` +
      `Return JSON with exactly these fields:\n` +
      `- "title": a specific, scroll-stopping placement headline (<= 70 chars). Specific beats generic (e.g. "Skincare routine feature for 45k engaged beauty readers", not "Product feature"). Reflect the content type + audience.\n` +
      `- "description": 2-4 short plain-text paragraphs (blank line between them), covering, in a natural flow: the content type, the audience, past performance (only if the creator opted in), and the hook. No markdown headers, no bullet list here.\n` +
      `- "expectations": a plain-text list (one item per line, each starting with "• ") of non-negotiables drawn from the answers: editorial autonomy stance, performance guarantees (or explicit lack thereof), exclusivity terms, lead time, content format (mention past-example links if provided), and anything else a brand must agree to. Only include items the creator addressed.\n` +
      (rate
        ? `- "suggestedRate": ${rate} (echo the creator's rate).\n- "rateRationale": one plain sentence a creator could keep or delete, framing why this rate is fair for this audience + format.\n`
        : `- "suggestedRate": an integer USD amount per accepted product inclusion, sensible for this niche/audience/format.\n- "rateRationale": one plain sentence justifying it.\n`) +
      `Return ONLY the JSON object.`

    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 1800, system,
      messages: [{ role: 'user', content: user_prompt }],
    })
    try { recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'wayward_placement', model: MODEL }) } catch { /* best-effort */ }

    const text = msg.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: false, error: 'Could not draft the placement — try again.' }, { status: 502 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any
    try { parsed = JSON.parse(m[0]) } catch { return NextResponse.json({ ok: false, error: 'Draft parse failed — try again.' }, { status: 502 }) }

    return NextResponse.json({
      ok: true,
      placement: {
        title: String(parsed.title || '').slice(0, 120),
        description: String(parsed.description || '').slice(0, 4000),
        expectations: String(parsed.expectations || '').slice(0, 4000),
        suggestedRate: Number.isFinite(Number(parsed.suggestedRate)) ? Math.max(1, Math.round(Number(parsed.suggestedRate))) : rate,
        rateRationale: String(parsed.rateRationale || '').slice(0, 400),
        retailers: selectedRetailers,
        endsOn: body.endsOn === 'date' && body.endDate ? String(body.endDate).slice(0, 40) : 'Always open',
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
