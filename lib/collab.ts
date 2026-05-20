// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
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
  livestreams?: boolean
  livestreamLink?: string
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
  if (input.freeSample) asks.push('REQUEST: a free product sample in exchange for a genuine, in-depth review')
  if (input.bannerAds) asks.push(`OPTION WE OFFER (not required): a paid banner ad placement on our blog${input.bannerAdsAmount ? ` at ${input.bannerAdsAmount}` : ''} — available if they want extra visibility`)
  if (input.productionFee) asks.push(`OPTION WE OFFER (not required): a production fee${input.productionFeeAmount ? ` of ${input.productionFeeAmount}` : ''} if they'd like us to produce the review content`)

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
    // Explicit reply-to channel the creator wants brands to use. The
    // signature should always include the email (it IS an email), but
    // when preference=website, also direct the brand to the website
    // for further info / portfolio.
    (brand?.contact_preference === 'website' && (input.websiteUrl || brand?.website_url))
      ? `Preferred follow-up channel: WEBSITE — include a line like "For full portfolio and current rates, visit ${input.websiteUrl || brand.website_url}" near the sign-off.`
      : (brand?.contact_preference === 'email' && brand?.contact_email)
        ? `Preferred follow-up channel: EMAIL — make the email address the primary reply channel in the sign-off.`
        : '',
    input.productOrAsin ? `Product / ASIN they want to collaborate on: ${input.productOrAsin}` : '',
    input.collabsDone ? `Track record / accolades & wins (use these confidently in the opening): ${input.collabsDone}` : '',
    exampleLinks.length ? `Example past work to offer (links — NOT stats):\n${exampleLinks.map(l => `- ${l}`).join('\n')}` : '',
    input.livestreams
      ? `Open to LIVE STREAMS on their channels${input.livestreamLink ? ` — best livestream to show as proof: ${input.livestreamLink}` : ''}`
      : '',
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
- Mention the channels they ACTUALLY have, using ONLY the platforms in "Promotion platforms offered" plus their blog/YouTube if present. NEVER name or imply a platform that is not in that list (no "and more", no "across all our socials" — be specific to what they offer). If a Linktree / link-hub URL is provided, include it ("You can see all our channels here: <portfolio>"); if an Amazon storefront is provided, include it ("Amazon storefront: <storefront>"). Omit either line if its URL is absent.

THE PITCH:
- If a specific product/ASIN is given, name it and say you can help boost its sales.
- Over-offer: state you produce ONE high-quality review video that gets repurposed into a blog post AND social posts — but ONLY across the platforms in "Promotion platforms offered". List exactly those platforms, in a sensible order. Do NOT pad the list with platforms they did not offer.
- Say you're open to MANY products across categories (Home & Kitchen, Tech, Outdoors, Sports, Beauty, Health & Household, Tools, Pet, Office, Musical Instruments, and more) and invite them to send other products too.
- If the creator offers live streams, mention you're also open to live streams on your channels.

THE ASK vs THE OPTIONS (frame these correctly — this matters):
- The ONLY real request is the free product sample (when present): ask for it directly and warmly.
- Paid placements (banner ad, production fee) are OPTIONS the creator OFFERS — extra services the brand can choose, NOT demands or conditions of the collaboration. Phrase them as available choices, e.g. "We also offer, as an option, a paid banner ad placement on our blog at <amount>/month" or "Optionally, a production fee of <amount> if you'd like us to produce the content." Never make them sound like a price of admission or an ultimatum. State the amount clearly but keep the tone "here's what's available if useful to you."
- If sharing a shipping address, include the address block exactly where indicated and ask them to send samples there.

CREDIBILITY WITHOUT STATS:
- NEVER promise to share audience analytics, view counts, or performance numbers (platform ToS). Instead offer/point to a few example links of best/most-viewed past work.

CLOSE:
- Express wanting a LONG-TERM collaboration and excitement to test the product and boost their sales. Sign off with the creator's name(s) and contact email.

STYLE (critical — many brand contacts are NOT fluent English speakers):
- Short, simple sentences. No "smart"/complex words, no jargon, no long-winded clauses.
- Use real line breaks: a blank line between paragraphs, each bullet on its own line starting with "- ".
- Tone: professional but warm — formal sliding into casual.
- Whole email body UNDER 250 words.

PLAIN TEXT ONLY. Absolutely NO markdown: no **, __, *, #, or backticks anywhere.

${BANNED_RULE}

OUTPUT FORMAT — return EXACTLY this, nothing before or after. Two marker lines, each on its own line, verbatim:
<<<SUBJECT>>>
RE: one short single-line subject, max 80 characters
<<<BODY>>>
<the body as a sequence of BLOCKS>

