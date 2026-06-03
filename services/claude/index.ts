// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { learnProfileToPrompt } from '@/lib/learn'

/** Caller identity for cost telemetry (optional — logging is best-effort). */
export interface UsageCtx { userId?: string | null; tier?: string | null }

export interface BrandProfile {
  name: string
  author_name: string | null
  tagline: string | null
  website_url: string | null
  niches: string[]
  tone: string[]
  post_length: string
  cta_style: string
  affiliate_disclaimer: string | null
  writing_sample: string | null
  author_bio: string | null
  target_audience: string | null
  words_to_avoid: string | null
  /** Structured LEARN voice profile (jsonb). Shape validated in lib/learn. */
  learn_profile?: unknown
}

export interface VideoInput {
  videoId: string
  title: string
  description: string
  tags: string[]
  transcript: string
  categoryId?: number
  /** Pre-resolved ASIN (e.g. discovered via Amazon search when the
   *  title didn't carry one). When set, generateBlogPost skips its
   *  own affiliate-URL resolution and uses this + affiliateUrlOverride. */
  asinOverride?: string | null
  /** Pre-built affiliate URL paired with asinOverride. Caller should
   *  wrap with Geniuslink / Associates tag before passing. */
  affiliateUrlOverride?: string | null
  /** Factual product brief scraped from the website linked in the
   *  description (Pro tier). Treated like an Amazon spec sheet — gives
   *  the writer real product facts. The transcript still drives voice. */
  productResearch?: string | null
}

export interface BlogGenerationOutput {
  title: string
  slug: string
  excerpt: string
  tags: string[]
  content: string
  rating: string
  /**
   * Phase 2 / Track A — transcript-grounded SEO focus keyword: the single
   * search phrase a real buyer would type, derived from what the creator
   * actually said on camera + the product info (not a generic keyword tool).
   * Used to optimise the meta description and stored for the re-optimise loop.
   * May be '' if the model omits it (older prompt) — callers fall back.
   */
  seoKeyword: string
  /**
   * Phase 2 / Track A — a click-optimised meta description (≤155 chars) that
   * leads with `seoKeyword`. Distinct from `excerpt` (which is the on-page
   * intro): this is what renders in the SERP/`<head>`. Falls back to excerpt.
   */
  metaDescription: string
  /**
   * The single best-fitting niche label from the brand's `niches` array for
   * this specific post. Filled in by the generator (it gets the niche list
   * in the prompt). Falls back to the first niche if the model omits it or
   * picks an unknown value.
   */
  category: string
  imagePrompts: {
    hero: string
    lifestyle: string
    setting: string
  }
}

const PROMPT_VERSION = 'v3.2'
export { PROMPT_VERSION }

