// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/on-sale/promo { asin } — the promo for one covered product that
// is on sale: a vertical Short script, a YouTube Community post, a comment for
// the original video, and a social post, in the creator's voice. LABS.
//
// WRITTEN FROM WHAT THEY ALREADY SAID. The creator reviewed this product, so
// the promo leans on their own video (its title, and its transcript when MVP
// has one), not on the listing's marketing.
//
// NO PRICES, NO PERCENTAGES. A sale price is true for hours and a post lives
// for months, and Amazon's rules on showing prices are strict. The copy says
// it is on sale and sends people to check; the page shows the numbers.
//
// NO SALE EVENT IS NAMED. Whether a discount belongs to Prime Big Deal Days
// or Black Friday is not something the price tells us, and a calendar guess
// ("it is October, so it must be Prime") is a false claim on a real video.
//
// NOT ON SALE, NO PROMO. A lightning deal can end between the page loading
// and this being pressed, and a comment saying "on sale right now" would then
// sit on the video saying something untrue.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { creatorVoiceBlock, CREATOR_VOICE_COLUMNS } from '@/lib/creator-voice'
import { tidyCopy } from '@/lib/copy-rules'
import { fetchAmazonProduct } from '@/services/amazon'
import { resolveCloakedLinkDetailed } from '@/lib/link-cloak'
import { coveredProducts, findSales, saleLabel, videoVisibility } from '@/lib/covered-sales'
import { commentWithLink, lastingBody, PRICE_LINE_LEAD, DISCLOSURE } from '@/lib/sale-comments'

export const runtime = 'nodejs'
export const maxDuration = 90

const MODEL = 'claude-sonnet-4-6'

const tidy = (s: unknown) => tidyCopy(s)

