/**
 * POST /api/script/generate — UGC pre-production: 3-6 min script + shot list,
 * plus an auto vertical short cutdown (written fresh, not lifted).
 *
 * Inputs:
 *   input  string  Amazon ASIN, Amazon URL, Geniuslink, or any product URL.
 *   style  string  'first_look' | 'hands_on' | 'long_term'
 *
 * Tier gate: Pro / Admin only. Trial / Creator get a 403 with upgrade hint
 * (the /script page shows an upsell card instead of the generator).
 *
 * Usage gate: 30 scripts / UTC calendar month for Pro. Admin uncapped.
 *
 * Voice + craft spec (locked in with the creator, 2026-05-28):
 *   - First person always. Friend who tested it + excited discoverer + expert.
 *   - HARD bans: "honest" family · "in today's video / hey guys" · "subscribe /
 *     smash the like / don't forget to" · "game-changer / mind-blowing / next-
 *     level" · ALL competitor product names · the price spoken aloud · ANY
 *     on-camera CTA to a link.
 *   - Granularity: scripted hook + verdict (word-for-word) · improvised middle
 *     (beat directions + 2-3 suggested talking points the creator can pick or
 *     paraphrase).
 *   - Hook: 3 variants the creator picks from — problem-first, question / wait-
 *     for-it, and one more in that family.
 *   - Beat structure (hands_on / long_term): hook → unbox → setup → 2-3 real
 *     tests → verdict-with-trade-offs → who-it's-for. No CTA section.
 *   - Verdict bundles "Don't buy this if..." rather than a separate cons block.
 *   - Real-use scenarios + build quality + trade-offs are the focus areas.
 *   - Shot list: subject only (no separate B-roll, no director notes, no
 *     lighting cues). Variable count by style.
 *   - For hands_on + long_term: ALSO produce a 30-60s vertical short cutdown
 *     written FRESH, not lifted from the long master. Its hook opens on a
 *     visual surprise / strongest verdict line / trade-off tease.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { resolveFinalUrl } from '@/lib/product-link'
import { fetchProductImageFromPage } from '@/services/research'
import { checkScriptUsage } from '@/lib/tier'

type Style = 'first_look' | 'hands_on' | 'long_term'
const VALID_STYLES: Style[] = ['first_look', 'hands_on', 'long_term']

interface ScriptSection {
  id: string
  label: string
  durationSec: number
  /** Word-for-word voiceover. Populated for hook + verdict + who-it's-for
   *  (the locked-in moments). Empty string for improvised middle sections. */
  script: string
  /** Beat direction + 2-3 suggested talking points for improvised middle
   *  sections. Empty for the scripted moments. */
  talkingPoints: string[]
  /** Subject-only shots ("close-up of the side button"). Creator decides
   *  angle / framing / lighting on the day. */
  shots: string[]
}

interface ShortCutdown {
  /** Verbatim opening 3-5s (visual cue + first spoken line). */
  hook: string
  /** Verbatim 25-55s short script. */
  script: string
  /** Subject-only shots covering the short. */
  shots: string[]
  durationSec: number
}

interface ScriptPayload {
  summary: string
  totalDurationSec: number
  /** Three hook variants the creator picks ONE from before filming the long
   *  master. Each is a complete verbatim 10-15s opener. Renderer shows them
   *  side-by-side so the creator can scan and pick. */
  hooks: string[]
  sections: ScriptSection[]
  /** Auto vertical short for hands_on + long_term — undefined for first_look
   *  (a first_look IS the vertical). */
  shortCutdown?: ShortCutdown
}

/** Three style buckets reframed (2026-05-28) for UGC. Time-based progression
 *  matched to buyer-research stage. */
