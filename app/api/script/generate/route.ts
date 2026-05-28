/**
 * POST /api/script/generate — pre-production video script + shot list
 *
 * Inputs:
 *   input  string  Amazon ASIN, Amazon URL, Geniuslink, or any product URL.
 *                  Length-capped + trimmed so a paste doesn't blow the prompt.
 *   style  string  'unboxing' | 'quick_test' | 'full_review'
 *
 * Resolves the input → product info (Amazon scrape preferred; falls back to
 * a generic page scrape for non-Amazon URLs), loads the creator's brand
 * voice + the titles of their most recent posts, and asks Claude Sonnet for
 * a structured JSON script grounded in all of the above.
 *
 * Saved to video_scripts on success; returns the row + the parsed script so
 * the UI can render immediately without a follow-up GET.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { fetchProductImageFromPage } from '@/services/research'

type Style = 'unboxing' | 'quick_test' | 'full_review'
const VALID_STYLES: Style[] = ['unboxing', 'quick_test', 'full_review']

interface ScriptSection {
  id: string
  label: string
  durationSec: number
  script: string
  shots: string[]
  bRoll: string[]
  tips: string[]
}
interface ScriptPayload {
  summary: string
  totalDurationSec: number
  sections: ScriptSection[]
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { input?: string; style?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const input = (body.input || '').trim().slice(0, 500)
  if (!input) return NextResponse.json({ error: 'Paste an Amazon ASIN or product URL.' }, { status: 400 })

  const style: Style = VALID_STYLES.includes(body.style as Style) ? (body.style as Style) : 'full_review'

  // ── Resolve the product ───────────────────────────────────────────────────
  // Three paths in priority order:
  //   1. ASIN already in the input (bare 10-char code OR inside an Amazon URL)
  //   2. Generic short link (geni.us / amzn.to / a.co / bit.ly) → follow,
  //      then try ASIN extraction again
  //   3. Plain product URL → page scrape for title + image
  let asin = extractAsin(input.toUpperCase())
  let productUrl: string | null = /^https?:\/\//i.test(input) ? input : null
  if (!asin && productUrl && /(?:geni\.us|gnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(productUrl)) {
    try {
      const resolved = await resolveFinalUrl(productUrl)
      productUrl = resolved
      asin = extractAsin(resolved)
    } catch { /* keep original */ }
  }
  if (!asin && !productUrl) {
    // Bare string that's neither ASIN nor URL — try one last extraction
    // for cases like "Bose QC45 B09JZS2DXJ"; otherwise we'll script
    // text-only off the input as the product description.
    asin = extractAsin(input)
  }

  let productTitle = ''
  let productImage: string | null = null
  let productDescription = ''
  let productBullets: string[] = []
  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      productTitle = p.title || ''
      productImage = p.imageUrl || (p.images && p.images[0]) || null
      productDescription = p.description || ''
      productBullets = Array.isArray(p.bullets) ? p.bullets.slice(0, 8) : []
    } catch { /* fall through to URL scrape */ }
  }
  if (!productTitle && productUrl) {
    try {
      productImage = productImage || (await fetchProductImageFromPage(productUrl))
      // Title from product URL scrape isn't a thing we already do — use the
      // input as the "best guess" so Claude has SOMETHING. Better than the
      // alternative ("Untitled product") for non-Amazon links.
      productTitle = productUrl
    } catch { /* keep what we have */ }
  }
  if (!productTitle) productTitle = input

  // ── Load brand voice + the last few post titles for style mirroring ───────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: brand }, { data: integ }, { data: recentPosts }] = await Promise.all([
    (supabase as any).from('brand_profiles').select('name,author_name,niches,tone,writing_sample,target_audience,words_to_avoid').eq('user_id', user.id).maybeSingle(),
    (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle(),
    (supabase as any).from('blog_posts').select('title').eq('user_id', user.id).eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false }).limit(6),
  ])
  const authorName = (brand?.author_name as string) || ''
  const brandName = (brand?.name as string) || ''
  const niches: string[] = Array.isArray(brand?.niches) ? (brand!.niches as string[]).slice(0, 4) : []
  const tone: string[] = Array.isArray(brand?.tone) ? (brand!.tone as string[]) : []
  const writingSample = ((brand?.writing_sample as string) || '').slice(0, 600)
  const audience = ((brand?.target_audience as string) || '').slice(0, 200)
  const wordsToAvoid: string[] = Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]).slice(0, 30) : []
  const recentTitles: string[] = ((recentPosts as Array<{ title: string | null }> | null) ?? [])
    .map(p => (p.title || '').trim())
    .filter(Boolean)
    .slice(0, 5)
  const tier = (integ?.tier as string | undefined) || 'trial'

  // ── Style-specific skeleton injected into the prompt ──────────────────────
  // Each style has its own section-by-section spine + target run time, so
  // Claude can't drift the script into a different format. Durations are
  // suggestions — the prompt tells Claude to honour them within ±15%.
  const skeletons: Record<Style, { runtime: number; sections: Array<{ id: string; label: string; sec: number; note: string }> }> = {
    unboxing: {
      runtime: 240,
      sections: [
        { id: 'hook',         label: 'Hook',                 sec: 15, note: 'Pattern-interrupt opener. Lead with the visceral thing — "the box weighs nothing", "this came in a tube?".' },
        { id: 'box_intro',    label: 'The Box',              sec: 20, note: 'Brand & packaging. What you see before opening.' },
        { id: 'unbox',        label: 'Unboxing',             sec: 60, note: 'Slow reveal of contents in order. Treat each item.' },
        { id: 'in_hand',      label: 'In-Hand First Look',   sec: 45, note: 'Weight, build quality, surface, materials, what stands out.' },
        { id: 'power_on',     label: 'First Power-On / Quick Use', sec: 40, note: 'Show it works. ONE quick interaction — not a full test.' },
        { id: 'verdict',      label: 'Quick Verdict',        sec: 30, note: 'First impression only. Promise the full review for later.' },
        { id: 'cta',          label: 'CTA',                  sec: 10, note: 'Like, subscribe, link below.' },
      ],
    },
    quick_test: {
      runtime: 360,
      sections: [
        { id: 'hook',         label: 'Hook',                 sec: 15, note: 'State the SPECIFIC claim you\'re testing — "the brand says X. Does it actually?"' },
        { id: 'product_intro',label: 'What This Is',         sec: 30, note: 'Two sentences on what it is + who it\'s for.' },
        { id: 'setup',        label: 'Setup',                sec: 45, note: 'Out-of-box → ready to use. Time it on screen.' },
        { id: 'the_test',     label: 'The Test',             sec: 150, note: 'The MAIN thing it claims to do. One job done well > five jobs glossed over.' },
        { id: 'results',      label: 'Results',              sec: 45, note: 'Did it work? Numbers / before-after / observation. Show, don\'t tell.' },
        { id: 'verdict',      label: 'Verdict',              sec: 60, note: 'Buy / skip / wait — and why. Be specific about WHO should care.' },
        { id: 'cta',          label: 'CTA',                  sec: 15, note: 'Like, subscribe, full review link if planned.' },
      ],
    },
    full_review: {
      runtime: 720,
      sections: [
        { id: 'hook',         label: 'Hook',                 sec: 20, note: 'The BIGGEST objection or the BIGGEST claim. Make it concrete.' },
        { id: 'quick_verdict',label: 'Quick Verdict (TL;DR)',sec: 45, note: 'For impatient viewers — the take + the score in 45 seconds.' },
        { id: 'who_for',      label: 'Who This Is For',      sec: 50, note: 'Target buyer, target NOT-buyer. Be ruthless.' },
        { id: 'unbox',        label: 'What\'s in the Box',   sec: 50, note: 'Fast — accessories, manuals, anything unusual.' },
        { id: 'build_design', label: 'Build & Design',       sec: 75, note: 'Materials, ergonomics, dimensions vs expectations.' },
        { id: 'specs',        label: 'The Specs',            sec: 60, note: 'Tie specs to real-world stakes. "X mAh = Y hours doing Z."' },
        { id: 'real_world',   label: 'Real-World Testing',   sec: 240, note: 'The MEAT. 3-5 distinct scenarios with specific outcomes.' },
        { id: 'pros',         label: 'Pros',                 sec: 45, note: 'Top 3-5 strengths. One sentence each. Concrete, not generic.' },
        { id: 'cons',         label: 'Cons',                 sec: 45, note: 'Top 3-5 weaknesses. NEVER soften — viewers spot the lie.' },
        { id: 'vs',           label: 'vs Alternatives',      sec: 50, note: 'One or two competitors creators in this niche already know.' },
        { id: 'verdict',      label: 'Final Verdict',        sec: 30, note: 'Buy / skip / wait + price-it-justifies. Conviction over hedging.' },
        { id: 'cta',          label: 'CTA',                  sec: 10, note: 'Like, subscribe, link below.' },
      ],
    },
  }
  const skel = skeletons[style]
  const skeletonLines = skel.sections.map(s => `${s.id} | ${s.label} | ${s.sec}s | ${s.note}`).join('\n')

  // ── Big prompt ───────────────────────────────────────────────────────────
  const styleLabel = style === 'unboxing' ? 'Unboxing' : style === 'quick_test' ? 'Quick Test' : 'Full Review'
  const promptBody = `You're writing a pre-production script + shot list for the creator's NEXT YouTube ${styleLabel} video. They'll read this off-camera while filming. Voice it like the creator would write it.

CREATOR
${brandName ? `Channel: ${brandName}` : ''}${authorName ? `\nHost name: ${authorName}` : ''}
${niches.length ? `Niche: ${niches.join(', ')}` : ''}
${audience ? `Audience: ${audience}` : ''}
${tone.length ? `Tone keywords: ${tone.join(', ')}` : ''}
${writingSample ? `Writing sample (match this rhythm + vocabulary):\n"""${writingSample}"""` : ''}
${recentTitles.length ? `Recent video/post titles for hook style:\n${recentTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}` : ''}
${wordsToAvoid.length ? `Words to NEVER use: ${wordsToAvoid.join(', ')}` : ''}

PRODUCT
Title: ${productTitle}
${asin ? `Amazon ASIN: ${asin}` : ''}
${productDescription ? `Description:\n${productDescription.slice(0, 700)}` : ''}
${productBullets.length ? `Key bullet points:\n${productBullets.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}` : ''}

STYLE: ${styleLabel}
Target total runtime: ${skel.runtime} seconds (${Math.round(skel.runtime / 60)}+ min). Per-section durations are guides — honour them within ±15%.

REQUIRED SECTION SPINE (order + ids + suggested duration + intent):
${skeletonLines}

VOICE RULES (apply to every \`script\` field):
- First person. The host IS the creator — never refer to "the reviewer" or use a third person.
- NEVER use the word "honest", "honestly", or "honesty" in any form. Banned.
- NEVER fabricate specs, features, or numbers that aren't in the product info above.
- Punchy sentences. Aim for spoken English, not written.
- No corporate filler: "without further ado", "we're excited to share", "in this video we will".
${writingSample ? '- MIRROR the rhythm of the writing sample above. Same sentence lengths, same opener style.' : ''}

SHOT LIST RULES:
- For each section, list 2-4 specific shots (\`shots\`) — frame, angle, what's in frame. Examples: "overhead flat-lay of the box on a wooden table", "close-up of the host's hands turning the dial", "three-quarter angle on the product against a softly blurred kitchen background".
- For each section, list 2-3 B-roll suggestions (\`bRoll\`) — supplementary footage to cut to. Macro details, environmental shots, comparison props.
- For each section, list 1-2 tips (\`tips\`) — concrete on-camera direction, light cue, or pacing note. NOT generic ("be authentic"). Specific ("hold the box up so the logo is centred", "pause for 1 second after saying the price").

Return ONLY a single JSON object with NO prose around it, shaped EXACTLY:

{
  "summary": "<two-sentence TL;DR of the video for the creator>",
  "totalDurationSec": <integer near the target runtime>,
  "sections": [
    {
      "id": "<exact id from the spine above>",
      "label": "<exact label from the spine>",
      "durationSec": <integer>,
      "script": "<verbatim spoken voiceover for this section>",
      "shots": ["<shot 1>", "<shot 2>", ...],
      "bRoll": ["<b-roll 1>", "<b-roll 2>", ...],
      "tips": ["<tip 1>", "<tip 2>"]
    }
    ... one object per section in the spine, IN ORDER
  ]
}`

  let parsed: ScriptPayload
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4500,
      messages: [{ role: 'user', content: promptBody }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'script_generate', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('Model returned no JSON')
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as ScriptPayload
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? `Couldn't generate the script: ${err.message}` : 'Generation failed.',
    }, { status: 500 })
  }

  // Defensive shape-coercion — Claude usually returns the right shape but we
  // never trust un-validated JSON.
  const sections: ScriptSection[] = Array.isArray(parsed.sections)
    ? parsed.sections.map((s, i) => ({
        id: typeof s.id === 'string' ? s.id : `section_${i}`,
        label: typeof s.label === 'string' ? s.label : `Section ${i + 1}`,
        durationSec: Number.isFinite(s.durationSec) ? Math.max(5, Math.min(900, s.durationSec)) : 30,
        script: typeof s.script === 'string' ? s.script : '',
        shots: Array.isArray(s.shots) ? s.shots.map(x => String(x)).slice(0, 6) : [],
        bRoll: Array.isArray(s.bRoll) ? s.bRoll.map(x => String(x)).slice(0, 6) : [],
        tips: Array.isArray(s.tips) ? s.tips.map(x => String(x)).slice(0, 5) : [],
      }))
    : []
  const cleaned: ScriptPayload = {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : '',
    totalDurationSec: Number.isFinite(parsed.totalDurationSec) ? parsed.totalDurationSec : sections.reduce((sum, s) => sum + s.durationSec, 0),
    sections,
  }

  // Belt-and-braces honest scrub — same as the blog generator.
  const stripHonest = (s: string) => s.replace(/\b(?:honestly|honesty|honest)\b/gi, '').replace(/\s{2,}/g, ' ').trim()
  cleaned.summary = stripHonest(cleaned.summary)
  cleaned.sections.forEach(sec => { sec.script = stripHonest(sec.script) })

  if (sections.length === 0) {
    return NextResponse.json({ error: 'The model returned no sections. Try again in a moment.' }, { status: 500 })
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: insertErr } = await (supabase as any)
    .from('video_scripts')
    .insert({
      user_id: user.id,
      style,
      input,
      asin: asin || null,
      product_title: productTitle.slice(0, 300),
      product_image_url: productImage,
      script: cleaned,
      ai_model: 'claude-sonnet-4-6',
    })
    .select('id,created_at')
    .single()
  if (insertErr || !row) {
    // Still return the script even if persist failed — better than wasting
    // the Claude call. UI will show without a saved row.
    console.warn('[script/generate] persist failed:', insertErr?.message)
    return NextResponse.json({ ok: true, script: cleaned, asin, productTitle, productImage, persisted: false })
  }

  return NextResponse.json({
    ok: true,
    scriptId: row.id,
    createdAt: row.created_at,
    script: cleaned,
    asin,
    productTitle,
    productImage,
    persisted: true,
  })
}