BLOCK RULES (this controls spacing — follow precisely):
- Separate every block with a line containing ONLY: ===
- A "block" = one short paragraph OR one list. Never mix a sentence and a list in the same block — a lead-in line like "Here is why we are worth your time:" is its own block, the bullets are the NEXT block.
- In a list block, put EACH item on its own line starting with "- " (or for example/work links, the bare URL on its own line). One item per line. Nothing else in a list block.
- Do NOT put blank lines or "===" inside a block. The "===" lines are the ONLY separators.

Produce the blocks in THIS order (skip a block only if its data is absent):
1. Greeting — "Hi <Brand> Team,"
2. Who we are + "Here is why we are worth your time:"
3. LIST: credibility/accolades bullets
4. Links block — include ONLY the lines whose URL was provided, each on its own line: "You can see all our channels here: <Linktree/portfolio>" and/or "Amazon storefront: <storefront>". Skip this entire block if neither URL exists.
5. The pitch: collaborate on the product/ASIN + "Here is exactly what we produce from one review:"
6. LIST: one bullet per deliverable — a YouTube video review, a blog post on <blog>, then ONE bullet per platform from "Promotion platforms offered" (only those — never list a platform that was not offered)
7. Live streams: include this block ONLY if the creator is open to live streams. Say they're also open to live streams on their channels, and if a best-livestream link was provided, include it as proof ("Here's one of our live streams: <link>"). Then the open-to-more-products/categories paragraph.
8. "Here are a few examples of our recent work:"
9. LIST: the example links (bare URLs, one per line)
10. Lead-in line: "What we ask for, and what we also offer:" (only if there are any asks/options)
11. LIST: the free-sample request phrased as a friendly ask; then any paid placements phrased clearly as OPTIONAL offerings (start those lines with "Optional —", e.g. "Optional — a paid banner ad placement on our blog at <amount>/month"). Never present the paid options as requirements.
12. "Ship samples to:" then the address lines (only if sharing address) — address as its own block
13. Long-term close paragraph
14. Sign-off: creator name(s), then brand/site, then contact email (each on its own line, one block)`

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

  // Strip any markdown the model slipped in — must be clean plain text.
  const stripMd = (s: string): string => s
    .replace(/\*\*(.+?)\*\*/g, '$1')        // **bold**
    .replace(/__(.+?)__/g, '$1')            // __bold__
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2') // *italic*
    .replace(/^#{1,6}\s+/gm, '')            // # headings
    .replace(/^\s*([-*_]\s*){3,}\s*$/gm, '') // --- / *** separator lines
    .replace(/`{1,3}/g, '')                 // backticks
    .replace(/\n{3,}/g, '\n\n')             // collapse blank runs
    .trim()

  // Parse the explicit markers; tolerate missing/loose ones.
  let subject = ''
  let body = ''
  const sIdx = out.search(/<<<\s*SUBJECT\s*>>>/i)
  const bIdx = out.search(/<<<\s*BODY\s*>>>/i)
  if (sIdx !== -1 && bIdx !== -1 && bIdx > sIdx) {
    subject = out.slice(out.indexOf('\n', sIdx) + 1, bIdx).trim()
    body = out.slice(out.indexOf('\n', bIdx) + 1).trim()
  } else {
    // Fallback: first short line that looks like a subject; rest is body.
    const lines = out.split('\n')
    const first = (lines[0] || '').replace(/^\s*subject:\s*/i, '').trim()
    if (first && first.length <= 110) {
      subject = first
      body = lines.slice(1).join('\n').trim()
    } else {
      body = out
    }
  }

  subject = stripMd(subject).split('\n')[0].trim().replace(/^subject:\s*/i, '')

  // The model emits blocks separated by a line that is only "===".
  // We own the spacing: one blank line between every block. Tolerate the
  // model using blank lines instead of (or as well as) the marker.
  const blocks = body
    .split(/^\s*={2,}\s*$/m)
    .flatMap(b => (b.includes('===') ? b.split(/\s*={3,}\s*/) : [b]))
    .map(b => stripMd(b).replace(/\n{2,}/g, '\n').trim())
    .filter(Boolean)
  body = blocks.length > 1
    ? blocks.join('\n\n')
    : stripMd(body)  // no markers came back — strip md, keep as-is

  // Hard guard: a subject must be ONE short line. If the model jammed the
  // body in, discard it and synthesize a clean one (body stays intact).
  if (!subject || subject.length > 120) {
    if (subject && !body) body = subject
    subject = `RE: Collaboration with ${input.brandName}?`
  }
  if (!/^re:/i.test(subject)) subject = `RE: ${subject}`
  subject = subject.slice(0, 120)
  if (!body) throw new Error('Could not compose the email — try again.')

  const email = `Subject: ${subject}\n\n${body}`
  return { subject, body, email, citations: Array.from(citations).slice(0, 12) }
}
