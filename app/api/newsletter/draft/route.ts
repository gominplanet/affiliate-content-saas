/**
 * POST /api/newsletter/draft — generate a newsletter draft via Claude
 *
 * Inputs:
 *   blogPostIds       string[]   blog_posts.id rows the creator picked
 *   personalMessage   string?    free-text "what I want to tell you"
 *   curatedLinks      [{url, label?, blurb}]?   creator's external picks
 *
 * Output:
 *   { ok: true, draft: { subject, intro, postBlurbs[], outro,
 *                        html, plainText, brand, posts, links } }
 *
 * The HTML is a PREVIEW rendered with a fake unsubscribe link — the real
 * send pipeline re-renders per recipient with a per-token unsub URL so we
 * never include the same link in two subscribers' copies. The preview
 * goes straight into the compose page's iframe (sandboxed) so the
 * creator sees exactly what subscribers will see.
 */
import { NextResponse } from 'next/server'
import { denyNewsletterWrite } from '@/lib/agency'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterRenderInput,
  type NewsletterBlogPost,
  type NewsletterCuratedLink,
} from '@/lib/newsletter-html'

// Public app URL used inside preview links (real send re-renders with
// the actual per-recipient URL). Falls back to mvpaffiliate.io if unset.
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

interface DraftInput {
  blogPostIds?: string[]
  personalMessage?: string
  curatedLinks?: Array<{ url?: string; label?: string; blurb?: string }>
}

interface DraftCopy {
  subject: string
  intro: string
  outro: string
  blurbs: string[] // one per blog post, same order as input
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await denyNewsletterWrite(user.id)
  if (denied) return denied