const STYLE_SPEC: Record<Style, {
  label: string
  totalSec: number
  shotCount: { min: number; max: number }
  hasShort: boolean
  spine: Array<{ id: string; label: string; sec: number; scripted: boolean; note: string }>
}> = {
  first_look: {
    label: 'First Look',
    totalSec: 75,           // 60-90s vertical
    shotCount: { min: 5, max: 7 },
    hasShort: false,        // First Look IS the vertical — no separate cutdown
    spine: [
      { id: 'hook',         label: 'Hook',                sec: 8,  scripted: true,  note: 'Open on a visual surprise or trade-off tease. 1 sentence max. Picks from the 3 hook variants above.' },
      { id: 'reveal',       label: 'Reveal',              sec: 12, scripted: false, note: 'Name the product (no price). 1-2 lines. What it is, who it is for — fast.' },
      { id: 'first_impression', label: 'First Impression', sec: 25, scripted: false, note: 'Hands on it. Build quality + feel in 2-3 specific beats. Skip generic "feels premium" — say WHY.' },
      { id: 'verdict',      label: 'Quick Verdict',       sec: 25, scripted: true,  note: '"Worth it if... not for you if..." Bundles the trade-off into the recommendation. No separate cons block.' },
      { id: 'close',        label: 'Close',               sec: 5,  scripted: true,  note: '1 line. NO mention of links / subscribe / description. Just a clean ending beat.' },
    ],
  },
  hands_on: {
    label: 'Hands-On Test',
    totalSec: 300,          // 5 min target (range 3-6 min)
    shotCount: { min: 10, max: 12 },
    hasShort: true,
    spine: [
      { id: 'hook',         label: 'Hook',                sec: 12, scripted: true,  note: 'Pick from the 3 hook variants. 1-2 sentences. Problem-first or question — not bold claim.' },
      { id: 'context',      label: 'Context / Set-up',    sec: 25, scripted: false, note: 'WHY you got this. The problem you wanted to solve. Personal stake makes the test feel real.' },
      { id: 'unbox',        label: 'Unboxing',            sec: 35, scripted: false, note: '30 seconds max. What is in the box, brief. Skip ceremony — most viewers do not care.' },
      { id: 'build_feel',   label: 'Build & Feel',        sec: 40, scripted: false, note: 'Hands on. Materials, weight, fit. 2-3 specific observations — not "feels premium".' },
      { id: 'test_1',       label: 'Real-Use Test #1',    sec: 60, scripted: false, note: 'First specific scenario. Not generic — name the use case. Show it working (or not).' },
      { id: 'test_2',       label: 'Real-Use Test #2',    sec: 60, scripted: false, note: 'Different scenario. Different angle on the product. Surface a small flaw if it shows up — adds trust.' },
      { id: 'verdict',      label: 'Verdict',             sec: 45, scripted: true,  note: 'Word-for-word. "Worth it if... not for you if..." — bundles trade-offs. Names who should NOT buy.' },
      { id: 'close',        label: 'Close',               sec: 8,  scripted: true,  note: '1 line. NO link / subscribe / description CTA. Clean ending.' },
    ],
  },
  long_term: {
    label: 'Long-Term Review',
    totalSec: 600,          // 10 min target (range 8-12 min)
    shotCount: { min: 13, max: 16 },
    hasShort: true,
    spine: [
      { id: 'hook',         label: 'Hook',                sec: 15, scripted: true,  note: 'Pick from the 3 hook variants. Lead with the moment of doubt or the lived-in insight from weeks of use.' },
      { id: 'context',      label: 'The Backstory',       sec: 40, scripted: false, note: 'Why you got it, how long you have had it, how often you use it. Sets the credibility frame.' },
      { id: 'unbox',        label: 'Unboxing Recap',      sec: 35, scripted: false, note: 'Brief — what came in the box. Save the screen time for use.' },
      { id: 'build_feel',   label: 'Build Held Up?',      sec: 50, scripted: false, note: 'After [N weeks/months] — what wore in, what wore out. Specific marks, fading, loose parts.' },
      { id: 'test_1',       label: 'Real-Use Test #1',    sec: 110, scripted: false, note: 'Deep scenario — the main use case. Show it doing the job over time. Include the moment you doubted it.' },
      { id: 'test_2',       label: 'Real-Use Test #2',    sec: 90, scripted: false, note: 'Second scenario — a different angle. Surface the recurring annoyance you only notice with daily use.' },
      { id: 'test_3',       label: 'Real-Use Test #3',    sec: 80, scripted: false, note: 'Optional third — the edge case that tests the product. Where it stretched / broke / surprised.' },
      { id: 'verdict',      label: 'Long-Term Verdict',   sec: 70, scripted: true,  note: 'Word-for-word. "Still worth it if... not for you if..." Trade-offs woven in. Mentions whether you would buy again.' },
      { id: 'who_for',      label: 'Who This Is For',     sec: 35, scripted: true,  note: 'Word-for-word. Names the buyer who SHOULD get it. Names the buyer who should not.' },
      { id: 'close',        label: 'Close',               sec: 10, scripted: true,  note: '1 line. NO link / subscribe / description CTA. Clean ending.' },
    ],
  },
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { input?: string; style?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const input = (body.input || '').trim().slice(0, 500)
  if (!input) return NextResponse.json({ error: 'Paste an Amazon ASIN or product URL.' }, { status: 400 })

  // Default to hands_on (the 3-6 min "decision moment" review — the main one
  // creators reach for). first_look is the vertical-only style; long_term is
  // the 8-12 min deep dive after weeks of use.
  const style: Style = VALID_STYLES.includes(body.style as Style) ? (body.style as Style) : 'hands_on'

  // ── Tier + monthly cap gate ───────────────────────────────────────────────
  // Pro-only feature. Trial / Creator return a 403 with upgrade copy that the
  // /script page surfaces as an upsell card. Pro past 30/month gets the cap
  // message + reset date.
  const usage = await checkScriptUsage(supabase, user.id)
  if (!usage.allowed) {
    return NextResponse.json({
      error: usage.reason,
      limitReached: true,
      cap: 'scripts',
      currentTier: usage.tier,
      upgrade: usage.upgrade,
      used: usage.used,
      limit: usage.cap,
    }, { status: 403 })
  }

  // ── Resolve the product ───────────────────────────────────────────────────
  let asin = extractAsin(input.toUpperCase())
  let productUrl: string | null = /^https?:\/\//i.test(input) ? input : null
  if (!asin && productUrl && /(?:geni\.us|gnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(productUrl)) {
    try {
      const resolved = await resolveFinalUrl(productUrl)
      productUrl = resolved
      asin = extractAsin(resolved)
    } catch { /* keep original */ }
  }
  if (!asin && !productUrl) asin = extractAsin(input)

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
      productTitle = productUrl
    } catch { /* keep what we have */ }
  }
  if (!productTitle) productTitle = input

  // ── Brand voice + recent post titles for hook style mirroring ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: brand }, { data: recentPosts }] = await Promise.all([
    (supabase as any).from('brand_profiles').select('name,author_name,niches,tone,writing_sample,target_audience,words_to_avoid').eq('user_id', user.id).maybeSingle(),
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

  // ── Build the prompt ──────────────────────────────────────────────────────
  const spec = STYLE_SPEC[style]
  const spineLines = spec.spine.map(s =>
    `${s.id} | ${s.label} | ${s.sec}s | ${s.scripted ? 'SCRIPTED (word-for-word)' : 'IMPROVISED (beat direction + talking points)'} | ${s.note}`,
  ).join('\n')

  const shortCutdownBlock = spec.hasShort
    ? `

VERTICAL SHORT CUTDOWN
A separate ~30-55s vertical short that the creator films for TikTok / Reels / YT Shorts. Write it FRESH — not lifted from the long master. Its job is to grab the scroll and pull viewers to the long video on YouTube (without saying so on camera).

The short's hook (first 3 seconds) should do ONE of these:
  (a) Show the unexpected moment — describe the visual; voice catches up after.
  (b) Drop the strongest verdict line — emotion + judgment in 1 sentence.
  (c) Reveal the trade-off as a tease — "There's one thing nobody tells you about this…" curiosity gap.

Pick the one that fits THIS product best. The short's script is verbatim (no improvisation in 30s). 4-6 subject-only shots. No on-camera CTA.`
    : ''

  const promptBody = `You're writing a pre-production script + shot list for the creator's NEXT ${spec.label} video. They'll read this off-camera while filming. Voice it like the creator, not like a brand.

CREATOR
${brandName ? `Channel: ${brandName}` : ''}${authorName ? `\nHost name: ${authorName}` : ''}
${niches.length ? `Niche: ${niches.join(', ')}` : ''}
${audience ? `Audience: ${audience}` : ''}
${tone.length ? `Tone keywords: ${tone.join(', ')}` : ''}
${writingSample ? `Writing sample (match this rhythm + vocabulary):\n"""${writingSample}"""` : ''}
${recentTitles.length ? `Recent video / post titles for hook-style cues:\n${recentTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}` : ''}
${wordsToAvoid.length ? `Words the creator has flagged to avoid: ${wordsToAvoid.join(', ')}` : ''}

PRODUCT
Title: ${productTitle}
${asin ? `Amazon ASIN: ${asin}` : ''}
${productDescription ? `Description:\n${productDescription.slice(0, 700)}` : ''}
${productBullets.length ? `Key bullet points:\n${productBullets.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}` : ''}

STYLE: ${spec.label}
Target total runtime: ${spec.totalSec}s (~${Math.round(spec.totalSec / 60)} min). Per-section durations are guides — honour them within ±20%.

SECTION SPINE (order + id + label + duration + scripted/improvised + intent):
${spineLines}

VOICE RULES (apply across hooks, scripted sections, and the short):
1. First person always. The host IS the creator — never "the reviewer", never third person.
2. Friend who tested it × excited discoverer × expert breakdown. Contractions. Casual phrasing. Intentional imperfection. NEVER sound like an ad-read.
3. HARD BANS — never use ANY of these:
   - "honest", "honestly", "honesty" (any form)
   - "in today's video", "hey guys", "what's up everyone", "welcome back"
   - "subscribe", "smash the like", "don't forget to", "hit that bell"
   - "game-changer", "mind-blowing", "next-level", "absolute banger"
4. NEVER mention competitor product names. The review stands on its own. No "vs the [other brand]" anywhere.
5. NEVER speak the price aloud. (Description + pinned comment handle the price.)
6. NEVER mention "link in description / pinned comment / below". NEVER plug another video, channel, full review, deep dive, or any other content the viewer should go watch. NO on-camera CTA in any form. Lines like "full breakdown is up on our channel", "watch the full review", "head to our channel", "more on the channel", "we cover that in the long version" are all banned in BOTH the long master AND the short cutdown. Also BANNED in the close beat: "see you in the next one", "see you next time", "catch you in the next video", "until next time", "see you soon", "see you then" — these are subscribe-bait sign-offs even though they don't name a CTA. The close beat is ONE clean line that's either brand-affirming or product-reflective — NEVER future-content-pointing. Good close patterns: brand identifier with a wry frame ("We're <hosts> — we <tag line related to the niche>"), product reflection ("And that's the chair."), wry observation about the test ("Five hours in this thing and we're not complaining."). Pick a pattern that lands, do NOT end on a sign-off pitch of any kind.
7. NEVER fabricate specs, features, numbers, materials, or experiences not in the product info above. Hard rule: do NOT name specific NUMERIC specs (degrees, watts, decibels, mAh, hours, mph, RPM) or specific MECHANISM TYPES (vibration motor, brushless motor, planetary gear, magnetic latch) unless they appear VERBATIM in the product info above. If a detail isn't in the info, use qualitative language instead — "leans back nicely", "the massage function is subtle", "the build feels solid" — never "135-degree recline", never "small vibration motor".
8. Punchy spoken sentences. Read for the ear, not the page.
${writingSample ? '9. MIRROR the rhythm of the writing sample above. Same sentence lengths, same opener style.' : ''}

HOOK STRATEGY (3 variants the creator picks from)
Write 3 distinct opening hooks for the long master. Each must be a verbatim 10-15s opener (the creator reads it off-camera). The 3 styles to cover:
  • Variant 1 — PROBLEM-FIRST. "My old [thing] kept doing [problem]…" The buyer recognises themselves. Names a real pain.
  • Variant 2 — QUESTION / WAIT-FOR-IT. "Is this $X thing actually any good?" or "I wasn't sure about this until…" Curiosity gap.
  • Variant 3 — TRADE-OFF TEASE. "There's one thing nobody tells you about this…" or "I almost returned this, then I tried it for [use case]…" Surfaces a real flaw upfront to build trust.

GRANULARITY
- SCRIPTED sections (hook + verdict + who-it's-for + close) → \`script\` is word-for-word the creator can read off-camera. \`talkingPoints\` is empty array.
- IMPROVISED sections (everything else) → \`script\` is an empty string. \`talkingPoints\` is 2-3 short bullet-style lines: what to cover + an optional sample line. Concrete, not generic.

SHOT LIST
- HARD CAP: ${spec.shotCount.min}-${spec.shotCount.max} TOTAL shots across the entire video. Going over is a failure — keep it shootable in a single session.
- Distribute with weight: 0-1 on hook, 1 on context, 1-2 on unbox, 2 on build, 2-3 on EACH real-use test, 1-2 on verdict, 0-1 on close. Real-use tests are where shots earn their place; the close usually needs none.
- Subject only — "close-up of the side button" / "hands-on hero of the device on the desk" / "wide shot of the host turning it over". NO camera angles. NO lighting cues. NO framing notes. The creator decides those on the day.
- Each shot is a single short phrase. No duplicates across the video.
${shortCutdownBlock}

OUTPUT
Return ONLY a single JSON object with NO prose around it, NO markdown fences. Shape EXACTLY:

{
  "summary": "<two-sentence TL;DR of the video for the creator>",
  "totalDurationSec": <integer near ${spec.totalSec}>,
  "hooks": [
    "<verbatim problem-first hook>",
    "<verbatim question / wait-for-it hook>",
    "<verbatim trade-off tease hook>"
  ],
  "sections": [
    {
      "id": "<exact id from the spine>",
      "label": "<exact label from the spine>",
      "durationSec": <integer>,
      "script": "<verbatim voiceover OR empty string if improvised>",
      "talkingPoints": ["<beat / line 1>", "<beat / line 2>", "<beat / line 3>"],
      "shots": ["<shot 1>", "<shot 2>"]
    }
    // one per spine row, IN ORDER
  ]${spec.hasShort ? `,
  "shortCutdown": {
    "hook": "<verbatim first 3-5s opener>",
    "script": "<verbatim 25-55s short script>",
    "shots": ["<shot 1>", "<shot 2>", "<shot 3>", "<shot 4>"],
    "durationSec": <integer 30-60>
  }` : ''}
}`

  let parsed: ScriptPayload
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5500,
      messages: [{ role: 'user', content: promptBody }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier: usage.tier, feature: 'script_generate', model: 'claude-sonnet-4-6' })
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

  // ── Belt-and-braces scrub of the hard-banned phrases ──────────────────────
  // The prompt forbids these but a stray slip from the model would leak through.
  // We scrub them post-hoc rather than re-prompting on detection (cost guard).
  //
  // Channel-plug family is its own block — caught a "Full breakdown is up on
  // our channel" leak in Alejandro's test run that the original "link in
  // description" pattern didn't reach. Any sign-off pointing the viewer to
  // another video / channel / breakdown is an on-camera CTA we banned.
  const BANNED_PATTERNS: Array<[RegExp, string]> = [
    [/\b(?:honestly|honesty|honest)\b/gi, ''],
    [/\b(?:hey guys|what['’]s up everyone|welcome back)\b[\s,.!]*/gi, ''],
    [/\b(?:in today['’]s video|in this video,?)\b[\s,.!]*/gi, ''],
    [/\b(?:smash (?:that|the) like|hit (?:that|the) bell|don['’]t forget to (?:like|subscribe))\b[\s,.!]*/gi, ''],
    [/\b(?:link in (?:the )?(?:description|bio|below)|check the description)\b[\s,.!]*/gi, ''],
    [/\b(?:game[- ]changer|mind[- ]blowing|next[- ]level|absolute banger)\b/gi, 'really good'],
    // Channel / video-plug sign-offs.
    [/[^.!?]*\b(?:full (?:breakdown|review|video|deep dive|version)|deep dive|long version)[^.!?]*\b(?:up on (?:our|the|my) channel|on (?:our|the|my) channel|in the (?:full )?video|over (?:on|at) (?:our|the|my) channel)[^.!?]*[.!?]?/gi, ''],
    [/[^.!?]*\b(?:watch the full|head (?:over )?to (?:our|the|my) channel|more (?:on (?:our|the|my) channel|videos like this))[^.!?]*[.!?]?/gi, ''],
    [/[^.!?]*\b(?:we (?:go (?:deeper|into more detail)|cover (?:more|that)) (?:in (?:the )?full|on (?:our|the|my) channel))[^.!?]*[.!?]?/gi, ''],
    // Soft-sign-off subscribe-bait family ("see you in the next one" etc.).
    // These don't explicitly name a CTA but they're the YouTube-vernacular
    // tell. Whole-sentence scrub so the close beat doesn't end on them.
    [/[^.!?]*\b(?:see (?:you|ya) (?:in the next (?:one|video)|next time|soon|then|on the next one)|catch (?:you|ya) (?:in the next (?:one|video)|next time)|until (?:next time|the next one))[^.!?]*[.!?]?/gi, ''],
    [/[^.!?]*\bwe['’]ll (?:see (?:you|ya)|catch (?:you|ya)) (?:in the next (?:one|video)|next time|soon|on the next one)[^.!?]*[.!?]?/gi, ''],
  ]
  const scrub = (s: string) => {
    let out = s
    for (const [pat, replacement] of BANNED_PATTERNS) out = out.replace(pat, replacement)
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()
  }

  // ── Shape-coerce & scrub ──────────────────────────────────────────────────
  const hooksRaw = Array.isArray(parsed.hooks) ? parsed.hooks : []
  const hooks: string[] = hooksRaw.slice(0, 3).map(h => scrub(String(h ?? ''))).filter(Boolean)
  // Pad to 3 with the first variant if the model returned fewer (rare).
  while (hooks.length < 3 && hooks.length > 0) hooks.push(hooks[0])

  const sections: ScriptSection[] = Array.isArray(parsed.sections)
    ? parsed.sections.map((s, i) => ({
        id: typeof s.id === 'string' ? s.id : `section_${i}`,
        label: typeof s.label === 'string' ? s.label : `Section ${i + 1}`,
        durationSec: Number.isFinite(s.durationSec) ? Math.max(5, Math.min(900, s.durationSec)) : 30,
        script: typeof s.script === 'string' ? scrub(s.script) : '',
        talkingPoints: Array.isArray(s.talkingPoints) ? s.talkingPoints.map(x => scrub(String(x))).filter(Boolean).slice(0, 4) : [],
        shots: Array.isArray(s.shots) ? s.shots.map(x => String(x).trim()).filter(Boolean).slice(0, 6) : [],
      }))
    : []

  let shortCutdown: ShortCutdown | undefined
  if (spec.hasShort && parsed.shortCutdown && typeof parsed.shortCutdown === 'object') {
    const sc = parsed.shortCutdown
    shortCutdown = {
      hook: scrub(typeof sc.hook === 'string' ? sc.hook : ''),
      script: scrub(typeof sc.script === 'string' ? sc.script : ''),
      shots: Array.isArray(sc.shots) ? sc.shots.map(x => String(x).trim()).filter(Boolean).slice(0, 8) : [],
      durationSec: Number.isFinite(sc.durationSec) ? Math.max(20, Math.min(75, sc.durationSec)) : 45,
    }
  }

  const cleaned: ScriptPayload = {
    summary: scrub(typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : ''),
    totalDurationSec: Number.isFinite(parsed.totalDurationSec) ? parsed.totalDurationSec : sections.reduce((sum, s) => sum + s.durationSec, 0),
    hooks: hooks.length > 0 ? hooks : ['', '', ''],
    sections,
    ...(shortCutdown ? { shortCutdown } : {}),
  }

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

  // Usage figures the page can render without a refetch.
  const nextUsed = (usage.used ?? 0) + 1
  const usageOut = {
    used: nextUsed,
    cap: usage.cap,
    remaining: usage.cap === null ? null : Math.max(0, usage.cap - nextUsed),
    resetLabel: usage.resetLabel,
  }

  if (insertErr || !row) {
    console.warn('[script/generate] persist failed:', insertErr?.message)
    return NextResponse.json({ ok: true, script: cleaned, asin, productTitle, productImage, persisted: false, usage: usageOut })
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
    usage: usageOut,
  })
}
