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
  freeSample: boolean
  productionFee: boolean
  productionFeeAmount?: string
  shareAddress: boolean
  collabsDone?: string
  extraNotes?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Brand = any

export interface CollabResult { email: string; citations: string[] }

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
  if (input.bannerAds) asks.push('discussing a paid banner placement on the blog')
  if (input.productionFee) asks.push(`a production fee${input.productionFeeAmount ? ` of ${input.productionFeeAmount}` : ''} for producing the review content`)

  const profile = [
    brand?.author_name ? `Creator name: ${brand.author_name}` : '',
    brand?.name ? `Brand/site: ${brand.name}` : '',
    brand?.author_bio ? `Bio: ${brand.author_bio}` : '',
    brand?.niches?.length ? `Niches: ${(brand.niches as string[]).join(', ')}` : '',
    brand?.tone?.length ? `Voice: ${(brand.tone as string[]).join(', ')}` : '',
    input.websiteUrl || brand?.website_url ? `Blog: ${input.websiteUrl || brand.website_url}` : '',
    input.youtubeUrl || brand?.youtube_channel_url ? `YouTube: ${input.youtubeUrl || brand.youtube_channel_url}` : '',
    input.amazonStorefront ? `Amazon storefront: ${input.amazonStorefront}` : '',
    input.collabsDone ? `Past collaborations: ${input.collabsDone}` : '',
  ].filter(Boolean).join('\n')

  const shipBlock = input.shareAddress
    ? `If the creator chose to share a shipping address, include this exact block near the end so the brand can send a sample:
Ship samples to:
${[brand?.sample_full_name, brand?.sample_address, brand?.sample_phone].filter(Boolean).join('\n') || '[creator will provide on request]'}`
    : 'Do NOT include any shipping address. If a sample is requested, say the address will be shared once they\'re interested.'

  const sys = `You write concise, high-converting creator→brand collaboration outreach emails. Warm, confident, specific — never desperate, never generic, no hard-sell clichés. Sell the creator's audience fit and proven work so the brand WANTS to reply. Use any brand research to tailor the angle (their products/audience). 150–230 words for the body. Plain text only.

${BANNED_RULE}

Output EXACTLY this structure and nothing else:
Subject: <compelling subject line>

<email body with a greeting, the pitch, what they offer, the ask, and a clear call to action / sign-off using the creator's name>`

  const userMsg = `TARGET BRAND: ${input.brandName}

BRAND RESEARCH:
${brief || 'No public research available — keep brand references general but still tailored to the creator.'}

CREATOR PROFILE:
${profile || '(minimal profile — lean on the channels offered and professionalism)'}

WHAT THE CREATOR OFFERS / WANTS:
- Promotion platforms offered: ${offered}
- Asks: ${asks.length ? asks.join('; ') : 'open to a mutually beneficial arrangement'}
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

  let email = cmsg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
  email = scrubBanned(email) || email
  if (!email) throw new Error('Could not compose the email — try again.')

  return { email, citations: Array.from(citations).slice(0, 12) }
}
