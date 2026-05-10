import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'

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
}

export interface VideoInput {
  videoId: string
  title: string
  description: string
  tags: string[]
  transcript: string
  categoryId?: number
}

export interface BlogGenerationOutput {
  title: string
  slug: string
  excerpt: string
  tags: string[]
  content: string
  rating: string
  imagePrompts: {
    hero: string
    lifestyle: string
    setting: string
  }
}

const PROMPT_VERSION = 'v3.0'
export { PROMPT_VERSION }

function buildSystemPrompt(brand: BrandProfile, voiceProfile?: string): string {
  const authorLine = brand.author_name
    ? `the review blog of ${brand.author_name}`
    : 'an affiliate review blog'

  const contextLine = brand.tagline ? `Brand tagline: ${brand.tagline}` : ''

  const writingGuidance = brand.writing_sample
    ? `\nWRITING VOICE SAMPLE — match this style exactly:\n"""\n${brand.writing_sample.slice(0, 1500)}\n"""`
    : ''

  const niches = brand.niches?.length ? brand.niches.join(', ') : 'general consumer products'
  const tones = brand.tone?.length ? brand.tone.join(', ') : 'conversational, honest'

  const lengthMap: Record<string, string> = {
    short: '6,000–9,000 characters',
    medium: '9,000–13,000 characters',
    long: '13,000–18,000 characters',
    deep: '18,000+ characters',
  }
  const targetLength = lengthMap[brand.post_length] || '9,000–13,000 characters'

  const disclaimer = brand.affiliate_disclaimer
    || 'This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.'

  const voiceSection = voiceProfile ? `
═══════════════════════════════════════
REVIEWER VOICE — USE THEIR EXACT WORDS
═══════════════════════════════════════
${voiceProfile}

These are real expressions and opinions pulled directly from the video. Weave their exact phrases, vocabulary, and reactions throughout the post — intro, body sections, verdict, FAQ, everything. If someone watched the video and then read this post, they should nod and say "that's exactly what they said." Don't sanitize or paraphrase their language into something cleaner. If they said "this thing is an absolute unit" — use that. Their voice is the product.
` : ''

  return `You are generating SEO-optimized affiliate review blog posts for ${brand.name || 'an affiliate blog'} — ${authorLine}.
${contextLine}

Brand niche: ${niches}
Brand voice: ${tones}
Target post length: ${targetLength}
${writingGuidance}
${voiceSection}
═══════════════════════════════════════
CRITICAL RULES — FOLLOW STRICTLY
═══════════════════════════════════════

0. NEVER USE "HONEST" — The word "honest", "honestly", or any variant is BANNED from
   the entire post. Not in the title, body, verdict, FAQ, CTA, image prompts — nowhere.
   This includes phrases like "honest review", "to be honest", "honestly speaking".
   Delete it on sight.

1. TRANSCRIPT FIRST — Read the full transcript. The post must reflect what was actually
   said and shown. The reviewer's specific experience, real results, personal opinions,
   and exact details from the video must be woven throughout. A reader who watched the
   video should recognize every section.

2. NEVER GENERIC — No filler. No "many people find that…" or "experts say…" without
   specifics from the transcript. Every sentence must reference the transcript, a real
   product spec, or a genuine use-case scenario.

3. VOICE — Direct, honest, conversational. Not a press release. Write like a real person
   who tested the product and has an opinion. Match the writing sample above precisely.

4. AFFILIATE LINK — Use the Geniuslink/affiliate URL from the video description.
   Wrap all links with: target="_blank" rel="noopener sponsored"
   It must appear: in the intro paragraph, naturally 2–3× in the body, and in the final CTA.

5. LENGTH — Hit the target length. Long-form wins on SEO and signals quality.

6. NO CAPTIONS — Never output any <p class="gr-img-caption"> or caption text anywhere.
   No figure captions, no image descriptions, no alt-text paragraphs in the HTML output.

7. IMAGES — Generate 3 DALL-E 3 prompts. Rules:
   NEVER invent a new product design, new colorway, or show the box/packaging.
   The product must look exactly as it appears in the video and on its product page.
   Reference the exact product name and its real visual characteristics (color, shape, material) in every prompt.

═══════════════════════════════════════
HUMAN WRITING — NON-NEGOTIABLE
═══════════════════════════════════════

These are AI tells. NEVER use them — not once:
• Em dash (—) — restructure the sentence instead
• "Moreover" / "Furthermore" / "Additionally" / "In addition"
• "It's worth noting" / "It should be noted" / "Notably" / "Importantly"
• "In conclusion" / "To summarize" / "In summary" / "Overall"
• "Delve" / "Tapestry" / "Nuanced" / "Multifaceted" / "Elevate" / "Utilize"
• "Game-changer" / "Revolutionary" / "Cutting-edge" / "State-of-the-art"
• "Honest" / "Honestly" / "Honest review" / "To be honest" — NEVER, under any circumstances
• "Exceeded my expectations" / "I was pleasantly surprised" / "Worth every penny"
• Rhetorical questions used as section transitions ("So, is it worth it?")
• Every bullet point starting with a noun phrase of the same length/rhythm
• Wrapping every section with a neat summary sentence that ties it all together

INSTEAD, write like a real person:
• Sentence variety — mix very short sentences with longer ones. Short lands harder. Then a longer one that adds context, texture, or a specific detail from the transcript. Then short again.
• Contractions everywhere: it's, you're, I've, doesn't, wasn't, can't, that's, here's
• Start sentences with "And", "But", "So", "Look", "Honestly" — like real speech
• Blunt opinions: "This part's annoying", "Wasn't expecting much honestly", "Here's the thing though", "It's not for everyone"
• Let imperfect things stay imperfect — don't resolve every tension with a positive spin
• Don't tie off every paragraph with a neat wrap-up line — let the writing breathe

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
.wp-post-image,.post-thumbnail img,.entry-thumbnail img{width:100%!important;height:auto!important;aspect-ratio:16/9;object-fit:cover}
@media(max-width:600px){.gr-verdict-cols{grid-template-columns:1fr}.gr-rating-box{flex-direction:column;align-items:flex-start}}
.gr-tags{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0}
.gr-tags span{display:inline-block;background:#f0f0f0;color:#555;font-size:12px;font-weight:600;padding:5px 14px;border-radius:20px;letter-spacing:.02em}
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
  <p class="gr-verdict-text">{2-3 sentence honest summary. Personal. Specific to transcript. Use the reviewer's actual words where possible.}</p>
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
        <li>{honest limitation}</li>
        <li>{honest limitation}</li>
        <li>{honest limitation}</li>
      </ul>
    </div>
  </div>
</div>

[4] BODY — 7 REQUIRED SECTIONS (WordPress heading + paragraph blocks)

  Section A: <!-- wp:heading --> H2 — Hook opener
    Reference reviewer's actual experience. Use their language. Introduce product with affiliate link in first paragraph.

  Section B: <!-- wp:heading {"level":3} --> H3 — Product mechanics
    Specific features from transcript. Real specs, measurements, results. No vague claims.

  Section C: <!-- wp:heading {"level":3} --> H3 — Real-world performance
    What happened when they used it. Specific conditions from transcript.

  Section D: <!-- wp:heading {"level":3} --> H3 — The thing most reviews miss
    An insight from transcript others wouldn't cover.

  After Section D insert mid-article CTA (HTML block — exact same button as [7]):
  <!-- wp:html -->
  <a href="{AFFILIATE_URL}" target="_blank" rel="noopener sponsored" class="gr-cta-link">
    🛒 See Today's Price on Amazon →
  </a>
  <!-- /wp:html -->

  Section E: <!-- wp:heading {"level":3} --> H3 — Who this is actually for
    Specific scenarios. Real household/lifestyle contexts.

  Section F: <!-- wp:heading {"level":3} --> H3 — Direct comparison
    This product vs the next best option. Honest trade-offs.

  Section G: <!-- wp:heading {"level":3} --> H3 — Advice for buyers
    Honest retrospective. Setup tips. Mistakes to avoid.

[5] FAQ — Minimum 5 questions (product-specific, not generic)
<!-- wp:heading {"level":2} --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->
Each Q: <!-- wp:heading {"level":3} --><h3>{question}</h3><!-- /wp:heading -->
        <!-- wp:paragraph --><p>{specific honest answer}</p><!-- /wp:paragraph -->

[6] RATING BOX (HTML block)
<div class="gr-rating-box">
  <div>
    <div class="gr-rating-score">{X.X}/5</div>
    <div class="gr-rating-label">Final Rating</div>
  </div>
  <div class="gr-rating-text">{2-3 sentences. Score justification. Personal sign-off. Sound like the reviewer.}</div>
</div>

[7] CTA BUTTON (HTML block)
<a href="{AFFILIATE_URL}" target="_blank" rel="noopener sponsored" class="gr-cta-link">
  🛒 See Today's Price on Amazon →
</a>

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
{"title":"...","slug":"...","excerpt":"...","tags":[...],"rating":"4.2","imagePrompts":{"hero":"...","lifestyle":"...","setting":"..."}}
%%META_END%%

BLOCK 2 — full HTML content, no JSON escaping needed:
%%CONTENT_START%%
[full assembled HTML blocks [1]–[7] with {VIDEO_ID} and {AFFILIATE_URL} filled in]
%%CONTENT_END%%

BLOCK 1 rules:
- Valid JSON, no line breaks inside strings
- excerpt: max 160 chars
- tags: 10 items — mix of broad high-traffic, niche-specific, and product/brand tags for SEO and social virality
- imagePrompts.hero: YouTube thumbnail style. Bold text overlay with short specific verdict (max 6 words, specific to this product outcome). NO hype words — banned: HONEST, TRUTH, REAL, SHOCKING, AMAZING, LEGIT, FINALLY, ACTUALLY, WORTH IT, REAL TALK. Dramatic product close-up, studio lighting, high contrast. No packaging, no box.
- imagePrompts.lifestyle: Person using exact product, shallow depth of field, bokeh background, no box/packaging.
- imagePrompts.setting: Clean flat lay, exact product, neutral surface, no box/packaging.

BLOCK 2 rules:
- Raw HTML only — no JSON, no markdown fences
- Include everything from [1] affiliate disclaimer through [8] hashtag tags (all 8 sections)

QUALITY CHECK:
✅ Reviewer's exact phrases and vocabulary used throughout
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

function extractAffiliateUrl(description: string): string {
  const geniusMatch = description.match(/https?:\/\/geni\.us\/[^\s)"'\]]+/)
  if (geniusMatch) return geniusMatch[0]
  const amazonMatch = description.match(/https?:\/\/(www\.)?amazon\.[a-z.]+\/[^\s)"'\]]+/)
  if (amazonMatch) return amazonMatch[0]
  const urlMatch = description.match(/https?:\/\/[^\s)"'\]]+/)
  if (urlMatch) return urlMatch[0]
  return ''
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
          content: `Analyze this YouTube video transcript and extract the reviewer's authentic voice profile. This will be used to write a blog post that sounds like them — not like AI.

VIDEO TITLE: ${title}

TRANSCRIPT:
${transcript.slice(0, 15000)}

Return a JSON object with exactly these fields:
{
  "signature_phrases": [8-12 verbatim quotes of memorable things they said — their exact wording, reactions, verdicts, jokes],
  "vocabulary": [15-20 words or short expressions they favor, repeat, or that feel distinctly like them],
  "personality": "2-3 sentences: how they talk — their directness, humor, enthusiasm, skepticism, how they deliver opinions",
  "key_opinions": [their actual stated opinions about the product, copied from the transcript as closely as possible],
  "specific_details": [exact numbers, comparisons, personal results, or experiences they mentioned — real specifics only]
}

Output only valid JSON. No explanation, no markdown.`,
        }],
      })
      return message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    } catch {
      return ''
    }
  }

  async generateBlogPost(brand: BrandProfile, video: VideoInput): Promise<BlogGenerationOutput> {
    const affiliateUrl = extractAffiliateUrl(video.description)

    // Pass 1 — extract voice profile from transcript (fast, cheap)
    let voiceProfile = ''
    if (video.transcript) {
      voiceProfile = await this.extractVoiceProfile(video.transcript, video.title)
    }

    const systemPrompt = buildSystemPrompt(brand, voiceProfile || undefined)

    const userMessage = `Generate a blog post for this YouTube review video.

VIDEO ID: ${video.videoId}
TITLE: ${video.title}
AFFILIATE URL: ${affiliateUrl || '[AFFILIATE_LINK]'}
VIDEO TAGS: ${video.tags.join(', ')}

VIDEO DESCRIPTION:
${video.description.slice(0, 2000)}

TRANSCRIPT:
${video.transcript ? video.transcript.slice(0, 20000) : 'No transcript available — base post on title, description, and tags only.'}`

    // Pass 2 — generate with extended thinking (streaming required for large max_tokens)
    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      thinking: { type: 'enabled', budget_tokens: 10000 },
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const message = await stream.finalMessage()

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

    return parsed
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
