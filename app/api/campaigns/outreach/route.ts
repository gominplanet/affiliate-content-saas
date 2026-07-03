/**
 * POST /api/campaigns/outreach
 *
 * Bearer-token authed (the SCOUT extension calls this from amazon.com and has
 * no dashboard cookie — same auth as /api/campaigns/ingest). Given a Creator
 * Connections campaign's context (brand, product, brief), it drafts a warm,
 * personalized DIRECT MESSAGE the creator can review and send to the brand from
 * Amazon's own "Message Brand" chat. Chat-length (≤ ~900 chars for Amazon's 1000
 * cap), no email subject. Personalization is pulled from the creator's Brand
 * Profile (media kit, link hub, niche). Pro-tier only.
 *
 * Human-in-the-loop by design: this only DRAFTS. SCOUT places the text in the
 * box; the creator reviews and clicks Amazon's Send.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { tierAllowsCampaigns, normalizeTier, type Tier } from '@/lib/tier'

export const maxDuration = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function bearer(request: Request): string {
  const auth = request.headers.get('authorization') || ''
  return auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : (request.headers.get('x-cc-token') || '').trim()
}

interface OutreachOptions {
  offerContent?: boolean
  requestSample?: boolean
  shareAddress?: boolean
  address?: string
  includeMediaKit?: boolean
  includePortfolio?: boolean
  mentionPastCollabs?: boolean
  offerBannerAds?: boolean
  offerLivestream?: boolean
}

interface OutreachBody {
  brand?: string
  product?: string
  asin?: string
  commissionPct?: number
  brief?: string
  options?: OutreachOptions
  extraNotes?: string
}

export async function POST(request: Request) {
  try {
    // Dual auth: the SCOUT extension calls with a Bearer ingest token (no
    // cookie); the MVP dashboard's /epc list calls with its session cookie.
    const admin = createAdminClient()
    let userId: string | null = null
    let tier: Tier = 'trial'
    const token = bearer(request)
    if (token) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: intRow } = await admin
        .from('integrations')
        .select('user_id,tier')
        .eq('cc_ingest_token', token)
        .single()
      if (!intRow?.user_id) return NextResponse.json({ error: 'Invalid ingest token' }, { status: 401, headers: CORS })
      userId = intRow.user_id as string
      tier = normalizeTier((intRow as { tier?: string }).tier) as Tier
    } else {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: CORS })
      userId = user.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: intRow } = await admin.from('integrations').select('tier').eq('user_id', user.id).single()
      tier = normalizeTier((intRow as { tier?: string } | null)?.tier) as Tier
    }
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json({ error: 'Brand messaging is a Pro feature.' }, { status: 403, headers: CORS })
    }

    const body = await request.json().catch(() => ({})) as OutreachBody
    const brand = (body.brand || '').toString().trim()
    const product = (body.product || '').toString().trim()
    const asin = (body.asin || '').toString().trim().toUpperCase()
    const brief = (body.brief || '').toString().trim().slice(0, 3000)
    const commissionPct = typeof body.commissionPct === 'number' && isFinite(body.commissionPct) ? body.commissionPct : null
    if (!brand && !product) {
      return NextResponse.json({ error: 'Need a brand or product to draft a message' }, { status: 400, headers: CORS })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand_ } = await admin.from('brand_profiles').select('*').eq('user_id', userId).single()
    const bp = (brand_ || {}) as Record<string, unknown>
    const s = (k: string) => { const v = bp[k]; return typeof v === 'string' && v.trim() ? v.trim() : '' }
    const creatorName = s('brand_name') || s('creator_name') || s('display_name')
    const mediaKit = s('media_kit_url')
    const linkHub = s('linktree_url') || s('website_url')
    const youtube = s('youtube_url') || s('youtube_channel')
    const niche = s('niche') || (Array.isArray(bp['niches']) ? (bp['niches'] as unknown[]).map(String).slice(0, 3).join(', ') : '')

    const facts: string[] = []
    if (creatorName) facts.push(`Creator/brand name: ${creatorName}`)
    if (niche) facts.push(`Niche: ${niche}`)
    if (mediaKit) facts.push(`Media kit: ${mediaKit}`)
    if (linkHub) facts.push(`Link hub / site: ${linkHub}`)
    if (youtube) facts.push(`YouTube: ${youtube}`)

    const campaign: string[] = []
    if (brand) campaign.push(`Brand: ${brand}`)
    if (product) campaign.push(`Product / campaign: ${product}`)
    if (asin) campaign.push(`ASIN: ${asin}`)
    if (commissionPct != null) campaign.push(`Commission offered: ${commissionPct}%`)
    if (brief) campaign.push(`Campaign brief:\n${brief}`)

    // What the creator ticked in the compose modal — the specific asks/offers to
    // weave in (their proven levers for getting brand replies).
    const o = (body.options || {}) as OutreachOptions
    const asks: string[] = []
    if (o.offerContent !== false) asks.push('Offer to create authentic, honest content that drives their Creator Connections sales.')
    if (o.requestSample) asks.push('Politely request a free product sample to review firsthand.')
    if (o.shareAddress && (o.address || '').trim()) asks.push(`If a sample is offered, give this shipping/forwarding address: ${(o.address || '').trim()}`)
    else if (o.shareAddress) asks.push('Say you are happy to share a shipping address for a sample.')
    if (o.includeMediaKit && mediaKit) asks.push(`Include the media kit link: ${mediaKit}`)
    if (o.includePortfolio && (linkHub || youtube)) asks.push(`Include a portfolio link so they can see past work: ${[youtube, linkHub].filter(Boolean)[0]}`)
    if (o.mentionPastCollabs) asks.push('Briefly mention we have partnered with other brands successfully (do NOT invent specifics).')
    if (o.offerBannerAds) asks.push('Offer bonus homepage / banner-ad placement on our site.')
    if (o.offerLivestream) asks.push('Offer to feature the product in a livestream.')
    const extraNotes = (body.extraNotes || '').toString().trim().slice(0, 500)
    if (extraNotes) asks.push(`Also weave in: ${extraNotes}`)

    const system = `You draft short, warm, professional direct messages a creator sends to a brand inside Amazon Creator Connections' own "Message Brand" chat. This is a CHAT MESSAGE, not an email: no subject line, no "Dear", no signature block — just the message.

Rules:
- Hard limit: 900 characters. Shorter is better.
- First person, genuine, specific to THIS brand and product. Reference the actual product/campaign so it never reads as a template.
- Open warmly, establish quick credibility from the creator facts (only what's given — never invent follower counts, sales, or claims).
- Make ONE clear offer: authentic content that drives their Creator Connections sales.
- Include the creator's media-kit or link-hub URL if provided (one link is enough).
- End with a warm one-line sign-off using the creator's name if known.
- STRUCTURE with line breaks so it's easy to read in a chat: a warm greeting line, then a blank line, then 1–2 short body sentences, then a blank line, then the one-line sign-off. Amazon's message box keeps line breaks — use real newlines (\n), not one long paragraph.
- Plain text only. No markdown, no bullet lists, no emojis unless natural.
${BANNED_RULE}
Output ONLY the message text — nothing else.`

    const userMsg = `Write the message.\n\n--- CREATOR (who is sending) ---\n${facts.join('\n') || '(minimal profile — keep credibility generic and honest)'}\n\n--- CAMPAIGN (who they're messaging) ---\n${campaign.join('\n')}\n\n--- INCLUDE THESE (weave in naturally, stay under 900 chars) ---\n${asks.length ? asks.map(a => `- ${a}`).join('\n') : '- A simple, warm offer to collaborate.'}`

    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: userMsg }],
    })
    try {
      const u = usageFromAnthropic(msg)
      recordUsage({ userId, tier, feature: 'campaign_outreach', model: 'claude-sonnet-4-6', input: u.input, output: u.output })
    } catch { /* usage tracking is best-effort */ }

    let text = (msg.content as Array<{ type: string; text?: string }>)
      .map(b => (b.type === 'text' && typeof b.text === 'string') ? b.text : '')
      .join('')
      .trim()
    text = scrubBanned(text)
    // Enforce Amazon's 1000-char cap with headroom, breaking on a word boundary.
    if (text.length > 950) {
      text = text.slice(0, 950)
      const lastSpace = text.lastIndexOf(' ')
      if (lastSpace > 600) text = text.slice(0, lastSpace)
    }
    if (!text) return NextResponse.json({ error: 'Draft came back empty — try again' }, { status: 502, headers: CORS })

    return NextResponse.json({ ok: true, message: text }, { headers: CORS })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS })
  }
}