  let body: DraftInput
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const ids = Array.isArray(body.blogPostIds)
    ? body.blogPostIds.filter((s): s is string => typeof s === 'string').slice(0, 8)
    : []
  const personalMessage = (body.personalMessage || '').trim().slice(0, 2000)
  const curatedRaw = Array.isArray(body.curatedLinks) ? body.curatedLinks.slice(0, 6) : []
  const curatedLinks: NewsletterCuratedLink[] = curatedRaw
    .map(l => ({
      url: (l.url || '').trim(),
      label: (l.label || '').trim() || null,
      blurb: (l.blurb || '').trim().slice(0, 400),
    }))
    .filter(l => /^https?:\/\//.test(l.url) && l.blurb.length > 0)

  if (ids.length === 0 && curatedLinks.length === 0 && !personalMessage) {
    return NextResponse.json({ error: 'Pick at least one blog post, add a curated link, or write a personal message.' }, { status: 400 })
  }

  // ── Load the picked blog posts ─────────────────────────────────────────────
  let posts: NewsletterBlogPost[] = []
  if (ids.length > 0) {
    // thumbnail_url lives on youtube_videos, NOT blog_posts — same join the
    // /blog-posts picker route uses. Without it the email cards ship without
    // the video thumbnail (and we ended up with a "no posts" bug in the
    // first cut of the picker route).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await supabase
      .from('blog_posts')
      .select('id,title,excerpt,wordpress_url,youtube_videos(thumbnail_url)')
      .eq('user_id', user.id)
      .in('id', ids)
      .eq('status', 'published')
    const lookup = new Map<string, NewsletterBlogPost>()
    for (const r of (rows as Array<{ id: string; title: string | null; excerpt: string | null; wordpress_url: string | null; youtube_videos: { thumbnail_url: string | null } | null }> | null) ?? []) {
      if (!r.wordpress_url) continue
      lookup.set(r.id, {
        url: r.wordpress_url,
        title: (r.title || 'Untitled').trim(),
        excerpt: (r.excerpt || '').trim(),
        imageUrl: r.youtube_videos?.thumbnail_url || null,
        blurb: null, // filled in by Claude below
      })
    }
    // Preserve the order the creator picked.
    posts = ids.map(id => lookup.get(id)).filter((p): p is NewsletterBlogPost => !!p)
  }

  // ── Load brand context for the Claude prompt + the email shell ─────────────
  // wordpress_url comes from the default site (multi-site users have many;
  // newsletter footer points at the default brand). Tier is per-user.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: brand }, { data: integ }, { data: nlSettings }, defaultSite] = await Promise.all([
    supabase.from('brand_profiles').select('name,author_name,niches,tone,writing_sample,headshot_url,logo_url').eq('user_id', user.id).maybeSingle(),
    supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle(),
    supabase.from('newsletter_settings').select('sender_name,mailing_address').eq('user_id', user.id).maybeSingle(),
    getWordPressCredentials(supabase, user.id),
  ])

  const brandName = (nlSettings?.sender_name as string) || (brand?.name as string) || 'My Newsletter'
  const authorName = (brand?.author_name as string) || ''
  const tone: string[] = Array.isArray(brand?.tone) ? (brand!.tone as string[]) : []
  const writingSample = ((brand?.writing_sample as string) || '').slice(0, 800)
  const niches: string[] = Array.isArray(brand?.niches) ? (brand!.niches as string[]).slice(0, 4) : []
  const tier = (integ?.tier as string | undefined) || 'trial'

  // Monthly AI-spend circuit breaker (Sonnet newsletter writer).
  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  // ── Claude prompt — return strict JSON we then parse ───────────────────────
  const postsForPrompt = posts.map((p, i) => `${i + 1}. ${p.title} — ${p.excerpt.slice(0, 240)}`).join('\n')
  const linksForPrompt = curatedLinks.map((l, i) => `${i + 1}. ${l.label || l.url} — ${l.blurb}`).join('\n')

  const promptBody = `You're writing a newsletter for the creator behind "${brandName}".${authorName ? ` Written in the voice of ${authorName}.` : ''}${niches.length ? ` Niche: ${niches.join(', ')}.` : ''}

VOICE GUIDELINES${tone.length ? ` (tone keywords from the creator's brand profile): ${tone.join(', ')}` : ''}:
- First person ("I"/"we"). NEVER refer to the creator in the third person.
- NEVER use the word "honest", "honestly" or any form of it. Banned.
- Sound like a knowledgeable friend writing one email, not a marketing department.
- No corporate phrases like "we're excited to share", "without further ado", "I hope this finds you well".
${writingSample ? `- Match THIS voice (the creator's own writing sample):\n"""${writingSample}"""` : ''}

WHAT'S IN THE ISSUE:
${posts.length ? `Blog posts (in order, please write one short blurb for each — one sentence, why it's worth reading):\n${postsForPrompt}` : '(no blog posts selected)'}

${personalMessage ? `Personal message from the creator (will appear verbatim in the email — your intro should reference it naturally, NOT repeat it):\n"""${personalMessage}"""\n` : ''}

${curatedLinks.length ? `Curated external picks (already written by the creator — don't rewrite, just be aware they're in the issue):\n${linksForPrompt}\n` : ''}

Write the newsletter copy. Return a SINGLE JSON object with this exact shape — no markdown, no prose around it:

{
  "subject": "<the email subject — under 70 chars, specific to what's in this issue, no clickbait, no emojis>",
  "intro": "<1-3 sentences. Friendly opener. Mention what's coming in this issue without listing it bullet-style. ${personalMessage ? 'Lead naturally into the creator\'s personal message that follows.' : ''}>",
  "blurbs": [${posts.length ? `${posts.map(() => '"<one sentence about why this post is worth their time, written like the creator>"').join(', ')}` : ''}],
  "outro": "<1-2 sentences. Sign-off. Warm but not saccharine. End with the creator's first name when it's known.>"
}

RULES:
- subject must be ≤ 70 chars.
- intro: 1-3 sentences, ≤ 280 chars.
- each blurb in blurbs: ONE sentence, ≤ 180 chars.
- outro: 1-2 sentences, ≤ 240 chars.
- No emojis anywhere unless the writing sample uses them.`

  let copy: DraftCopy
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: promptBody }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'newsletter_draft', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('Model returned no JSON')
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Partial<DraftCopy>
    copy = {
      subject: ((parsed.subject || '') + '').trim().slice(0, 120),
      intro: ((parsed.intro || '') + '').trim().slice(0, 600),
      outro: ((parsed.outro || '') + '').trim().slice(0, 500),
      blurbs: Array.isArray(parsed.blurbs) ? parsed.blurbs.slice(0, posts.length).map(s => ((s || '') + '').trim().slice(0, 280)) : [],
    }
  } catch (err) {
    // Graceful fallback — if Claude is rate-limited or returns garbage, ship
    // a clean default so the creator can edit by hand. Better than 500ing.
    copy = {
      subject: posts[0]?.title || `New from ${brandName}`,
      intro: posts.length > 1
        ? `A few new reviews from this week — here's what's worth your time.`
        : `Fresh review for you this week.`,
      outro: `Reply anytime — I read every one.${authorName ? `\n— ${authorName.split(' ')[0]}` : ''}`,
      blurbs: posts.map(() => ''),
    }
  }

  // Attach the blurbs to the posts in order.
  posts.forEach((p, i) => { p.blurb = copy.blurbs[i] || null })

  // Honest-word ban — the post-write scrub. Drops the word anywhere the model
  // slipped it in despite the prompt. Case-insensitive, all variants.
  const stripHonest = (s: string): string => s
    .replace(/\b(?:honestly|honesty|honest)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  copy.subject = stripHonest(copy.subject)
  copy.intro = stripHonest(copy.intro)
  copy.outro = stripHonest(copy.outro)
  posts.forEach(p => { if (p.blurb) p.blurb = stripHonest(p.blurb) })

  // ── Render the preview ─────────────────────────────────────────────────────
  // Preview gets a FAKE unsubscribe link (a clearly-marked placeholder) so
  // the creator never accidentally clicks it from the preview iframe and
  // unsubscribes a real subscriber. The send pipeline re-renders with the
  // real per-token URL.
  const input: NewsletterRenderInput = {
    subject: copy.subject,
    intro: copy.intro,
    personalMessage: personalMessage || null,
    outro: copy.outro,
    posts,
    curatedLinks,
    brand: {
      name: brandName,
      siteUrl: defaultSite?.wordpress_url ?? null,
      logoUrl: (brand?.logo_url as string) || (brand?.headshot_url as string) || null,
      mailingAddress: (nlSettings?.mailing_address as string) || null,
      byline: authorName || null,
    },
    links: {
      unsubscribeUrl: `${APP_BASE}/newsletter-unsubscribed?preview=1`,
      viewInBrowserUrl: null,
    },
  }
  const html = renderNewsletterHtml(input)
  const plainText = renderNewsletterText(input)

  return NextResponse.json({
    ok: true,
    draft: {
      subject: copy.subject,
      intro: copy.intro,
      outro: copy.outro,
      personalMessage: personalMessage || null,
      posts,
      curatedLinks,
      html,
      plainText,
      brand: input.brand,
    },
  })
}