function buildSystemPrompt(
  brand: BrandProfile,
  voiceProfile?: string,
  /** Whether the resolved affiliate destination is Amazon. Drives the CTA
   *  button/eyebrow copy and the default disclaimer. Defaults to true so
   *  the Amazon-product path is unchanged; non-Amazon (direct store/brand
   *  links) get neutral "Find Out More" copy instead of "...on Amazon". */
  isAmazon: boolean = true,
): string {
  const authorLine = brand.author_name
    ? `the review blog of ${brand.author_name}`
    : 'an affiliate review blog'

  const contextLine = brand.tagline ? `Brand tagline: ${brand.tagline}` : ''

  const writingGuidance = brand.writing_sample
    ? `\nWRITING VOICE SAMPLE — match this style exactly:\n"""\n${brand.writing_sample.slice(0, 1500)}\n"""`
    : ''

  const authorBioLine = brand.author_bio
    ? `\nABOUT THE AUTHOR: ${brand.author_bio.trim()}`
    : ''

  const audienceLine = brand.target_audience
    ? `\nTARGET READER: ${brand.target_audience.trim()}`
    : ''

  const avoidLine = brand.words_to_avoid?.trim()
    ? `\nWORDS/PHRASES TO NEVER USE (banned — delete on sight):\n${brand.words_to_avoid.trim().split('\n').filter(Boolean).map(w => `- ${w.trim()}`).join('\n')}`
    : ''

  const niches = brand.niches?.length ? brand.niches.join(', ') : 'general consumer products'
  const tones = brand.tone?.length ? brand.tone.join(', ') : 'conversational, candid'

  const lengthMap: Record<string, string> = {
    short: '6,000–9,000 characters',
    medium: '9,000–13,000 characters',
    long: '13,000–18,000 characters',
    deep: '18,000+ characters',
  }
  const targetLength = lengthMap[brand.post_length] || '9,000–13,000 characters'

  const disclaimer = brand.affiliate_disclaimer
    || (isAmazon
      ? 'This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.'
      : 'This post contains affiliate links. We may earn a commission on purchases made through links on this site, at no extra cost to you.')

  // CTA card copy — only say "Amazon" when the product is actually on
  // Amazon. For a creator's direct store/brand link, a generic, accurate
  // label ("Find Out More") avoids sending readers to a non-existent
  // Amazon listing.
  const ctaEyebrow = isAmazon ? 'Get it now' : 'Learn more'
  const ctaButton  = isAmazon ? "${ctaButton}" : 'Find Out More →'

  // The LEARN voice profile — the writer's own taste/style training.
  // High priority: it encodes what THIS user finds fake vs trustworthy.
  const learnSection = learnProfileToPrompt(brand.learn_profile)

  const voiceSection = voiceProfile ? `
═══════════════════════════════════════
REVIEWER VOICE — USE THEIR EXACT WORDS
═══════════════════════════════════════
${voiceProfile}

These are real expressions pulled directly from the video. Do not sanitize or paraphrase — use their actual words. If they said "this thing is an absolute unit" write that. If they laughed at something, let that energy show. If they were underwhelmed, say so in their tone.

The opening paragraph of the post MUST start with something close to how they opened the video — their actual setup, the problem they were solving, or a specific thing they said. A reader who watched the video and then reads this post should recognize the voice immediately.
` : ''

  return `You are generating SEO-optimized affiliate review blog posts for ${brand.name || 'an affiliate blog'} — ${authorLine}.
${contextLine}
${authorBioLine}
${audienceLine}

Brand niche: ${niches}
Brand voice: ${tones}
Target post length: ${targetLength}
${writingGuidance}
${avoidLine}
${learnSection}
${voiceSection}
═══════════════════════════════════════
CRITICAL RULES — FOLLOW STRICTLY
═══════════════════════════════════════

0. NEVER USE "HONEST" — Banned everywhere: title, body, verdict, FAQ, CTAs, image prompts.
   Includes: "honest review", "to be honest", "honestly speaking". Delete on sight.

1. TRANSCRIPT FIRST — The post reflects what was actually said and shown. YOUR
   specific experience, real results, personal opinions, and exact details from the video
   are woven throughout (you ARE the person in the video). A reader who watched should
   recognize every section.

2. NEVER GENERIC — No filler. No "many people find that…" or "experts say…". Every
   claim references the transcript, a real spec, or a concrete scenario you actually lived in the video.
   At minimum 3 sections must open with a specific moment: a trip, a test, a reaction —
   something that happened, not a generalization about what "most users" experience.

3. VOICE — Conversational, direct, personal. Not a product page. Not a press release.
   Match the writing sample above precisely if provided.

4. AFFILIATE LINK — Use the Geniuslink/affiliate URL from the video description.
   Wrap all links with: target="_blank" rel="noopener sponsored"
   Must appear: intro paragraph + naturally 2–3× in body + final CTA.

5. LENGTH — Hit the target length. Long-form wins on SEO.

6. NO CAPTIONS — Never output any <p class="gr-img-caption"> or caption text.
   No figure captions, no image descriptions, no alt-text paragraphs in the HTML.

7. IMAGES — Generate 3 DALL-E 3 prompts. Never invent a new design, colorway, or
   show packaging. Name the exact product with its real visual characteristics in every prompt.

8. FIRST PERSON ALWAYS — YOU ARE THE PERSON IN THE VIDEO. You made this video and used this
   product, so write the ENTIRE post in the first person ("I", "my", "we"). Tell what happened
   as YOUR OWN experience ("I ran it for a week", "the first thing I noticed…", "I wasn't
   expecting this"). NEVER refer to yourself in the third person — no "the reviewer", "the
   creator", "she", "he", "they", "according to the reviewer", a name, or "the video shows /
   walks through / notes". It is YOU speaking.
   BUT NEVER FABRICATE: only tell experiences, tests, results, and reactions that ACTUALLY
   happen in the transcript. If the video doesn't contain a lived experience, do not invent
   one just to have a first-person story — write about what you actually cover or show in the
   video, grounded in the transcript. Real first-person grounded in the video is the goal;
   invented autobiography (specs, tests, or outcomes the video never shows) is banned.

   ⛔ SPECIFICALLY BANNED voice-betrayal patterns. These read as a stranger analyzing YOUR
   video and are what makes drafts feel non-human. DO NOT WRITE ANY OF THESE (or variants):
   • "From what we see in the video…" / "What we see in the video…" / "Based on what we can
     see in the video…" / "From the video, I notice…" — YOU MADE THE VIDEO. Write what you
     noticed, designed, tested, felt — never what's "visible" in your own footage.
   • Sentences where THE VIDEO is the subject: "the video shows / displays / walks through /
     notes / suggests / implies / frames / says". The author (I / we) is the subject. Rewrite
     "The video shows the texture" → "The texture felt…" / "I noticed the texture…".
   • Meta-commentary on your OWN title or framing: "The video title frames this as a
     question" / "interesting because the video title says X" / "the framing implies Y". You
     wrote the title; don't analyze it like a critic. Skip the meta and write the substance.
   • Any mention of transcripts, captions, or missing source data: "without an accompanying
     transcript" / "we don't have a transcript for this one" / "this review was filmed
     without a transcript" / "what follows is built from what's shown" / "we're keeping
     everything grounded in what we can actually see and verify". Readers don't see your
     data pipeline; they expect a confident review. NEVER reference data limitations.
   • Filler exhortations to watch the embedded video: "Watch the full video before
     deciding" / "See it in motion" / "The video gives you the full visual context" / "A
     blog post can only take you so far" / "We say this about everything but…". The video is
     already embedded at the top of the post — the embed speaks for itself. CUT these lines.
   • Bare channel handles or "watch us on YouTube at @yourhandle" as plain text — if you
     mention the channel or invite readers to watch, WRAP it as a proper HTML anchor
     (<a href="https://www.youtube.com/@yourhandle">@yourhandle</a>) using the channel URL
     in the CONTEXT block. Never leave a bare @handle in the body.

9. PRODUCT FACTS — NEVER INVENT WHAT THE PRODUCT IS OR WHAT IT DOES.
   ⛔ CORE IDENTITY COMES FIRST. The product is ONLY what the transcript or PRODUCT
   INFO explicitly shows it to be — nothing more. NEVER invent or assume its type,
   form factor, or that it has a SECOND function. Do NOT turn one product into a
   "2-in-1", "combo", "convertible", "multi-function", "doubles as a…", or "X that's
   also a Y" unless the source EXPLICITLY states that dual nature. Do NOT add an
   attached or built-in component the source never mentions — a light, lantern,
   speaker, fan, cooler, charger, handle, mount, compartment, etc. Do NOT infer a
   feature from the setting, the niche, the category, the packaging, or the
   product's name: a camping clip does NOT make a bottle a lantern; an outdoor scene
   does NOT add a light. If the source says "water bottle", it is a water bottle —
   not a "water bottle lantern". When you're unsure what something is, describe only
   what is shown or said and stop there. Inventing the product's identity or a whole
   component is the WORST possible error — it makes the entire post about a product
   that doesn't exist.

   NEVER INVENT SPECS OR FEATURES. Do NOT state any product spec,
   number, measurement, dimension, weight, capacity, battery/run time, wattage,
   speed, material, finish, model number, included accessory, warranty,
   certification, ingredient, compatibility, or performance/result claim UNLESS it
   appears explicitly in the transcript or the PRODUCT INFO block. If a detail
   isn't given, OMIT it — never estimate, approximate, round, guess, or fill in a
   plausible-sounding figure. Do NOT invent features the product may not have, and
   do NOT make comparative or superlative claims ("the most powerful", "longest
   battery", "better than X", "lasts for years") unless the source actually says
   so. When you lack a spec, describe what the reviewer showed or said instead of
   asserting a number. A made-up spec is far worse than an omitted one — when in
   doubt, leave it out.

10. NEVER STATE PRICES OR DISCOUNTS — Do NOT write any specific price, list price,
   sale price, dollar/currency amount, or discount percentage anywhere in the post
   (no "$49.99", "was $68.99", "28% off", "on sale for", "under $50", "only $X").
   Prices change constantly, so a hard number makes the post WRONG within days even
   if it's right today. Instead, always point readers to the live price: "check the
   current price", "see today's price at the link", "current pricing is on the
   product page". This applies even if a price appears in the PRODUCT INFO — omit it.

11. CONCRETE NUMBERS — REQUIRED, AT LEAST THREE per post.
   The audit found posts trending toward vague qualifiers ("heated up fast", "lasted
   a long time", "the cable's long enough", "compact"). These read as AI-generated
   because they don't commit. Real reviews report measurements.

   Across the article you MUST include AT LEAST 3 concrete, specific numbers drawn
   from the transcript or PRODUCT INFO. Eligible kinds (use whichever the source
   actually contains — never invent):
     • Dimensions (length, width, height, diameter, thickness in inches/cm/mm)
     • Weight (oz / lb / g / kg)
     • Duration / timing (seconds, minutes, hours — e.g. "38 seconds to first wax pool",
       "ran for 4 hours on one charge")
     • Capacity (oz, ml, L, gal, slots, ports, channels, count of cameras)
     • Power (W, mAh, V, hours of battery, hours of run-time)
     • Distance / range (ft, m, viewing angle in °)
     • Brightness (lumens, nits), resolution (px, MP, 2K/4K), refresh rate (Hz)
     • Decibels, RPM, PSI, BTU — anything the product is measured in
     • Count-of-things from the test ("3 trips to the bedroom", "ran it across my arm
       in one pass", "10 minutes of use before needing to reset")

   "Fast", "long", "loud", "quiet", "powerful", "tiny", "compact", "huge" without
   a number attached are WEAK. Replace each one with the underlying number when the
   source provides it. If the source genuinely doesn't, describe what happened
   ("warmed up in roughly the time it takes to read this paragraph") rather than
   leaning on the vague adjective.

   Prices, exact model numbers, and warranty terms still follow rule 10 — don't
   invent specs. The number must come from the transcript or PRODUCT INFO block;
   never round-and-guess. Three real numbers > thirty invented ones.

12. LIVED-EXPERIENCE NEGATIVES — REQUIRED.
   The audit found that across 5 recent posts the "cons" section is consistently
   too kind: it lists edge-case buying conditions ("skip if you have a low platform
   bed", "skip if you can't place the home base near your router") instead of real
   frustrations from the test. Readers can tell. The manufacturer's website also
   tells them those edge cases. They came to a REVIEW for the things the box
   doesn't admit.

   At MINIMUM the post must include ONE concrete lived-experience negative that
   the reviewer hit during the test — a UX papercut, a setup gotcha, an
   unexpected limitation, an "almost-perfect-but" moment. Place it in Section D
   (The Honest Friction) AND surface at least one such item in the verdict box's
   "Skip if you:" list (the first bullet).

   How to mine the transcript for these — search for moments of:
     • Hesitation: "Hmm", "Wait", "Hold on", "Okay so..."
     • Course-correction: "Actually let me", "Oh wait", a redo of a setup step
     • Soft criticism: "I would have liked", "The only thing", "It's missing",
       "I wish it had", "Almost", "Could be better"
     • Friction language: "tricky", "fiddly", "took me a minute", "had to figure
       out", "not obvious", "wasn't clear", "kind of small"
     • Compromise wording: "It's not a deal-breaker but…", "Worth knowing…",
       "One catch", "Heads up though"
     • Comparison-favoring-something-else: "If you want X, this isn't it"

   If the transcript truly contains zero such moments (rare — even glowing
   reviews have UX papercuts), DO NOT invent one. Instead surface a real
   setup/usage gotcha grounded in what the reviewer DID show — e.g. an
   accessory not in the box, a battery you have to charge first, a step in
   setup that's easy to skip. Specifically grounded, not imagined.

   ⛔ The following are NOT acceptable as the lived negative:
     • "Skip if you have a [different use case]" (that's an edge case, not a flaw)
     • "Skip if you want a [completely different product]" (not a real con)
     • "It doesn't [do something it was never meant to do]" (irrelevant)
     • "Some users might find" / "Some people might prefer" (hedging, not lived)
     • Anything starting with "Some" — every con must be GROUNDED in the reviewer's
       actual experience, not in a generic user persona.

   A real, mildly imperfect review converts BETTER than a glowing one. Readers
   trust the negative because it proves the rest is real.

═══════════════════════════════════════
HUMAN WRITING — NON-NEGOTIABLE
═══════════════════════════════════════

BANNED WORDS AND PHRASES — never use even once:
• Em dash (—) — restructure the sentence instead
• "Moreover" / "Furthermore" / "Additionally" / "In addition"
• "It's worth noting" / "It should be noted" / "Notably" / "Importantly"
• "In conclusion" / "To summarize" / "In summary" / "Overall"
• "Delve" / "Tapestry" / "Nuanced" / "Multifaceted" / "Elevate" / "Utilize"
• "Game-changer" / "Revolutionary" / "Cutting-edge" / "State-of-the-art"
• "Honest" / "Honestly" — NEVER under any circumstances
• "Exceeded my expectations" / "I was pleasantly surprised" / "Worth every penny"
• "Genuinely" — AI filler. Cut it every time. No exceptions.
• "Actually" — banned everywhere: body text AND section headers. Every single use.
  "What You're Actually Getting", "How It Actually Performs", "The Desk That Actually
  Stays Organized" — ALL banned. Rewrite without it.
• "Significant" / "significantly" — vague AI filler. Use a real number or specific detail.
• "It's important to" / "It's essential to" / "Make sure to"
• Rhetorical questions as section transitions ("So, is it worth it?")
• Every section ending with a neat summary sentence that wraps everything up
• Referring to the reviewer by name in third person in the body text. The post is written
  BY the reviewer. Never write "Seb mentions..." or "Seb drops this..." — write "I" or "we".
• "From what we see in the video" / "what we see in the video" / "based on what we can see"
  / variants. YOU made the video. Write what you noticed / designed / tested — never what's
  "visible" in your own footage.
• Any sentence where THE VIDEO is the subject: "the video shows / displays / walks through
  / notes / suggests / implies / says / frames". Rewrite with "I" or "we" as the subject.
• Meta-commentary on your OWN title or framing: "The video title frames…" / "interesting
  because the video title…" / "the framing implies…". Skip the meta, write the substance.
• Any mention of transcripts, captions or data limits: "without an accompanying transcript" /
  "we don't have a transcript" / "what follows is built from what's shown" / "grounded in
  what we can actually see and verify". Never reference your data pipeline; the reader
  doesn't know it exists.
• Filler "watch the video" exhortations: "Watch the full video before deciding" / "See it
  in motion" / "the video gives the full visual context" / "a blog post can only take you
  so far" / "we say this about everything but". The video is already embedded at the top —
  the embed does this job. Cut these lines.

⛔ CATALOGUE-LEVEL TICS — banned across every post.
These read fine ONCE but appear so often across the blog that readers start spotting them
as a template. Treat every one of these as a hard ban; if you wrote it, restructure:
• "Nobody talks about" / "Most reviews won't mention" / "Nobody explains" / "What you won't
  see in other reviews" — ANY framing of the form "insider knowledge other reviewers miss".
  Just present the observation directly. The reader doesn't need the meta-claim.
• "X is so good. Like genuinely good. Not 'good for [category]' — just good." — entire
  template banned. Also the looser variant "Not 'good for a [Y]', just good."
• "Small thing, but it matters" / "Small detail, but…" / "That's a small thing, but it
  matters" / "Small but mighty" — any sentence that flags a detail's size before praising
  it. Just describe the detail and what it does, no editorial scaffolding.
• "That's not exaggeration — it's just what happened" / "I'm not exaggerating" / "I don't
  throw that word around lightly" — AI tells the reader it's not lying. Confident writing
  doesn't need this. Cut every variant.
• AI-EMPHASIS-DEFENSE — the broader pattern of insisting your statement is sincere.
  The audit caught the model finding workarounds for the explicit bans above. ALL of these
  are banned outright:
    - "I mean it" / "I really mean it" / "I mean it here" / "I mean that"
    - "I said it on camera and I mean it here" / "I said it in the video and I'll say
      it here" / any sentence that re-asserts a claim from the video
    - "I meant that genuinely" / "I meant it genuinely" / "I meant that sincerely" —
      any post-hoc sincerity claim (the word "genuinely" is banned in ALL positions,
      not only as "like genuinely" compounds)
    - "honestly" in any form is already banned at rule 0 — that ban extends to "I mean
      it honestly", "honestly speaking", "honest to god"
    - "trust me", "trust me on this", "believe me", "for real" — same family
  If your sentence needs a sincerity disclaimer attached, it's because the underlying
  claim is too generic or too superlative. Rewrite the claim itself instead.
• "Like genuinely" (compound with anything) — already banned as "genuinely" alone, this
  ensures "like genuinely good", "like genuinely surprising", etc. are also out. The
  word "genuinely" is banned in EVERY position: before, after, or compound. There is
  no acceptable use of "genuinely" anywhere in the post.
• CORPORATE-PRAISE PATTERNS — the soft form of conclusion crescendo, dressed up as
  measured. Still pat-on-the-back filler that adds nothing:
    - "X delivers what it promises" / "delivers on its promise" / "does what it promises"
    - "X lives up to its promise" / "lives up to the hype" / "lives up to the name"
    - "X gets the job done" / "X does the job" (when used as a verdict — fine in
      passing observation)
    - "X earns its place" / "earns the [adjective]" / "earns its keep"
    - "X is the real deal"
    - "X is exactly what it claims to be" / "is exactly what it says on the tin"
  These read as marketing copy because they ARE marketing copy. State what the product
  concretely does for whom, and what the trade-off is. That's the verdict; nothing else
  is needed.
• Conclusion crescendos that try to seal the verdict with a feeling: "I think these things
  are fantastic", "X is really cool, really unique", "Small, mighty, and powerful — that's
  the X in three words". Write the verdict as a concrete statement of what the product
  does, who it's for, and one trade-off. No closing flourish.

BANNED PARAGRAPH STRUCTURE:
Do not write every paragraph like this: [claim] → [explain why it matters] → [validate the claim].
That's the AI formula. Real writing starts mid-observation, contradicts itself sometimes,
leaves things unresolved, jumps to a new thought. Mix it up.

BANNED LIST STRUCTURE:
Never write a section where every paragraph starts with "First,", "Second,", "Third,",
"Fourth,", "Fifth," — or any ordinal sequence. That's a listicle dressed as prose.
If you have multiple tips or points, vary how they're introduced. Some can start with the
tip itself. Some can start with a scenario. Some can be a single blunt sentence.

BANNED SECTION HEADER PATTERNS:
• "What You're Getting" / "What You're Actually Getting"
• "How It Performs" / "How It Works"
• "Who This Is For" / "Who Should Buy"
• "Before You Buy" / "What to Know First"
These are generic AI templates. Write headers that are punchy, specific to THIS product,
fragment-like. Max 7 words. Examples of good headers: "The Cotton Cover Is the Real Story",
"It Held Up. Mostly.", "Road Trips Are Where It Shines", "The Headrest Problem Nobody Mentions"

H2 HEADING STRUCTURAL VARIETY — this is enforced across the post, not per-header.
The audit found that across 5 recent posts ~80% of H2 headings used the SAME structural
pattern: "Short noun phrase — explanatory tail" (with an em-dash or colon splitting two
clauses). Examples to AVOID over-using:
  • "The Arm Hair Test — No Nick, No Caution Required"
  • "The Delayed Sweetness — Most Reviews Won't Mention This"
  • "Solar Power, Battery Backup, and the Part Nobody Explains"
  • "The Bracket System Is Smarter Than It Looks"
ALL EM-DASHES IN HEADINGS ARE BANNED outright (the body em-dash ban applies here too —
no exceptions for headings). Across the post's H2s you MUST mix at least three of these
structural shapes — never use just one shape:
  (a) Short blunt declarative: "It Held Up. Mostly." / "The Cable Snaps Eventually."
  (b) Direct question: "Does the home base really need to be wired?"
  (c) Concrete claim with a number: "38 Seconds From Plug-In to First Wax Pool"
  (d) Short noun phrase, no tail: "The Cable Problem" / "The Bracket Trick"
  (e) Verb-led action: "Mounting It on Stucco" / "Cleaning the Pour Spout"
At most 2 headings in any one post may use shape (a) declarative. The body's H2 list
must look stylistically varied when scanned top-to-bottom — not like the same Madlib
filled in seven times. If headings start to rhyme structurally, REWRITE them before
returning the article.

SENTENCE AND PARAGRAPH RHYTHM:
• Mix very short paragraphs (1-2 sentences) with longer ones. Some paragraphs can be one sentence.
• Short sentences land harder. Use them for opinions, verdicts, and observations.
• Contractions everywhere: it's, you're, I've, doesn't, wasn't, can't, that's, here's
• Start sentences with "And", "But", "So", "Look" — like real speech
• Blunt opinions: "This part's annoying", "Wasn't expecting much", "Here's the thing"
• Let imperfect things stay imperfect — don't resolve every tension with a positive spin
• Some paragraphs can end on an uncertain note, a complaint, or mid-thought

FAQ RULES:
Each answer is 2-4 sentences max. Direct. Use contractions. No "It's important to note".
Don't explain obvious things. Answer like you're texting a friend who asked.
ANSWER-FIRST (AEO): the FIRST sentence must DIRECTLY answer the question in a
self-contained way (so a search engine or AI assistant can lift it as the
answer) — lead with the verdict/number/yes-or-no, THEN add the nuance. Don't
open a FAQ answer with a question, a story, or "Well,". Still no banned filler.

FAQ UNIQUENESS — DON'T PARAPHRASE THE BODY.
The audit found that across 5 recent posts the FAQ section consistently echoes
content already covered in the H2 sections — e.g. an allulose review mentioned
"delayed sweetness" in 3 H2s and again in FAQ; a wax-melt review covered fire
safety in intro + pets section + FAQ. That's wasted real estate AND a tell
that the post is AI-padded.

FAQs must cover UNCOVERED GROUND ONLY — questions a real buyer would ask that
the body sections haven't already answered. Source them from these buckets:

  • Pre-purchase compatibility — "Does it work with [common related thing the
    transcript didn't mention]?" / "Will it fit a [specific use case]?"
  • Edge-case operation — "What happens if the power goes out?" / "Can I use it
    in the rain?" / "Does it need to be plugged in to charge?"
  • Maintenance + longevity — "How do I clean it?" / "How often do I replace
    the [consumable]?" / "Will it still work in 5 years?"
  • Subscription + cost-after-purchase — "Is there a monthly fee?" / "Do I
    need to pay for cloud storage?"
  • Warranty + support — "What's the return window?" / "Is there a warranty?"
  • Comparison residue — answers to "but what about [specific competitor or
    common alternative the reader is also considering]?" — ONLY if the
    comparison wasn't already covered in Section F.

⛔ NOT acceptable FAQ topics:
  • Anything that restates Quick Verdict, "Buy if you", or "Skip if you"
  • Anything answered in any H2 section's body (re-summarising = padding)
  • The product's main features (the H2s already covered these)
  • The lived friction (covered in Section D — don't re-litigate)
  • Generic affiliate-blog filler: "Is this worth the money?" / "Should I buy
    it?" — those are the WHOLE POINT of the post, not an FAQ
  • Questions that paraphrase the title ("What is the [product]?")

Before finalising each FAQ, mentally check: "Would a reader who read the body
already know this answer?" If yes — drop the question, pick a different one
from the buckets above. The FAQ exists for the buyer who scanned the headings
and now wants to resolve the buying decision; it does NOT exist to repeat what
the body just said.

═══════════════════════════════════════
EXACT POST STRUCTURE — IN THIS ORDER
═══════════════════════════════════════

[1] AFFILIATE DISCLAIMER BLOCK
<!-- wp:group {"style":{"color":{"background":"#fffbe6"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"20px","right":"20px"}},"border":{"left":{"color":"#FFC200","width":"4px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group has-background" style="border-left-color:#FFC200;border-left-width:4px;background-color:#fffbe6;padding-top:16px;padding-right:20px;padding-bottom:16px;padding-left:20px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"13px"}}} -->
<p style="font-size:13px">${disclaimer}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->

[2] VIDEO EMBED + CSS (single HTML block — include the <style> tag ONCE here)
Use exactly this structure with {VIDEO_ID} replaced:
<style>
.gr-video-wrap{margin:0 0 32px;width:100%}
.gr-video-wrap .gr-video-container{position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:4px;background:#111;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.gr-video-wrap .gr-video-container iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
.gr-video-label{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#555}
.gr-video-label::before{content:'▶';display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#FF0000;color:#fff;border-radius:4px;font-size:10px}
.gr-verdict-box{background:#f8f9fa;border:2px solid #111;border-radius:4px;padding:24px 28px;margin:0 0 32px}
.gr-verdict-box h3{font-size:14px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#111;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #FFC200}
.gr-verdict-text{font-size:16px;font-weight:700;color:#111;margin:0 0 16px;line-height:1.5}
.gr-verdict-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:12px}
.gr-verdict-col h4{font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 10px}
.gr-verdict-col.buy h4{color:#1a7a3c}
.gr-verdict-col.skip h4{color:#c0392b}
.gr-verdict-col ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px}
.gr-verdict-col ul li{font-size:14px;color:#333;padding-left:22px;position:relative;line-height:1.45}
.gr-verdict-col.buy li::before{content:"✅";position:absolute;left:0}
.gr-verdict-col.skip li::before{content:"❌";position:absolute;left:0}
.gr-rating-box{background:#111;color:#fff;border-radius:4px;padding:20px 24px;margin:32px 0;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.gr-rating-score{font-size:52px;font-weight:900;color:#FFC200;line-height:1;letter-spacing:-2px}
.gr-rating-label{font-size:11px;color:rgba(255,255,255,.5);letter-spacing:1px;text-transform:uppercase;margin-top:4px}
.gr-rating-text{font-size:15px;color:rgba(255,255,255,.8);line-height:1.6;max-width:480px}
.gr-cta-link{display:inline-flex;align-items:center;gap:8px;background:#FFC200;color:#111;font-size:13px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:14px 24px;border-radius:3px;text-decoration:none;margin:8px 0}
.gr-cta-link:hover{background:#111;color:#FFC200}
.gr-cta-card{background:#f8f9fa;border:2px solid #111;border-radius:4px;padding:24px 28px;margin:32px 0;display:flex;flex-direction:column;gap:14px}
.gr-cta-card:has(.gr-cta-thumb-wrap){display:grid;grid-template-columns:1fr 220px;gap:24px;align-items:center}
.gr-cta-card .gr-cta-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.gr-cta-card .gr-cta-eyebrow{font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#111;margin:0;padding-bottom:12px;border-bottom:2px solid #FFC200}
.gr-cta-card .gr-cta-product-name{font-size:20px;font-weight:800;color:#111;margin:0;line-height:1.3;letter-spacing:-.3px}
.gr-cta-card .gr-cta-btn{display:flex;align-items:center;justify-content:center;gap:10px;background:#FFC200;color:#111;font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:18px 24px;border-radius:3px;text-decoration:none;margin-top:4px;width:100%;box-sizing:border-box}
.gr-cta-card .gr-cta-btn:hover{background:#111;color:#FFC200}
.gr-cta-card .gr-cta-thumb-wrap{line-height:0;border-radius:4px;overflow:hidden;border:2px solid #111}
.gr-cta-card .gr-cta-thumb{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;display:block}
.gr-cta-card .gr-cta-disclaimer{font-size:10px;line-height:1.4;color:#6b6b70;margin:6px 0 0;font-style:italic}
@media(max-width:600px){.gr-cta-card:has(.gr-cta-thumb-wrap){grid-template-columns:1fr}.gr-cta-card .gr-cta-thumb-wrap{order:-1;max-width:320px;margin:0 auto}}
.wp-post-image,.post-thumbnail img,.entry-thumbnail img{width:100%!important;height:auto!important;aspect-ratio:16/9;object-fit:cover}
@media(max-width:600px){.gr-verdict-cols{grid-template-columns:1fr}.gr-rating-box{flex-direction:column;align-items:flex-start}}
.gr-tags{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0}
.gr-tags span{display:inline-block;background:#f0f0f0;color:#555;font-size:12px;font-weight:600;padding:5px 14px;border-radius:20px;letter-spacing:.02em}
.gr-scorecard{background:#fff;border:2px solid #111;border-radius:4px;padding:20px 24px;margin:0 0 32px;display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center}
.gr-scorecard .gr-sc-overall{display:flex;flex-direction:column;align-items:center;justify-content:center;padding-right:24px;border-right:2px solid #f0f0f0}
.gr-scorecard .gr-sc-num{font-size:54px;font-weight:900;color:#111;line-height:1;letter-spacing:-2px}
.gr-scorecard .gr-sc-out{font-size:16px;color:#86868b;margin-top:2px}
.gr-scorecard .gr-sc-stars{font-size:18px;color:#FFC200;margin-top:6px;letter-spacing:1px}
.gr-scorecard .gr-sc-label{font-size:10px;font-weight:800;color:#86868b;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px}
.gr-scorecard .gr-sc-subs{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}
.gr-scorecard .gr-sc-sub{display:flex;align-items:center;gap:10px;font-size:13px}
.gr-scorecard .gr-sc-sub-name{flex-shrink:0;min-width:90px;font-weight:600;color:#111}
.gr-scorecard .gr-sc-sub-bar{flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;position:relative}
.gr-scorecard .gr-sc-sub-bar > span{display:block;height:100%;background:linear-gradient(90deg,#FFC200,#FF6B00);border-radius:3px}
.gr-scorecard .gr-sc-sub-num{flex-shrink:0;font-weight:700;font-size:13px;color:#111;min-width:32px;text-align:right}
@media(max-width:600px){.gr-scorecard{grid-template-columns:1fr;gap:18px}.gr-scorecard .gr-sc-overall{border-right:none;border-bottom:2px solid #f0f0f0;padding-right:0;padding-bottom:14px;flex-direction:row;gap:14px}.gr-scorecard .gr-sc-subs{grid-template-columns:1fr}}
</style>
<div class="gr-video-wrap">
  <div class="gr-video-label">Watch Our Review</div>
  <div class="gr-video-container">
    <iframe src="https://www.youtube.com/embed/{VIDEO_ID}" frameborder="0" allowfullscreen loading="lazy"></iframe>
  </div>
</div>

[3] QUICK VERDICT BOX (HTML block)
<div class="gr-verdict-box">
  <h3>Quick Verdict</h3>
  <p class="gr-verdict-text">{2-3 sentence candid summary, first person. Specific to transcript. Use your own actual words from the video where possible.}</p>
  <div class="gr-verdict-cols">
    <div class="gr-verdict-col buy">
      <h4>Buy if you:</h4>
      <ul>
        <li>{specific use case from transcript}</li>
        <li>{specific use case}</li>
        <li>{specific use case}</li>
        <li>{specific use case}</li>
      </ul>
    </div>
    <div class="gr-verdict-col skip">
      <h4>Skip if you:</h4>
      <ul>
        <li>{lived friction from test — a real annoyance, not an edge case. e.g. "want a wireless setup with no Ethernet cable to run" beats "don't have an outlet near your router"}</li>
        <li>{candid limitation grounded in transcript}</li>
        <li>{candid limitation grounded in transcript}</li>
      </ul>
    </div>
  </div>
</div>

[3b] SCORECARD (HTML block, immediately after the Quick Verdict)
This gives readers at-a-glance trust + drives Google rich snippets via the Review schema (the overall score is what shows as stars in search results). The 4 subscore bars are visual only — derived from the transcript, not invented. If the video clearly doesn't speak to one of the four dimensions, you may still infer a score from how the reviewer talks (enthusiasm, ease of setup mentions, comparisons to other products, etc.) — but ground every number in something the transcript actually shows.

Score guide (1-5, decimals allowed, e.g. 4.5):
  - Value     = price-for-what-you-get based on what the reviewer said about cost
  - Quality   = build quality + performance the reviewer demonstrated
  - Ease      = setup, daily use, learning curve from the transcript
  - Durability = how it held up / how it's expected to hold up

The 4 subscores should average roughly to the Overall — small differences are fine and realistic. Don't make them all the same number.

Bar widths: convert score to percentage (e.g. 4.5 → 90%, 4.0 → 80%, 3.5 → 70%).

Stars row: use ★ for whole points, ½ for halves, ☆ for empty. E.g. 4.5/5 → "★★★★½".

<!-- wp:html -->
<div class="gr-scorecard">
  <div class="gr-sc-overall">
    <div class="gr-sc-num">{X.X}</div>
    <div class="gr-sc-out">/5</div>
    <div class="gr-sc-stars">{star row}</div>
    <div class="gr-sc-label">Overall</div>
  </div>
  <div class="gr-sc-subs">
    <div class="gr-sc-sub">
      <span class="gr-sc-sub-name">Value</span>
      <span class="gr-sc-sub-bar"><span style="width:{Y0}%"></span></span>
      <span class="gr-sc-sub-num">{Y.Y}</span>
    </div>
    <div class="gr-sc-sub">
      <span class="gr-sc-sub-name">Quality</span>
      <span class="gr-sc-sub-bar"><span style="width:{Y1}%"></span></span>
      <span class="gr-sc-sub-num">{Y.Y}</span>
    </div>
    <div class="gr-sc-sub">
      <span class="gr-sc-sub-name">Ease of Use</span>
      <span class="gr-sc-sub-bar"><span style="width:{Y2}%"></span></span>
      <span class="gr-sc-sub-num">{Y.Y}</span>
    </div>
    <div class="gr-sc-sub">
      <span class="gr-sc-sub-name">Durability</span>
      <span class="gr-sc-sub-bar"><span style="width:{Y3}%"></span></span>
      <span class="gr-sc-sub-num">{Y.Y}</span>
    </div>
  </div>
</div>
<!-- /wp:html -->

[4] BODY — 7 REQUIRED SECTIONS (WordPress heading + paragraph blocks)

  Section A: <!-- wp:heading --> H2 — Hook opener
    The FIRST sentence of the body is the single highest-stakes line in the
    entire post. Readers decide in ~5 seconds whether to keep reading or
    bounce. A generic "We tested X" / "Here's my review of X" / "This is a
    review of X" opener loses them. The first sentence MUST be one of:

      (a) A specific personal moment from the test — what you did, felt,
          noticed, or said in the video. Examples from posts that landed:
            "I forgot to blow out candles one too many times."
            "I ran it across my arm. Not carefully."
            "The Step to Bed is one of those products I didn't know existed
             until I had it in my hands."

      (b) A surprising or contrarian observation about the product:
            "The Wahl Peanut is only 4 oz but packs way more power than expected."

      (c) A concrete stake / pain the product addresses — written as
          something YOU lived, not a category generalization:
            "Getting out of bed in the dark is one of the riskier things
             people do every night, and after testing this I think most
             of us are doing it wrong."

    ⛔ BANNED first-sentence shapes (any variant — these are the bounce-
    inducing openers we keep seeing on the catalogue):
      • "We tested [product]." / "We tried out [product]."
      • "Here's my review of [product]." / "Here's our take on [product]."
      • "This is a review of [product]."
      • "Today we're looking at [product]."
      • "In this review I'll cover [product]."
      • Any sentence whose subject is "we" or "I" + a generic test verb
        (tested / tried / reviewed / checked out / unboxed) + the product
        name. Those are summary frames, not hooks. CUT them and start with
        the actual moment instead.
      • Opening with the product name as the literal subject of a category
        sentence: "The [product] is a [category]" / "The [product] is one
        of those products that…" UNLESS the second half of the sentence
        is a specific lived observation (see Step-to-Bed example above —
        the "I didn't know existed until I had it in my hands" is what
        saves it).

    First sentence rules:
      - Under 22 words. Short sentences hook harder.
      - First person ("I" / "we") OR observation about the product. Never
        third-person about the reader ("If you've ever wondered…").
      - Grounded in the transcript — mine for the first specific moment
        the reviewer mentions, the surprise reaction, the "wait" / "huh"
        / "didn't expect" beat. If the transcript opens with chat, find
        the first real observation later in it.
      - The affiliate link goes in the FIRST PARAGRAPH but not necessarily
        in the first sentence. Don't sacrifice the hook to land the link
        — sentence 2 or 3 can introduce the product + link.

  Section B: <!-- wp:heading {"level":3} --> H3 — Product mechanics
    Only the features and specs ACTUALLY stated in the transcript or product info — quote
    the real numbers/measurements when they're given, otherwise describe what the reviewer
    showed or demonstrated. Never invent, estimate, or guess a spec. No vague claims.

  Section C: <!-- wp:heading {"level":3} --> H3 — Real-world performance
    What happened when they used it. Specific conditions from transcript.

  Section D: <!-- wp:heading {"level":3} --> H3 — The honest friction
    Pull ONE concrete frustration, imperfection, or trade-off the reviewer
    actually hit during the test — something the manufacturer would NOT put on
    the box. Not an "edge case won't fit this" caveat; a lived-experience
    annoyance from real use. Mine the transcript for moments of: hesitation,
    surprise, "I would have liked", "the only thing", "it didn't quite",
    "got me thinking", "almost", "could be better". If the reviewer genuinely
    found nothing wrong, write ONE specific minor friction grounded in what
    they showed (a small UX papercut, a setup gotcha, a missing accessory,
    a quirk you have to learn). NEVER invent. Heading must NOT use the phrase
    "nobody talks about", "most reviews miss", "what other reviewers won't
    mention", or any "insider knowledge" framing — those are banned outright.
    Heading examples: "The Cable Snaps If You Yank It", "It Needs a Few
    Minutes to Wake Up", "The Velcro Anchor Is the Step You'll Forget".

  After Section D insert mid-article CTA card (HTML block — exact same markup as [7]).
  Fill the product-name span with a clean 2–6 word product name derived from the video
  title + transcript (drop the ASIN, drop generic words like "Review" or "Unboxing", drop
  prefixes like "We tested" — keep brand + product type, e.g. "Kieba Cervical Neck Massager"):
  <!-- wp:html -->
  <div class="gr-cta-card">
    <div class="gr-cta-body">
      <p class="gr-cta-eyebrow">${ctaEyebrow}</p>
      <p class="gr-cta-product-name">{Clean product name — 2-6 words, no ASIN, no fluff}</p>
      <a href="{AFFILIATE_URL}" target="_blank" rel="noopener sponsored" class="gr-cta-btn" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#FFC200;color:#111;font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:18px 24px;border-radius:3px;text-decoration:none;margin-top:4px;width:100%;box-sizing:border-box">
        ${ctaButton}
      </a>
      <p class="gr-cta-disclaimer" style="font-size:10px;line-height:1.4;color:#6b6b70;margin:6px 0 0;font-style:italic">${disclaimer}</p>
    </div>
    <div class="gr-cta-thumb-wrap">
      <img src="https://i.ytimg.com/vi/{VIDEO_ID}/mqdefault.jpg" alt="" loading="lazy" class="gr-cta-thumb" />
    </div>
  </div>
  <!-- /wp:html -->

  Section E: <!-- wp:heading {"level":3} --> H3 — Who this is actually for
    Specific scenarios. Real household/lifestyle contexts.

  Section F: <!-- wp:heading {"level":3} --> H3 — Direct comparison (CONDITIONAL)
    INCLUDE this section ONLY when at least ONE of these is true:
      (i)  The transcript explicitly compares the product to a real named or
           clearly described alternative (e.g. "vs. a basic bed rail",
           "compared to a tealight wax warmer", "vs. a corded trimmer").
      (ii) The product belongs to a category where readers ARE actively
           choosing between two well-defined formats (e.g. "wired security
           cameras vs. solar-wireless", "stevia vs. allulose for keto") —
           and the comparison genuinely changes the buying decision.

    Audit found this section was being written even when no real comparison
    existed in the source — the model invented one to fill the slot, which
    padded wordcount with low-value generic comparisons readers skim past.

    If NEITHER (i) nor (ii) is true, SKIP Section F entirely. Do not insert
    a placeholder heading. Do not invent a comparison. Renumber the
    remaining sections (E → F → G becomes E → G when F is dropped).

    When Section F IS included: name the specific alternative the reviewer
    or the category implies (not a vague "other options"). Cover at least
    one HONEST trade-off where the alternative wins, not a one-sided pitch
    for the reviewed product. If the reviewer themselves said the
    alternative is better for some use case, surface that too.

  Section G: <!-- wp:heading {"level":3} --> H3 — Advice for buyers
    Honest retrospective. Setup tips. Mistakes to avoid.

[5] FAQ — Minimum 5 questions (product-specific, not generic)
<!-- wp:heading {"level":2} --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->
Each Q: <!-- wp:heading {"level":3} --><h3>{question}</h3><!-- /wp:heading -->
        <!-- wp:paragraph --><p>{specific candid answer}</p><!-- /wp:paragraph -->

[6] RATING BOX (HTML block)
<div class="gr-rating-box">
  <div>
    <div class="gr-rating-score">{X.X}/5</div>
    <div class="gr-rating-label">Final Rating</div>
  </div>
  <div class="gr-rating-text">{2-3 sentences. Score justification. Personal first-person sign-off in your own voice.}</div>
</div>

[7] CTA CARD (HTML block — full content width, matches the rating box width)
Use the exact same product name string here as in the mid-article CTA from [4]:
<div class="gr-cta-card">
  <div class="gr-cta-body">
    <p class="gr-cta-eyebrow">${ctaEyebrow}</p>
    <p class="gr-cta-product-name">{Clean product name — 2-6 words, no ASIN, no fluff}</p>
    <a href="{AFFILIATE_URL}" target="_blank" rel="noopener sponsored" class="gr-cta-btn" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#FFC200;color:#111;font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:18px 24px;border-radius:3px;text-decoration:none;margin-top:4px;width:100%;box-sizing:border-box">
      ${ctaButton}
    </a>
    <p class="gr-cta-disclaimer" style="font-size:10px;line-height:1.4;color:#6b6b70;margin:6px 0 0;font-style:italic">${disclaimer}</p>
  </div>
  <div class="gr-cta-thumb-wrap">
    <img src="https://i.ytimg.com/vi/{VIDEO_ID}/mqdefault.jpg" alt="" loading="lazy" class="gr-cta-thumb" />
  </div>
</div>

[8] HASHTAG TAGS (HTML block — immediately after [7], no gap)
10 hashtags researched for SEO value AND social virality in this product's niche.
Mix: 3-4 broad high-traffic tags + 3-4 niche-specific tags + 2-3 product/brand-specific tags.
Format exactly like this:
<div class="gr-tags">
  <span>#Tag1</span>
  <span>#Tag2</span>
  <span>#Tag3</span>
  <span>#Tag4</span>
  <span>#Tag5</span>
  <span>#Tag6</span>
  <span>#Tag7</span>
  <span>#Tag8</span>
  <span>#Tag9</span>
  <span>#Tag10</span>
</div>

═══════════════════════════════════════
OUTPUT FORMAT — TWO BLOCKS, IN THIS ORDER
═══════════════════════════════════════

BLOCK 1 — metadata only, no HTML content:
%%META_START%%
{"title":"...","slug":"...","excerpt":"...","seoKeyword":"...","metaDescription":"...","tags":[...],"rating":"4.2","category":"...","imagePrompts":{"hero":"...","lifestyle":"...","setting":"..."}}
%%META_END%%

BLOCK 2 — full HTML content, no JSON escaping needed:
%%CONTENT_START%%
[full assembled HTML blocks [1]–[7] with {VIDEO_ID} and {AFFILIATE_URL} filled in]
%%CONTENT_END%%

BLOCK 1 rules:
- Valid JSON, no line breaks inside strings
- title: name the EXACT product and ONLY what it actually is per the transcript /
  PRODUCT INFO. NEVER add a function, component, or "2-in-1 / combo / multi-X /
  doubles-as" framing the source doesn't state (e.g. do NOT write "Water Bottle LED
  Lantern" for a plain water bottle, or add an attached light/speaker/fan/cooler).
  The title is the SEED for the whole post, the slug, and the URL — a fabricated
  identity here poisons every section. Truthful first, catchy second. Never "honest".
- slug: kebab-case derived from the truthful title — it must NOT contain any term
  the title doesn't (no invented function/component leaking into the URL).
- excerpt: max 160 chars
- seoKeyword: the ONE primary search phrase a real buyer would type into Google/YouTube to find THIS product/topic. Derive it from what the creator actually says in the transcript + the product facts — natural buyer language (e.g. "adjustable neck harness", "best budget standing desk"), 2–5 words, no brand fluff, no special characters. This is the phrase the post should rank for.
- metaDescription: the SERP/social meta description, MAX 155 chars. Lead with seoKeyword in the first few words, then a concrete benefit + a reason to click. Active voice, no hype, no clickbait, never the word "honest". This is distinct from excerpt — write it to win the click in search results.
- tags: 10 items — mix of broad high-traffic, niche-specific, and product/brand tags for SEO and social virality
- category: REQUIRED — pick EXACTLY ONE label from this list of brand niches that best fits THIS specific product: ${niches}. Copy the label verbatim, including capitalization, spacing, and the "&" character. If multiple niches plausibly fit, pick the most specific one (e.g. for a kitchen mat prefer "Home & Kitchen" over "Tools & Home Improvement"). If none of the brand niches plausibly fit, pick the closest match anyway — never invent a new category and never leave this field blank.
- imagePrompts.hero: YouTube thumbnail style. Bold text overlay with short specific verdict (max 6 words, specific to this product outcome). NO hype words — banned: HONEST, TRUTH, REAL, SHOCKING, AMAZING, LEGIT, FINALLY, ACTUALLY, WORTH IT, REAL TALK. Dramatic product close-up, studio lighting, high contrast. No packaging, no box.
- imagePrompts.lifestyle: Person using exact product, shallow depth of field, bokeh background, no box/packaging.
- imagePrompts.setting: Clean flat lay, exact product, neutral surface, no box/packaging.

BLOCK 2 rules:
- Raw HTML only — no JSON, no markdown fences
- Include everything from [1] affiliate disclaimer through [8] hashtag tags (all 8 sections)

QUALITY CHECK:
✅ Written entirely in the FIRST PERSON — no "the reviewer", "she/he", or a name anywhere
✅ No specific prices, dollar amounts, or discount percentages — readers are pointed to the live price
✅ Your exact phrases and vocabulary used throughout
✅ Transcript referenced in every section
✅ Affiliate link 3+ times (intro, body, mid-article button, final CTA)
✅ Buy/Skip items specific to THIS product
✅ FAQ product-specific
✅ Content hits ${targetLength}
✅ No captions anywhere in the HTML
✅ Zero AI tells (no em dashes, no "moreover", no "it's worth noting", etc.)
✅ Sentence variety — short punchy sentences mixed with longer ones
✅ Image prompts name the actual product with its real color/shape/material
✅ Hero prompt includes bold text overlay with punchy verdict
✅ Lifestyle prompt has bokeh/blurred background
✅ Setting prompt is a flat lay — no box, no packaging
✅ 10 hashtag pills rendered at end of post below CTA button
✅ "honest" / "honestly" appears NOWHERE in the post`
}