/** words_to_avoid is one text column, commas or new lines between words. */
function avoidList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,\n;]+/)
  return list.map((w) => w.trim()).filter(Boolean).slice(0, 30)
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier,amazon_associates_tag').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  if (!canUsePreview('on_sale', tier)) {
    return NextResponse.json({ error: 'On sale now is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const blocked = await spendGate(user.id, tier)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({})) as { asin?: string }
  const asin = String(body.asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'Which product? Send its ASIN.' }, { status: 400 })

  const admin = createAdminClient()
  const covered = (await coveredProducts(admin, user.id, 400, [asin])).find((p) => p.asin === asin)
  if (!covered) return NextResponse.json({ error: 'That product is not in your videos or storefront.' }, { status: 404 })
  let checked = 0
  const sale = (await findSales(admin, [covered], { onStats: (st) => { checked = st.checked } }))[0] ?? null
  // COULD NOT LOOK is not the same as NOT ON SALE: said differently, so the
  // page does not mark a sale as ended because Keepa was busy.
  if (!sale && checked === 0) {
    return NextResponse.json({ error: 'The price could not be checked just now. Try again in a minute.' }, { status: 503 })
  }
  if (!sale) {
    return NextResponse.json({ error: 'This one is not on sale any more, so there is nothing true to promote. Check again later.', ended: true }, { status: 409 })
  }

  const videos = covered.sources.filter((s) => s.kind === 'video')
  // THE VIDEO THE COMMENT GOES ON IS A PUBLIC ONE. A comment on a private or
  // scheduled video is read by nobody. The most viewed public video leads;
  // with none public, the writing still leans on their best video's words,
  // but there is no video to comment on or link to, and the page says why.
  const vis = await videoVisibility(process.env.YOUTUBE_API_KEY, videos.map((v) => v.youtubeVideoId || ''))
  const byViews = [...videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const lead = byViews.find((v) => vis.get(v.youtubeVideoId || '') === 'public') ?? byViews[0] ?? null
  const leadVis = lead ? (vis.get(lead.youtubeVideoId || '') ?? null) : null
  // YouTube not answering is unknown, not private: the button stays, and the
  // comment route asks YouTube again through the channel's own login.
  const leadPublic = !!lead && (leadVis === 'public' || leadVis === null)
  let transcript = ''
  if (lead?.id) {
    const { data: v } = await admin.from('youtube_videos').select('transcript').eq('id', lead.id).maybeSingle()
    transcript = String(v?.transcript || '').slice(0, 3500)
  }
  let bullets: string[] = []
  let productTitle = covered.title
  try {
    const p = await fetchAmazonProduct(asin)
    bullets = (p.bullets ?? []).slice(0, 6)
    if (p.title) productTitle = p.title
  } catch { /* the creator's own words carry it */ }

  // THEIR LINK, the same way every other MVP surface builds it.
  const tag = String(intg?.amazon_associates_tag || '').trim()
  const destination = `https://www.amazon.com/dp/${asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`
  let link = destination
  try {
    const r = await resolveCloakedLinkDetailed({
      supabase: admin, userId: user.id, destination, asin, channel: 'youtube',
      source: lead?.youtubeVideoId ?? 'youtube', label: productTitle,
    })
    if (r.url) link = r.url
  } catch { /* the plain tagged link */ }


  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (admin as any).from('brand_profiles')
    .select(`name,author_name,tone,target_audience,words_to_avoid,writing_sample,${CREATOR_VOICE_COLUMNS}`)
    .eq('user_id', user.id).maybeSingle()
  const voice = creatorVoiceBlock(brand as never)
  const avoid = avoidList(brand?.words_to_avoid)

  const prompt = `A product this creator already reviewed is on sale right now. Write the promo that brings their audience back to it.

THE PRODUCT: "${productTitle}"
${bullets.length ? `WHAT IT IS (from the listing):\n${bullets.map((b) => `- ${b.slice(0, 200)}`).join('\n')}` : ''}
THEIR VIDEO ABOUT IT: ${lead ? `"${lead.title}"` : 'none (it is in their storefront)'}
${transcript ? `WHAT THEY SAID IN THAT VIDEO (transcript excerpt, use their real opinions and details):\n"""${transcript}"""` : ''}
Do NOT name any Amazon sale event (Prime Day, Prime Big Deal Days, Black Friday and the like): nothing here says which one this is.
${voice ? `\nWRITE IN THIS CREATOR'S VOICE:\n${voice}` : ''}
${avoid.length ? `\nNEVER USE THESE WORDS: ${avoid.join(', ')}` : ''}

Write four pieces. First person, the creator talking, warm and specific, like telling a friend.
1. "short": a script the creator films as a new 15 to 30 second vertical video (YouTube Short, Reel, TikTok or Story), holding or showing the product. {"hook": the first line spoken, under 12 words, "script": the full spoken script, "onScreen": 2 to 4 short on-screen text lines}. End by saying the link is in the description or pinned comment. Do not put a URL in it.
2. "community": a YouTube Community post, 2 to 4 sentences. Do not put any URL or link placeholder in it: MVP adds the links itself on their own lines.
3. "comment": a comment for the original video, 1 to 3 sentences, telling viewers it is on sale right now. Do not put any URL or link placeholder in it: MVP adds the price line and the disclosure itself.
3b. "commentAfter": the same comment for after the sale ends, 1 to 2 sentences, pointing viewers to the product from this video. It must stay true forever: NO mention of a sale, deal, discount, saving, price, "right now", "today" or any time pressure. No URL.
4. "social": a post for X, Threads or Facebook, under 240 characters, including {link}.

HARD RULES for every piece:
- NEVER state a price, a dollar amount, or a percentage. Say it is on sale, a great time to grab it, or the best price you have seen. Prices change by the hour.
- NEVER invent facts, results, or features they did not mention or the listing does not say.
- No dashes as sentence breaks (no " - ", no en or em dash). No year. No hashtags except at most two in "social". No emojis except at most one per piece.
- Never use any form of the word "honest". Never "game-changer", "must-have", "insane", "amazing".
- Do not say "link in bio".

Return ONLY JSON: {"short":{"hook":"...","script":"...","onScreen":["..."]},"community":"...","comment":"...","commentAfter":"...","social":"..."}`

  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'on_sale_promo', model: MODEL })
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ error: 'The writer did not return a promo. Try again.' }, { status: 502 })
    const j = JSON.parse(m[0]) as { short?: { hook?: string; script?: string; onScreen?: string[] }; community?: string; comment?: string; commentAfter?: string; social?: string }
    const fill = (s: string) => tidy(s).replace(/\{link\}/g, link)
    // THE LINK AND THE DISCLOSURE ARE MVP'S, NOT THE WRITER'S. Written by
    // code, they are always there, always the same, and always say where the
    // link goes: "Check the latest price on Amazon here", then the Associates
    // statement, which Amazon requires wherever an Associates link is shared.
    const strip = (t: string) => fill(t).replace(/https?:\/\/\S+/g, '').replace(/\{link\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
    const priceLine = `${PRICE_LINE_LEAD} ${link}`
    const disclosure = DISCLOSURE
    const comment = commentWithLink(strip(j.comment ?? ''), link)
    // WHAT THE COMMENT BECOMES WHEN THE SALE ENDS. Same link and disclosure;
    // no sale in it. A writer slip falls back to a plain line (lib/sale-comments).
    const commentLasting = commentWithLink(lastingBody(j.commentAfter, productTitle), link)
    const videoUrl = leadPublic && lead?.youtubeVideoId ? `https://youtu.be/${lead.youtubeVideoId}` : ''
    const community = `${strip(j.community ?? '')}\n\n${videoUrl ? `Watch my review: ${videoUrl}\n` : ''}${priceLine}\n${disclosure}`
    // THE SOCIAL POST, twice: with the link for copying, and without it for
    // the quick-post sheet, which adds each platform's own link (and #ad).
    const socialRaw = tidy(j.social ?? '')
    return NextResponse.json({
      ok: true,
      asin, title: productTitle, link,
      sale: { label: saleLabel(sale.verdict), ...sale.verdict },
      // Only a public video can take the comment. `videoNotPublic` says why
      // there is none, so the page can tell "private" from "no video at all".
      video: leadPublic && lead ? { youtubeVideoId: lead.youtubeVideoId, title: lead.title, channelId: lead.channelId } : null,
      videoNotPublic: lead && leadVis && leadVis !== 'public' ? { title: lead.title, visibility: leadVis } : null,
      promo: {
        short: {
          hook: tidy(j.short?.hook),
          script: tidy(j.short?.script),
          onScreen: (j.short?.onScreen ?? []).map(tidy).filter(Boolean).slice(0, 4),
        },
        community,
        comment,
        commentLasting,
        social: socialRaw.replace(/\{link\}/g, link),
        socialForSheet: socialRaw.replace(/\s*\{link\}\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: `The promo could not be written: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }, { status: 502 })
  }
}
