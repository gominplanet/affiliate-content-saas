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

    // Saved Outreach Profile (migration 155) — the creator's reusable template
    // pieces. These are USER-PROVIDED real facts (they typed them), so the draft
    // may use them verbatim; they are NOT "invented". They take priority over the
    // generic brand fields and drive the OINK-style multi-message structure.
    const op = (bp['outreach_profile'] && typeof bp['outreach_profile'] === 'object') ? (bp['outreach_profile'] as Record<string, unknown>) : {}
    const ops = (k: string) => { const v = op[k]; return typeof v === 'string' && v.trim() ? v.trim() : '' }
    const opCategories = Array.isArray(op['categories']) ? (op['categories'] as unknown[]).map(String).map(x => x.trim()).filter(Boolean) : []
    const opStorefront = ops('storefrontUrl')
    const opShipName = ops('shipName')
    const opShipAddress = ops('shipAddress')
    const opPhone = ops('phone')
    const opEmail = ops('email')
    const opSignoff = ops('signoff')

    const facts: string[] = []
    if (ops('greetingStyle')) facts.push(`Preferred greeting style (open with this): ${ops('greetingStyle')}`)
    if (ops('intro')) facts.push(`Who I am / credibility (TRUE — use it): ${ops('intro')}`)
    else if (creatorName) facts.push(`Creator/brand name: ${creatorName}`)
    if (ops('offer')) facts.push(`What I offer brands: ${ops('offer')}`)
    if (opCategories.length) facts.push(`Content categories I cover: ${opCategories.join(', ')}`)
    else if (niche) facts.push(`Niche: ${niche}`)
    if (mediaKit) facts.push(`Media kit: ${mediaKit}`)
    if (ops('linktree') || linkHub) facts.push(`Portfolio / work samples: ${ops('linktree') || linkHub}`)
    if (ops('youtube') || youtube) facts.push(`YouTube: ${ops('youtube') || youtube}`)
    if (ops('blog')) facts.push(`Blog: ${ops('blog')}`)
    if (opStorefront) facts.push(`My Amazon storefront: ${opStorefront}`)
    if (opEmail) facts.push(`My email: ${opEmail}`)
    if (opSignoff) facts.push(`Sign off as: ${opSignoff}`)

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
    // Sample shipping: prefer the per-message address, else the saved profile's.
    // When we have a real ship name/address, put them in their OWN message
    // (labelled NAME / ADDRESS) so the brand can copy them exactly (OINK style).
    const shipAddr = (o.address || '').trim() || opShipAddress
    const wantSample = o.requestSample || o.shareAddress
    if (wantSample && shipAddr) {
      asks.push(`Say to send the sample to the EXACT name + address below, and put them on their OWN line(s): ${opShipName ? `NAME: ${opShipName}. ` : ''}ADDRESS: ${shipAddr}.${opPhone ? ` TELEPHONE: ${opPhone}.` : ''}`)
    } else if (o.shareAddress) {
      asks.push('Say you are happy to share a shipping address for a sample.')
    }
    if (o.includeMediaKit && mediaKit) asks.push(`Include the media kit link: ${mediaKit}`)
    if (o.includePortfolio && (linkHub || youtube)) asks.push(`Include a portfolio link so they can see past work: ${[youtube, linkHub].filter(Boolean)[0]}`)
    if (o.mentionPastCollabs) asks.push('Briefly mention we have partnered with other brands successfully (do NOT invent specifics).')
    if (o.offerBannerAds) asks.push('Offer bonus homepage / banner-ad placement on our site.')
    if (o.offerLivestream) asks.push('Offer to feature the product in a livestream.')
    const extraNotes = (body.extraNotes || '').toString().trim().slice(0, 500)
    if (extraNotes) asks.push(`Also weave in: ${extraNotes}`)

    const system = `You draft a warm, professional brand-outreach a creator sends inside Amazon Creator Connections' "Message Brand" chat. Not an email: no subject line, no "Dear", no signature block.

CRITICAL — Amazon's chat sends a MESSAGE GROUP: several short messages in a row, NOT one block. Separate each message with a line containing EXACTLY:
---- Add to Message Group ----
Put that marker line ONLY between messages, never inside one. Produce 3–4 messages in this order (adapt to the facts; drop a message if you have nothing real for it):

Message 1 — "Hi <Brand> team," + who I am + quick credibility (ONLY from the creator facts given) + one clear offer of authentic content that drives their Creator Connections sales. Add my portfolio / media-kit / site link if given.
---- Add to Message Group ----
Message 2 — the specific ask: request a sample if that's selected; if a shipping address is given, say to send samples to the exact name + address shown below.
---- Add to Message Group ----
Message 3 — ONLY if a shipping name/address is given: the NAME and ADDRESS on their own, clearly labelled (e.g. "NAME: …" / "ADDRESS: …"), so the brand can copy them.
---- Add to Message Group ----
Message 4 — a warm one-line close + my name / email if given.

Rules:
- Each message ≤ 900 characters, plain text, first person, specific to THIS brand + product (reference the real product so it never reads as a template).
- NEVER invent credibility, follower counts, sales, or any claim beyond the facts given.
- No markdown, no bullet lists, no emojis unless natural.
${BANNED_RULE}
Output ONLY the message text (with the marker lines) — nothing else.`

    const userMsg = `Write the message.\n\n--- CREATOR (who is sending) ---\n${facts.join('\n') || '(minimal profile — keep credibility generic and honest)'}\n\n--- CAMPAIGN (who they're messaging) ---\n${campaign.join('\n')}\n\n--- INCLUDE THESE (weave in naturally, stay under 900 chars) ---\n${asks.length ? asks.map(a => `- ${a}`).join('\n') : '- A simple, warm offer to collaborate.'}`

    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1100, // a few short messages + the group markers
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
    // The draft is a MESSAGE GROUP separated by "---- Add to Message Group ----".
    // Amazon caps EACH message at 1000 chars, so enforce the cap PER SEGMENT
    // (word-boundary), not on the whole thing — a whole-text chop would truncate
    // mid-group and drop the address/close. Then rejoin with the marker.
    const MARK = '---- Add to Message Group ----'
    const capSeg = (seg: string): string => {
      const s = seg.trim()
      if (s.length <= 950) return s
      let cut = s.slice(0, 950)
      const lastSpace = cut.lastIndexOf(' ')
      if (lastSpace > 500) cut = cut.slice(0, lastSpace)
      return cut
    }
    text = text
      .split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i)
      .map(capSeg)
      .filter(Boolean)
      .join(`\n\n${MARK}\n\n`)
    if (!text) return NextResponse.json({ error: 'Draft came back empty — try again' }, { status: 502, headers: CORS })

    return NextResponse.json({ ok: true, message: text }, { headers: CORS })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS })
  }
}
