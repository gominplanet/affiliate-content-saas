/**
 * Collaboration pitch generator (Pro). Researches the target brand on
 * the web, then composes a compelling outreach email selling the
 * creator's work, using their form answers + brand profile.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'

export interface CollabInput {
  brandName: string
  amazonStorefront?: string
  websiteUrl?: string
  youtubeUrl?: string
  platforms: string[]
  bannerAds: boolean
  bannerAdsAmount?: string
  freeSample: boolean
  productionFee: boolean
  productionFeeAmount?: string
  shareAddress: boolean
  productOrAsin?: string
  portfolioUrl?: string
  collabsDone?: string
  exampleLinks?: string[]
  extraNotes?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Brand = any

export interface CollabResult { subject: string; body: string; email: string; citations: string[] }

export async function generateCollabEmail(
  input: CollabInput,
  brand: Brand,
  ctx: { userId?: string | null; tier?: string | null },
): Promise<CollabResult> {
  const client = createAnthropicClient()

  // ── 1. Research the brand (best-effort) ───────────────────────────────
  let brief = ''
  const citations = new Set<string>()
  try {
    const rmsg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 } as any],
      messages: [{
        role: 'user',
        content: `Research the brand "${input.brandName}"${input.websiteUrl ? ` (site: ${input.websiteUrl})` : ''} for a creator who wants to pitch a paid/affiliate collaboration.

Find, concisely: what they sell + flagship products, who their customers are, their brand tone/positioning, and whether they run creator/affiliate/influencer programs or have done creator campaigns. If you can't find solid info, say "limited public info".

Return a tight markdown brief under 250 words. No fluff.`,
      }],
    })
    {
      const u = usageFromAnthropic(rmsg)
      recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'collab_research', model: 'claude-sonnet-4-6', input: u.input, output: u.output, webSearches: u.webSearches })
    }
    for (const b of rmsg.content) {
      if (b.type === 'text') brief += b.text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ab = b as any
      if (ab.type === 'web_search_tool_result' && Array.isArray(ab.content)) {
        for (const r of ab.content) if (r?.url) citations.add(r.url)
      }
    }
    brief = brief.trim()
  } catch {
    brief = ''
  }

  // ── 2. Compose the outreach email ─────────────────────────────────────
  const offered = input.platforms.length ? input.platforms.join(', ') : 'my channels'
  const asks: string[] = []
  if (input.freeSample) asks.push('a free product sample in exchange for a genuine, in-depth review')
  if (input.bannerAds) asks.push(`a paid banner ad placement on the blog${input.bannerAdsAmount ? ` at ${input.bannerAdsAmount}` : ''}`)
  if (input.productionFee) asks.push(`a production fee${input.productionFeeAmount ? ` of ${input.productionFeeAmount}` : ''} for producing the review content`)

  const exampleLinks = (input.exampleLinks || []).map(s => s.trim()).filter(Boolean).slice(0, 3)
  const profile = [
    brand?.author_name ? `Creator name: ${brand.author_name}` : '',
    brand?.name ? `Brand/site: ${brand.name}` : '',
    brand?.author_bio ? `Bio: ${brand.author_bio}` : '',
    brand?.niches?.length ? `Niches: ${(brand.niches as string[]).join(', ')}` : '',
    brand?.tone?.length ? `Voice: ${(brand.tone as string[]).join(', ')}` : '',
    input.websiteUrl || brand?.website_url ? `Blog: ${input.websiteUrl || brand.website_url}` : '',
    input.youtubeUrl || brand?.youtube_channel_url ? `YouTube: ${input.youtubeUrl || brand.youtube_channel_url}` : '',
    input.amazonStorefront ? `Amazon storefront: ${input.amazonStorefront}` : '',
    input.portfolioUrl ? `Portfolio / link hub (all channels): ${input.portfolioUrl}` : '',
    brand?.contact_email ? `Contact email (sign off with this): ${brand.contact_email}` : '',
    input.productOrAsin ? `Product / ASIN they want to collaborate on: ${input.productOrAsin}` : '',
    input.collabsDone ? `Track record / accolades & wins (use these confidently in the opening): ${input.collabsDone}` : '',
    exampleLinks.length ? `Example past work to offer (links — NOT stats):\n${exampleLinks.map(l => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')

  const shipBlock = input.shareAddress
    ? `If the creator chose to share a shipping address, include this exact block near the end so the brand can send a sample:
Ship samples to:
${[brand?.sample_full_name, brand?.sample_address, brand?.sample_phone].filter(Boolean).join('\n') || '[creator will provide on request]'}`
    : 'Do NOT include any shipping address. If a sample is requested, say the address will be shared once they\'re interested.'

  const sys = `You write brand-collaboration outreach emails using this PROVEN method (follow it exactly — it is the user's tested formula, not generic advice):

SUBJECT LINE:
- ALWAYS start with "RE: " (implies an existing conversation — boosts open rate).
- Use "we"/professional voice. A "?" or "!" works well.
- Examples of the right style: "RE: Looking to Collaborate with a Top Product & Video Reviewer?" / "RE: We Want to Collaborate With You — What Can We Do For <Brand>?" Tailor it to the brand/product.

OPENING (lead with credibility, fast):
- Greet the brand by name, then immediately establish who the creator is and their accolades/wins — badges, "Amazon Platinum/A-Lister since <year>", number of video reviews, number of brand collaborations, top conversion. Pull these from the creator profile / accolades context. DO be confident; don't be shy about wins.
- Mention they also post on their blog + YouTube and push to several social platforms. Include the portfolio/link-hub URL and the Amazon storefront if provided ("You can see our work here: <portfolio>", "storefront: <amazon>").

THE PITCH:
- If a specific product/ASIN is given, name it and say you can help boost its sales.
- Over-offer: state you produce ONE high-quality review video that gets repurposed into a blog post AND a variety of social posts across all channels. List the channels in order (YouTube, Pinterest, Instagram, blog, etc. — whatever they offer).
- Say you're open to MANY products across categories (Home & Kitchen, Tech, Outdoors, Sports, Beauty, Health & Household, Tools, Pet, Office, Musical Instruments, and more) and invite them to send other products too.
- If the creator offers live streams, mention you're also open to live streams on your channels.

THE ASK (state it plainly in this first email):
- If they want a free sample for the review, say so directly.
- If they charge a production fee, state it (and the amount) directly.
- If sharing a shipping address, include the address block exactly where indicated and ask them to send samples there.

CREDIBILITY WITHOUT STATS:
- NEVER promise to share audience analytics, view counts, or performance numbers (platform ToS). Instead offer/point to a few example links of best/most-viewed past work.

CLOSE:
- Express wanting a LONG-TERM collaboration and excitement to test the product and boost their sales. Sign off with the creator's name(s) and contact email.

STYLE (critical — many brand contacts are NOT fluent English speakers):
- Short, simple sentences. No "smart"/complex words, no jargon, no long-winded clauses.
- Use line breaks and structured bullet points so it scans instantly.
- Tone: professional but warm — formal sliding into casual.
- Whole email body UNDER 250 words.

${BANNED_RULE}

Output EXACTLY this structure and nothing else, with the literal markers:
SUBJECT: RE: <subject>
BODY:
<the email body following the method above — greeting, credibility, pitch, plain ask, address block if given, long-term close, signed with the creator's name + contact email>`

  const userMsg = `TARGET BRAND: ${input.brandName}

BRAND RESEARCH:
${brief || 'No public research available — keep brand references general but still tailored to the creator.'}

CREATOR PROFILE:
${profile || '(minimal profile — lean on the channels offered and professionalism)'}

WHAT THE CREATOR OFFERS / WANTS:
- Promotion platforms offered: ${offered}
${input.productOrAsin ? `- Product / ASIN to collaborate on: ${input.productOrAsin}` : ''}
- Asks: ${asks.length ? asks.join('; ') : 'open to a mutually beneficial arrangement'}
${exampleLinks.length ? `- Offer to share these example past collaborations: ${exampleLinks.join(' , ')}` : ''}
${input.extraNotes ? `- Extra context from the creator: ${input.extraNotes}` : ''}

${shipBlock}

Write the email now.`

  const cmsg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  })
  {
    const u = usageFromAnthropic(cmsg)
    recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'collab_email', model: 'claude-sonnet-4-6', input: u.input, output: u.output })
  }

  let out = cmsg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
  out = scrubBanned(out) || out
  if (!out) throw new Error('Could not compose the email — try again.')

  // Split on the SUBJECT:/BODY: markers the prompt enforces.
  let subject = ''
  let body = out
  const m = out.match(/SUBJECT:\s*(.+?)\s*\n+BODY:\s*\n?([\s\S]*)$/i)
  if (m) {
    subject = m[1].trim()
    body = m[2].trim()
  } else {
    // Fallback: first "Subject:" line, rest is body.
    const sm = out.match(/^\s*subject:\s*(.+)$/im)
    if (sm) {
      subject = sm[1].trim()
      body = out.replace(sm[0], '').trim()
    }
  }
  if (subject && !/^re:/i.test(subject)) subject = `RE: ${subject}`
  if (!subject) subject = `RE: Collaboration with ${input.brandName}?`

  const email = `Subject: ${subject}\n\n${body}`
  return { subject, body, email, citations: Array.from(citations).slice(0, 12) }
}