/** Pull a 10-char Amazon ASIN out of an Amazon product URL path. */
function asinFromAmazonUrl(url: string): string | null {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)
  return m ? m[1].toUpperCase() : null
}

const SHORTENERS = /^https?:\/\/(geni\.us|amzn\.to|amzn\.eu|a\.co)\//i

/**
 * Resolve the affiliate link + ASIN for a YouTube review.
 *
 * Cascade (per the user's content conventions): the 10-char ASIN may be
 * in the title; if not, the reviewed product's link is in the first
 * sentences of the description (Amazon link, Geniuslink, or short link).
 *
 *  1. A description Amazon link whose /dp/ASIN == the title's ASIN — best.
 *  2. A Geniuslink (commission/CC boost rides it), then short links
 *     (resolved once to recover the ASIN), then any Amazon link, then
 *     the first product URL — earlier-in-description wins ties.
 *  3. Title ASIN with no usable link → construct a clean /dp/ASIN URL.
 *
 * Returns the link to put in the post (Geniuslink/affiliate tags
 * preserved verbatim) and the best-known ASIN.
 */
async function resolveAffiliateUrl(
  description: string,
  title: string,
): Promise<{ url: string; asin: string | null }> {
  const titleAsin = (title.match(/\b([A-Z0-9]{10})\b/) || [])[1]?.toUpperCase() || null

  const urls = (description.match(/https?:\/\/[^\s)"'\]]+/g) || [])
    .map(u => u.replace(/[.,)]+$/, ''))
  // De-dupe, keep order (earlier = closer to the top of the description).
  const seen = new Set<string>()
  const ordered = urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)))

  type Cand = { url: string; pos: number; score: number; asin: string | null }
  const cands: Cand[] = ordered.map((url, pos) => {
    const isAmazon = /^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(url)
    const isGenius = /^https?:\/\/geni\.us\//i.test(url)
    const isShort = SHORTENERS.test(url)
    const dpAsin = isAmazon ? asinFromAmazonUrl(url) : null
    let score = 10
    if (dpAsin && titleAsin && dpAsin === titleAsin) score = 100
    else if (isGenius) score = 80
    else if (isShort) score = 70
    else if (dpAsin) score = 60
    else if (isAmazon) score = 50
    return { url, pos, score, asin: dpAsin }
  })

  cands.sort((a, b) => (b.score - a.score) || (a.pos - b.pos))
  const top = cands[0]

  if (!top) {
    // No links at all — fall back to the title ASIN if present.
    return titleAsin
      ? { url: `https://www.amazon.com/dp/${titleAsin}`, asin: titleAsin }
      : { url: '', asin: null }
  }

  let asin = top.asin || titleAsin
  // If we still don't have an ASIN and the winner is a short/Geniuslink,
  // resolve it once to recover the real product ASIN.
  if (!asin && (SHORTENERS.test(top.url))) {
    try {
      const res = await fetch(top.url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0)' },
      })
      asin = asinFromAmazonUrl(res.url) || null
    } catch { /* keep the short link as-is; ASIN unknown */ }
  }

  return { url: top.url, asin: asin || null }
}

