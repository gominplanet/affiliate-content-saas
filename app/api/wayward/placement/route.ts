/**
 * POST /api/wayward/placement — draft a Wayward "Post a placement" sponsorship
 * offer from the creator's Brand Profile (+ optional hints). Wayward has no API
 * to CREATE a placement, so this returns copy-paste-ready fields matching their
 * form: Title, Description, Expectations, a suggested base price + rationale, and
 * recommended retailers.
 *
 * Body: { contentType?, audience?, targetRate?, notes? }
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
    if (!brand) return NextResponse.json({ ok: false, error: 'Set up your Brand Profile first (Set up → Brand Profile).' }, { status: 400 })

    const body = await request.json().catch(() => ({})) as { contentType?: string; audience?: string; targetRate?: number | string; notes?: string }
    const contentType = (body.contentType || '').toString().slice(0, 200)
    const audience = (body.audience || '').toString().slice(0, 600)
    const notes = (body.notes || '').toString().slice(0, 800)
    const targetRate = body.targetRate != null && body.targetRate !== '' ? Number(body.targetRate) : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = brand as any
    const brandBits = [
      b.brand_name ? `Creator/brand: ${b.brand_name}` : '',
      b.niche ? `Niche: ${b.niche}` : '',
      b.target_audience ? `Audience: ${b.target_audience}` : '',
      b.brand_voice ? `Voice: ${b.brand_voice}` : '',
      b.content_style ? `Content style: ${b.content_style}` : '',
      b.website_url ? `Site: ${b.website_url}` : '',
    ].filter(Boolean).join('\n')

    const system =
      'You help a content creator write a compelling "placement" listing on Wayward, a marketplace where brands pitch products for the creator to feature. ' +
      'Write in the creator\'s own confident, specific voice — never generic. Return ONLY valid JSON, no prose.'

    const user_prompt =
      `Draft a Wayward placement offer for this creator.\n\nCREATOR PROFILE:\n${brandBits || '(sparse — infer sensible defaults from the niche)'}\n\n` +
      (contentType ? `CONTENT TYPE FOR THIS PLACEMENT: ${contentType}\n` : '') +
      (audience ? `AUDIENCE NOTES: ${audience}\n` : '') +
      (notes ? `EXTRA NOTES: ${notes}\n` : '') +
      (targetRate ? `TARGET RATE (USD per product inclusion): ${targetRate}\n` : '') +
      `\nReturn JSON with these fields:\n` +
      `- "title": a specific, scroll-stopping placement headline (≤ 70 chars). Specific beats generic (e.g. "Skincare routine feature — 45k engaged beauty audience", not "Product feature").\n` +
      `- "description": 2–4 short paragraphs (plain text, blank line between paragraphs) covering: content type, the audience, past performance if implied by the profile, and the hook (what makes this placement compelling). No markdown headers.\n` +
      `- "expectations": a plain-text bulleted list (use "• " prefixes) of non-negotiables: editorial autonomy stance, performance guarantees (or explicit lack thereof), exclusivity terms, lead time, content format, and anything a brand must agree to upfront.\n` +
      `- "suggestedRate": an integer USD amount per accepted product inclusion${targetRate ? ' (anchor near the target rate but sanity-check it)' : ''}.\n` +
      `- "rateRationale": one sentence justifying the rate.\n` +
      `- "retailers": an array from ["Amazon","Walmart","DTC","Other"] the creator most plausibly supports (default ["Amazon"]).\n\n` +
      `Return ONLY the JSON object.`

    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 1500, system,
      messages: [{ role: 'user', content: user_prompt }],
    })
    try { recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'wayward_placement', model: MODEL }) } catch { /* best-effort */ }

    const text = msg.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ ok: false, error: 'Could not draft the placement — try again.' }, { status: 502 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any
    try { parsed = JSON.parse(m[0]) } catch { return NextResponse.json({ ok: false, error: 'Draft parse failed — try again.' }, { status: 502 }) }

    const RETAILERS = ['Amazon', 'Walmart', 'DTC', 'Other']
    return NextResponse.json({
      ok: true,
      placement: {
        title: String(parsed.title || '').slice(0, 120),
        description: String(parsed.description || '').slice(0, 4000),
        expectations: String(parsed.expectations || '').slice(0, 4000),
        suggestedRate: Number.isFinite(Number(parsed.suggestedRate)) ? Math.max(1, Math.round(Number(parsed.suggestedRate))) : null,
        rateRationale: String(parsed.rateRationale || '').slice(0, 400),
        retailers: Array.isArray(parsed.retailers) ? parsed.retailers.filter((r: unknown) => RETAILERS.includes(String(r))) : ['Amazon'],
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