export class ClaudeService {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  // Pass 1 — extract reviewer's authentic voice from transcript
  private async extractVoiceProfile(transcript: string, title: string): Promise<string> {
    try {
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Analyze this YouTube video transcript and extract the reviewer's authentic voice profile. This is used to write a blog post that sounds like THEM — not like AI-generated content.

VIDEO TITLE: ${title}

TRANSCRIPT:
${transcript.slice(0, 15000)}

Return a JSON object with exactly these fields:
{
  "video_opening": "How did they open the video? First 2-3 sentences they actually said, verbatim or very close to it.",
  "signature_phrases": ["8-12 verbatim quotes — their exact wording, reactions, verdicts, jokes, complaints. Include messy or casual ones."],
  "vocabulary": ["15-20 words or short expressions they favor, repeat, or that feel distinctly like them — slang, filler words, pet phrases"],
  "personality": "2-3 sentences describing HOW they talk: directness level, humor style, how they handle disappointments, how they deliver opinions",
  "key_opinions": ["their actual stated opinions about the product — copied from transcript as closely as possible, including negatives and caveats"],
  "specific_moments": ["3-5 specific things that happened during their test — a trip they mentioned, a moment the product failed or surprised them, a comparison they made to something else, a specific number or measurement they cited"],
  "energy": "One sentence: what's the vibe? Excited and enthusiastic? Dry and skeptical? Casual and conversational? Somewhere in between?"
}

Output only valid JSON. No explanation, no markdown.`,
        }],
      })
      return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    } catch {
      return ''
    }
  }

  // Final pass — fact-check product claims against the ONLY sources of truth
  // (transcript + product info) and strip/soften any spec or feature they don't
  // support. Best-effort: on any failure or a suspicious result (truncated, or
  // the affiliate link dropped), the original content stands — this can never
  // break a post.
  async factCheckProductClaims(
    content: string,
    transcript: string,
    productResearch: string | null | undefined,
    ctx?: UsageCtx,
  ): Promise<string> {
    if (!content || content.length < 200) return content
    try {
      const sources = `=== VIDEO TRANSCRIPT ===\n${(transcript || '').slice(0, 18000) || '(no transcript provided)'}\n\n=== PRODUCT INFO ===\n${(productResearch || '').slice(0, 2500) || '(none provided)'}`
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system: 'You are a meticulous fact-checking editor for affiliate product posts. You remove invented product facts while preserving the writing and all HTML exactly.',
        messages: [{
          role: 'user',
          content: `Below is a ready-to-publish affiliate blog post (HTML) and the ONLY two sources of truth for product facts: the video transcript and product info.

FIRST AND MOST IMPORTANT — VERIFY THE PRODUCT'S IDENTITY. Confirm the post describes ONLY the product the sources actually show: its real type/form factor and its real function(s). If the post invents a second function, an extra component, or a "2-in-1 / combo / convertible / multi-function / doubles-as-a-X" nature that the sources never state (e.g. it calls a plain water bottle a "water bottle lantern", says it has a built-in light/speaker/fan/cooler, or frames a single-purpose product as dual-purpose), that is a fabricated identity — REMOVE every sentence, claim, FAQ, verdict bullet, and aside that depends on the invented part, and rewrite surrounding text so the post is consistently about the REAL product only. Do not infer a feature from the setting, niche, or product name. This identity check overrides everything below: an invented "what the product is" is the worst error in the post.

Then find every PRODUCT FACT in the post — specs, numbers, measurements, dimensions, weight, capacity, battery/run time, wattage, speed, materials, finishes, model numbers, prices, included accessories, warranty, certifications, ingredients, compatibility, and performance/result claims — and check each against the sources.

For any product fact (or invented function/component) that is NOT supported by the transcript or product info:
- Remove it, or minimally rewrite the sentence to drop the unsupported detail while keeping it natural and readable.
- Do NOT replace it with a different invented fact, and do NOT add any new facts.
- Direct quotes and the reviewer's stated opinions are fine to keep as long as they appear in the transcript.

ALSO — PRICES: remove EVERY specific price, currency amount, list/sale price, and discount percentage (e.g. "$49.99", "was $68.99", "28% off", "under $50", "only $X"), EVEN IF it appears in the sources — prices go stale and make the post wrong. Replace with neutral live-price phrasing like "check the current price" / "see today's price at the link". Do not leave any "$" amount or "% off" in the body.

OUTPUT RULES (critical):
- Return the FULL corrected post as raw HTML and NOTHING else — no preamble, no markdown fences, no commentary.
- Preserve ALL HTML structure exactly: every Gutenberg block comment (<!-- wp:... -->), heading, list, the CTA card markup, images, and EVERY hyperlink — especially affiliate links (rel="noopener sponsored"). Do not drop, alter, or reorder any link or block.
- Change as LITTLE as possible. Only touch unsupported product facts. If everything checks out, return the post completely unchanged.
- Never use the word "honest".

${sources}

=== POST HTML (return the corrected version) ===
${content}`,
        }],
      }, { timeout: 45000 }) // hard cap so the fact-check can never eat the image-generation budget
      let out = message.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('').trim()
      // Strip accidental markdown code fences.
      out = out.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()
      const u = usageFromAnthropic(message)
      recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'blog_factcheck', model: 'claude-haiku-4-5-20251001', input: u.input, output: u.output })

      // Safety guards — never let the fact-check damage a post:
      if (!out || out.length < content.length * 0.5) return content // truncated / over-stripped
      // Monetization guard: if the original had affiliate/sponsored links, the
      // corrected version must keep them.
      if (/rel="[^"]*sponsored/i.test(content) && !/rel="[^"]*sponsored/i.test(out)) return content
      return out
    } catch {
      return content
    }
  }

  /**
   * Title-only fact-check — catches an invented product IDENTITY in the headline
   * (e.g. a plain water bottle titled "2-in-1 Water Bottle LED Lantern"). The title
   * seeds the post, the slug, and the URL, so a fabricated identity here is the
   * worst hallucination of all. Returns a corrected title (same product, invented
   * function/component stripped) or the original verbatim if it checks out.
   * Cheap + fast (tiny Haiku call) so it can run on the critical path BEFORE
   * publish, letting the caller also re-derive a clean slug. Best-effort: any
   * failure or suspicious result returns the original title unchanged.
   */
  async factCheckTitle(
    title: string,
    transcript: string,
    productResearch: string | null | undefined,
    ctx?: UsageCtx,
  ): Promise<string> {
    const t = (title || '').trim()
    if (!t) return title
    try {
      const sources = `=== VIDEO TRANSCRIPT ===\n${(transcript || '').slice(0, 14000) || '(no transcript provided)'}\n\n=== PRODUCT INFO ===\n${(productResearch || '').slice(0, 2500) || '(none provided)'}`
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'You verify that an affiliate blog-post TITLE names the real product and nothing more. You never invent; you only strip an invented identity.',
        messages: [{
          role: 'user',
          content: `A blog-post title must describe ONLY the product the sources actually show — its real type/form factor and its real function(s). It must NOT claim a second function, an extra component, or a "2-in-1 / combo / convertible / multi-function / doubles-as" nature the sources never state.

Check the title below against the sources.
- If every part of the title is supported by the sources, return it EXACTLY unchanged.
- If the title invents a function, component, or dual nature the sources don't support (e.g. calling a plain water bottle a "Water Bottle LED Lantern", adding "2-in-1", an attached light/speaker/fan/cooler), rewrite it to name ONLY the real product: keep the brand, the real product type, and the "Review" framing; drop the invented part. Keep it natural and similar in length. Do not infer a feature from the setting or the product's name.
- Never add a new claim. Never use the word "honest".

Return ONLY the final title text on a single line — no quotes, no explanation, no JSON.

${sources}

=== TITLE TO CHECK ===
${t}`,
        }],
      }, { timeout: 20000 })
      let out = message.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('').trim()
      out = out.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').trim()
      const u = usageFromAnthropic(message)
      recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'blog_factcheck_title', model: 'claude-haiku-4-5-20251001', input: u.input, output: u.output })
      // Guards: never return empty, multi-line, or absurdly long output.
      if (!out || out.length < 3 || out.length > 160 || /\n/.test(out)) return title
      return out
    } catch {
      return title
    }
  }

  async generateBlogPost(
    brand: BrandProfile,
    video: VideoInput,
    ctx?: UsageCtx,
    /** When set, the prompt nudges Claude to produce a different post
     *  than whatever's currently live — feedback from a Pro user who
     *  hit Rewrite and explained what was missing. */
    rewriteFeedback?: string | null,
    /** Recently-published posts from THIS user, used as in-context
     *  voice anchors so each new generation sounds more like them.
     *  Passed as { title, excerpt } — excerpt should be first ~1200 chars
     *  of plain-text body. The route pulls 2-3 most recent published
     *  posts (excluding the one being rewritten, if any). */
    priorExamples?: Array<{ title: string; excerpt: string }> | null,
    /** Persistent feedback — every "what was missing" note the user
     *  has typed into the Rewrite modal across all their posts. The
     *  AI treats these as standing rules for THIS user's voice. */
    persistentFeedback?: string[] | null,
  ): Promise<BlogGenerationOutput> {
    // Caller pre-resolves the link and passes it as affiliateUrlOverride —
    // this may be an Amazon link (with asinOverride) OR a direct store /
    // brand product page the creator linked (no ASIN). Honor it verbatim
    // either way so we never re-resolve and accidentally grab an unrelated
    // link (e.g. a "gear I use" amzn.to link buried in the description).
    let affiliateUrl: string
    let asin: string | null
    if (video.affiliateUrlOverride) {
      affiliateUrl = video.affiliateUrlOverride
      asin = video.asinOverride ?? null
    } else if (video.asinOverride) {
      asin = video.asinOverride
      affiliateUrl = `https://www.amazon.com/dp/${video.asinOverride}`
    } else {
      const resolved = await resolveAffiliateUrl(video.description, video.title)
      affiliateUrl = resolved.url
      asin = resolved.asin
    }
    // If we couldn't surface an Amazon ASIN / affiliate URL anywhere, treat
    // the video as general content rather than a product review. The
    // system prompt still applies, but a directive at the top of the user
    // message tells Claude to skip every affiliate-specific section so
    // the post reads like a narrative review of the video's topic.
    const isProduct = !!asin || !!affiliateUrl

    // Pass 1 — extract voice profile from transcript (fast, cheap)
    let voiceProfile = ''
    if (video.transcript) {
      voiceProfile = await this.extractVoiceProfile(video.transcript, video.title)
    }

    // CTA copy follows the destination: Amazon ASIN/URL → "...on Amazon";
    // a direct store/brand link → neutral "Find Out More".
    const ctaIsAmazon = !!asin || /^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(affiliateUrl)
    const systemPrompt = buildSystemPrompt(brand, voiceProfile || undefined, ctaIsAmazon)

    const feedbackBlock = rewriteFeedback?.trim()
      ? `\n\nREWRITE REQUEST — the user already received one version of this post and asked for a different angle. Make this draft materially different from a standard generation. Their feedback:\n"${rewriteFeedback.trim()}"\n\nAddress these points directly: pick a different opening hook, restructure the body around the missing angle, and avoid repeating any phrasings that would feel like the previous draft.`
      : ''

    // Persistent feedback — each note the user has typed when hitting
    // Rewrite stays in their voice profile forever and applies to every
    // future generation. They told us once, we shouldn't repeat the
    // mistake on the next post.
    const persistentFeedbackBlock = (persistentFeedback && persistentFeedback.length > 0)
      ? `\n\n═══════════════════════════════════════
STANDING USER FEEDBACK — apply to every generation
═══════════════════════════════════════
These are notes the user has left on previous rewrites. Treat them as PERMANENT rules for their voice — never break them on a new draft.

${persistentFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}
═══════════════════════════════════════\n`
      : ''

    // In-context voice anchors — the user's own most-recent published
    // posts. The model treats these as the ground truth for their
    // rhythm, sentence length, signature phrases, and structural
    // preferences. Crucially: borrow VOICE, never copy content.
    const voiceExamplesBlock = (priorExamples && priorExamples.length > 0)
      ? `\n\n═══════════════════════════════════════
YOUR PRIOR PUBLISHED WORK — voice reference
═══════════════════════════════════════
These are the user's most recent published posts. Use them as VOICE / RHYTHM / STRUCTURAL anchors — match the cadence, sentence length, opener style, transition habits, and characteristic phrases.

DO:
- Mirror the sentence-length mix
- Mirror the opener style (do they start with a scene? a question? a one-line declaration?)
- Reuse their characteristic transitional moves and connective phrases
- Match the level of formality / contractions / asides

DO NOT:
- Copy whole sentences or paragraphs from these posts
- Reuse the same product, same hook, or same anecdotes
- Reproduce specific facts/quotes — those belong only to their original posts

${priorExamples.map((ex, i) => `── EXAMPLE ${i + 1}: "${ex.title}" ──\n${ex.excerpt}`).join('\n\n')}
═══════════════════════════════════════\n`
      : ''

    const generalModeOverride = isProduct
      ? ''
      : `

═══════════════════════════════════════
GENERAL-VIDEO MODE — overrides the structure above
═══════════════════════════════════════

This video is NOT a product review. There is no affiliate link, no ASIN, no product to rate.
Write a STORYTELLER blog post — first-person, scene-driven, fact-grounded — about what happens in the video. Think long-form editorial (The Atlantic, Wired feature, a great Substack essay) — NOT an explainer, NOT a listicle, NOT a generic summary.

═══════════════════════════════════════
TRANSCRIPT IS YOUR SOURCE OF TRUTH
═══════════════════════════════════════
Every concrete fact, number, quote, name, place, sequence, decision, outcome, mistake, surprise, and reaction in the post MUST come from the transcript. If the transcript doesn't say it, don't write it.

FIRST PERSON, NEVER FABRICATED: you ARE the person in the video — write the whole post in the first person ("I"/"we"). Tell the real moments as your own ("I ran it for a week", "what got me was…"). NEVER refer to yourself in the third person — no "the reviewer", "she", "he", "according to the reviewer", or a name. BUT only tell experiences, results, and reactions that ACTUALLY happen in the transcript; never invent a story, test, or outcome the video doesn't show just to have something first-person to say.

Mandatory in the body:
- At least 3 of the most vivid, specific lines from the transcript woven in as YOUR OWN words (first person) — the messy, casual, blunt reactions, not the polished bits. They're your words, so state them directly; never attribute them to a third person ("she says", "the reviewer notes").
- Surface the SPECIFIC FACTS the transcript actually provides (numbers, places, times, names, model details, costs, durations, distances, brands, dates) in prose, not bullet lists — aim for 5+ when the transcript supports it, but ONLY facts that are genuinely stated. NEVER pad to a count with invented, estimated, or guessed numbers; if the video is light on hard facts, use fewer and lean on quotes and what was shown instead.
- At least 2 MOMENTS rendered as scenes — micro-stories that put the reader IN the room, told in first person. ("I picked it up. Twenty seconds in, I'm already shaking my head.")

If the transcript is missing or thin, build the post around the title + description + tags, but flag the lack of detail plainly (e.g. "Without the full video, what we know is…") — never invent specifics.

═══════════════════════════════════════
VOICE
═══════════════════════════════════════
- FIRST PERSON throughout — you are the person who made the video and lived these moments ("I"/"we"). Tell them as your own ("I…", "what struck me was…"). Never a third-person observer, never "the reviewer"/"she"/"he"/a name. Ground every first-person statement in the transcript — never invent.
- Sentence rhythm: mostly short, occasionally long. Mix punchy with flowing. Read like a writer, not a content mill.
- Show, don't summarize. "I refused to plug it in for three days" beats "I was hesitant to use it."
- Opinions are welcome — your reaction to what happened, what surprised you, what you'd push back on — but ground them in the transcript.
- No "In conclusion", no "Furthermore", no "In today's fast-paced world". No corporate fluff.

═══════════════════════════════════════
STRUCTURE OVERRIDE (replaces the product-review template above)
═══════════════════════════════════════

[1] AFFILIATE DISCLAIMER BLOCK → OMIT ENTIRELY.
[2] YouTube embed → keep as-is.
[3] QUICK VERDICT BOX → REPLACE with a short "What this is about" panel: 2-3 sentence framing of the story (NOT a summary — set the scene), then a 3-5 bullet "What you'll take away" list of concrete things the reader will learn / see / understand.
[4] BODY SECTIONS A-G → reshape into a NARRATIVE arc. Use H2/H3 headings naturally — they should sound like chapter titles or evocative scene markers, not "Section A".
    A. SCENE-IN — open ON a specific moment from the transcript. No throat-clearing, no "In this video, X explains…". Drop the reader straight into something happening.
    B. THE BACKSTORY — who is this about, what led up to it, why is it happening now? Specific names, places, dates. From the transcript.
    C. WHAT ACTUALLY HAPPENS — blow-by-blow of the video's main arc, drawing direct quotes and concrete details from the transcript. Multiple paragraphs, paced like a story.
    D. THE PART NOBODY ELSE WILL TELL YOU — the surprising / overlooked / counterintuitive moment. Quote it directly.
    E. WHAT IT MEANS — your read on the broader implication. Be specific. Avoid generic life lessons.
    F. (OPTIONAL) COMPARABLE STORIES — only if you genuinely have one. Otherwise skip.
    G. WHAT TO DO WITH THIS — what the reader walks away with: a recommendation, a question to sit with, a thing to try, a perspective shift.
    OMIT the mid-article CTA card entirely.
[5] FAQ → keep, but reframe around the TOPIC / story / claims of the video. Answer with transcript-backed specifics.
[6] RATING BOX → OMIT ENTIRELY.
[7] FINAL CTA CARD → REPLACE with a simple "Watch it for yourself" paragraph pointing back to the embedded video (and a soft subscribe nudge if it fits). No button styling, no Amazon language.
[8] HASHTAG TAGS → keep, but exclude #ad / #affiliate / any sponsorship-flavoured tags.

═══════════════════════════════════════
HARD BANS for general-video mode
═══════════════════════════════════════
- No {AFFILIATE_URL} / {AFFILIATE_LINK} placeholders anywhere.
- No "purchase", "price", "buy", "Amazon", "affiliate", "best deal", "today's price", "in stock".
- No fake quotes, fake names, fake numbers, fake "studies show".
- No generic life-coach platitudes — every paragraph must earn its place with specifics from the transcript.
- No bulleted summary at the bottom. Land the ending with a sentence that lingers.

The rest of the brand voice, tone, length, learn-profile rules, and formatting from the system prompt still apply.
═══════════════════════════════════════`

    const userMessage = `Generate a blog post for this YouTube ${isProduct ? 'review video' : 'video (general content — not a product review)'}.

VIDEO ID: ${video.videoId}
TITLE: ${video.title}
${isProduct ? `AFFILIATE URL: ${affiliateUrl || '[AFFILIATE_LINK]'}` : 'AFFILIATE URL: (none — general video, no product)'}
VIDEO TAGS: ${video.tags.join(', ')}

VIDEO DESCRIPTION:
${video.description.slice(0, 2000)}
${video.productResearch ? `\nPRODUCT INFO (scraped from the product/brand site linked in the description — use these as FACTUAL product details; the transcript still governs the voice, tone, and the reviewer's actual opinions):\n${video.productResearch.slice(0, 2500)}\n` : ''}
TRANSCRIPT:
${video.transcript ? video.transcript.slice(0, 20000) : 'No transcript available — base post on title, description, and tags only.'}${persistentFeedbackBlock}${voiceExamplesBlock}${generalModeOverride}${feedbackBlock}`

    // Pass 2 — generate with extended thinking (streaming required for large
    // max_tokens). Retry once on transient stream drops: a long streamed
    // response can be cut off by the network/edge, which surfaces as an
    // undici "terminated" / "fetch failed" / socket error. One clean retry
    // recovers the common case rather than failing the whole generation.
    const runGeneration = () => this.client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      // Trimmed from 10k → 6k: extended thinking added ~40s of latency up
      // front, and on a deep post + body images the whole pipeline was
      // tipping past the 300s function limit (504). 6k still gives solid
      // planning headroom without the timeout risk.
      thinking: { type: 'enabled', budget_tokens: 6000 },
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }).finalMessage()

    let message: Anthropic.Message
    let genAttempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        message = await runGeneration()
        break
      } catch (err) {
        genAttempt++
        const m = err instanceof Error ? err.message : String(err)
        const transient = /terminated|fetch failed|socket|ECONNRESET|ECONNRESET|network|aborted|overloaded|529|503|502|timeout/i.test(m)
        if (!transient || genAttempt >= 2) throw err
        await new Promise(r => setTimeout(r, 2500))
      }
    }
    {
      const u = usageFromAnthropic(message)
      recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'blog_generate', model: 'claude-sonnet-4-6', input: u.input, output: u.output })
    }

    // Filter out thinking blocks — only keep text output
    const raw = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('')

    // Extract metadata block %%META_START%% ... %%META_END%%
    const metaMatch = raw.match(/%%META_START%%\s*([\s\S]*?)\s*%%META_END%%/)
    const contentMatch = raw.match(/%%CONTENT_START%%\s*([\s\S]*?)\s*%%CONTENT_END%%/)

    if (!metaMatch || !contentMatch) {
      // Fallback: try legacy single-JSON approach
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const extracted = start >= 0 && end > start ? raw.slice(start, end + 1) : raw.trim()
      let parsed: BlogGenerationOutput
      try {
        parsed = JSON.parse(extracted)
      } catch {
        try {
          parsed = JSON.parse(jsonrepair(extracted))
        } catch {
          throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 300)}`)
        }
      }
      parsed.content = parsed.content.replace(/{VIDEO_ID}/g, video.videoId)
      return parsed
    }

    let meta: Omit<BlogGenerationOutput, 'content'>
    try {
      meta = JSON.parse(metaMatch[1])
    } catch {
      try {
        meta = JSON.parse(jsonrepair(metaMatch[1]))
      } catch {
        throw new Error(`Claude returned invalid metadata JSON: ${metaMatch[1].slice(0, 200)}`)
      }
    }

    const parsed: BlogGenerationOutput = {
      ...meta,
      content: contentMatch[1].replace(/{VIDEO_ID}/g, video.videoId),
    }

    // NOTE: the fact-check pass runs in the route's after() block (post-response)
    // so the main generation request stays fast and never 504s on a deep post.

    return parsed
  }

  /**
   * Campaign content engine — research-driven, NOT transcript-driven.
   * Same brand-voice system prompt + same BlogGenerationOutput contract as
   * generateBlogPost (so the route can reuse the WP-publish path), but the
   * substance comes from an Amazon product + a web-research brief, and the
   * structure is problem→solution marketing + a real FAQ for search intent.
   */
  async generateCampaignBlogPost(
    brand: BrandProfile,
    input: { product: { asin: string; title: string; bullets: string[]; description: string; price: string | null; rating: string | null }; researchBrief: string; affiliateUrl: string },
    ctx?: UsageCtx,
  ): Promise<BlogGenerationOutput> {
    const systemPrompt = buildSystemPrompt(brand)
    const p = input.product

    const userMessage = `Generate a long-form, SEO-optimized INFORMATIONAL buyer's-guide article about this product. This is NOT a personal review. There is NO video — base the post entirely on the product facts and the research brief below.

⛔ CRITICAL FRAMING — this overrides any "first-person reviewer" instruction in your system prompt:
- This is a general informational + commercial-intent article ABOUT the product: its features, the benefits, and the most-asked questions answered.
- DO NOT claim or imply that you (or "we"/"I") bought, owned, tested, tried, used, or hands-on evaluated this product. No "in our testing", "we put this through", "I've used this for months", "after weeks of use", "our experience with", "we recommend" framed as personal endorsement.
- Write in an informative, third-person-about-the-product voice. The brand voice still governs TONE (rhythm, word choice, personality) — but NOT a false claim of personal use.
- It's fine to be genuinely helpful and persuasive about who it's for and what problems it solves. It is NOT fine to fabricate first-hand experience.

PRODUCT
ASIN: ${p.asin}
Title: ${p.title}
${p.price ? `Price: ${p.price}` : ''}
${p.rating ? `Amazon rating: ${p.rating}` : ''}
${p.bullets.length ? `Features:\n${p.bullets.map(b => `- ${b}`).join('\n')}` : ''}
${p.description ? `Description: ${p.description.slice(0, 1500)}` : ''}

AFFILIATE URL: ${input.affiliateUrl || '[AFFILIATE_LINK]'}

RESEARCH BRIEF (use this as the backbone — it reflects what real buyers ask and the problems this solves):
${input.researchBrief}

STRUCTURE REQUIREMENTS (in addition to your normal brand-voice rules):
- Lead with the PROBLEM the reader has, then position the product as the solution. Don't open with specs.
- A clear "features and what they actually mean for you" section — translate specs into benefits.
- Weave the affiliate URL in naturally where a reader would be ready to act (not jammed in the first line).
- A substantial FAQ section built from the "What buyers actually ask" questions in the brief — real, useful answers.
- Honestly cover the considerations / who it's NOT for from the brief, framed as objective guidance ("worth knowing before you buy"), NOT as a reviewer's personal verdict.
- Search-intent friendly: clear H2/H3s phrased the way people actually search.
- Match the brand voice for tone only. Respect the words-to-avoid list. No fabricated first-hand testing language anywhere.

Return in the same %%META_START%% / %%META_END%% then %%CONTENT_START%% / %%CONTENT_END%% format you always use.`

    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      thinking: { type: 'enabled', budget_tokens: 10000 },
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    const message = await stream.finalMessage()
    {
      const u = usageFromAnthropic(message)
      recordUsage({ userId: ctx?.userId, tier: ctx?.tier, feature: 'campaign_generate', model: 'claude-sonnet-4-6', input: u.input, output: u.output })
    }
    const raw = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('')

    const metaMatch = raw.match(/%%META_START%%\s*([\s\S]*?)\s*%%META_END%%/)
    const contentMatch = raw.match(/%%CONTENT_START%%\s*([\s\S]*?)\s*%%CONTENT_END%%/)

    if (!metaMatch || !contentMatch) {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const extracted = start >= 0 && end > start ? raw.slice(start, end + 1) : raw.trim()
      try {
        return JSON.parse(extracted) as BlogGenerationOutput
      } catch {
        try {
          return JSON.parse(jsonrepair(extracted)) as BlogGenerationOutput
        } catch {
          throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 300)}`)
        }
      }
    }

    let meta: Omit<BlogGenerationOutput, 'content'>
    try {
      meta = JSON.parse(metaMatch[1])
    } catch {
      try {
        meta = JSON.parse(jsonrepair(metaMatch[1]))
      } catch {
        throw new Error(`Claude returned invalid metadata JSON: ${metaMatch[1].slice(0, 200)}`)
      }
    }

    return { ...meta, content: contentMatch[1] }
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return true
    } catch { return false }
  }
}

export function createClaudeService() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  return new ClaudeService(apiKey)
}
