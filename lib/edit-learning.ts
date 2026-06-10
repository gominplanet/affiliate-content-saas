// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Implicit edit-pattern learning (blog writer Sprint 3 Part 2, 2026-06-09).
//
// feedback-distill (117) learns from the EXPLICIT "Rewrite" notes a creator
// types. The richer, never-volunteered signal is what they actually CHANGE: the
// diff between the AI draft we stored (blog_posts.content) and the version they
// published + edited on WordPress. If a creator quietly cuts every opening hook
// to one line, removes every superlative, and adds a personal setup anecdote,
// they'll never type that as feedback — but it's the truest statement of their
// taste, and it's sitting in the gap between our draft and their live post.
//
// This module fetches the live WP content for a creator's recent posts, diffs
// it against our stored draft at the SENTENCE level (markup ignored — only the
// prose), and when enough posts show real human edits, Haiku-distills the
// recurring changes into a standing rule set cached on
// brand_profiles.edit_pattern_feedback. Generation injects those rules next to
// the explicit distilled_feedback.
//
// Mirrors lib/feedback-distill.ts: fire-and-forget from the post-publish path,
// debounced, silent failure, never load-bearing. Requires migration 118; the
// catch swallows the missing-column error so shipping before the migration is
// a safe no-op.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

const DEBOUNCE_MS = 24 * 60 * 60 * 1000 // 24h — slower cadence than 117; edits trickle in over days
const MAX_POSTS = 8                      // recent posts to inspect per run (bounds WP round trips)
const MIN_EDITED_POSTS = 2               // need this many genuinely-edited posts before distilling
const MIN_CHANGE = 0.03                  // <3% sentence change = noise (markup, a typo) — not a real edit
const MAX_CHANGE = 0.6                   // >60% = a rebuild / different post / image refresh — not a human tweak
const MAX_SNIPPETS = 8                   // cap removed/added sentences captured per post (token budget)

interface EditLearnCtx {
  userId: string
  tier?: string | null
}

interface EditSample {
  removed: string[] // sentences in OUR draft that the human cut
  added: string[]   // sentences in the published post that the human wrote
}

/**
 * Fire-and-forget post-publish. Pulls the creator's recent published posts,
 * fetches each live WP version, diffs it against our stored draft, and — if
 * enough posts were genuinely edited — Haiku-distills the recurring pattern
 * into standing rules on brand_profiles.edit_pattern_feedback.
 *
 * Returns true when a distillation actually ran. Caller doesn't await.
 * Degrades to a silent no-op pre-migration (missing-column error is caught).
 */
export async function maybeLearnFromEdits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: EditLearnCtx,
): Promise<boolean> {
  try {
    // Debounce on the cached timestamp.
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('edit_pattern_feedback_at')
      .eq('user_id', ctx.userId)
      .maybeSingle()
    const last = brand?.edit_pattern_feedback_at
    if (last && Date.now() - new Date(last).getTime() < DEBOUNCE_MS) return false

    // Recent published posts that have BOTH a live WP id and our stored draft.
    const { data: postRows } = await supabase
      .from('blog_posts')
      .select('id,content,wordpress_post_id,wordpress_site_id')
      .eq('user_id', ctx.userId)
      .eq('status', 'published')
      .not('wordpress_post_id', 'is', null)
      .order('published_at', { ascending: false })
      .limit(MAX_POSTS)

    const posts = ((postRows ?? []) as Array<{
      id: string; content: string | null; wordpress_post_id: number | string | null; wordpress_site_id: string | null
    }>).filter(p => p.content && p.wordpress_post_id)
    if (posts.length === 0) return false

    // Fetch live WP content + diff, limited concurrency.
    const samples: EditSample[] = []
    const CONCURRENCY = 4
    for (let i = 0; i < posts.length; i += CONCURRENCY) {
      const batch = posts.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(p => diffPost(supabase, ctx.userId, p)))
      for (const r of results) if (r) samples.push(r)
    }

    if (samples.length < MIN_EDITED_POSTS) {
      // Not enough real edits to learn from — still stamp the timestamp so we
      // don't re-fetch WP on every generation for the next 24h.
      await stamp(supabase, ctx.userId, null)
      return false
    }

    const rules = await distillEdits(samples, ctx)
    await stamp(supabase, ctx.userId, rules) // rules=null → timestamp-only (keeps any prior rules)
    return Boolean(rules)
  } catch {
    // Silent — telemetry, not load-bearing. Also catches the missing-column
    // case pre-migration 118.
    return false
  }
}

/**
 * Fetch a post's live WP content and diff it against our stored draft.
 * Returns the removed/added sentence sets when the human made a real (but not
 * total) edit; null otherwise.
 */
async function diffPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  post: { content: string | null; wordpress_post_id: number | string | null; wordpress_site_id: string | null },
): Promise<EditSample | null> {
  try {
    const creds = await getWordPressCredentials(supabase, userId, post.wordpress_site_id ?? null)
    if (!creds) return null
    const auth = Buffer.from(`${creds.wordpress_username}:${creds.wordpress_app_password}`).toString('base64')
    const base = creds.wordpress_url.replace(/\/+$/, '')
    // context=edit returns content.raw (the editor HTML), the closest match to
    // the Gutenberg HTML we stored — so the diff reflects prose edits, not the
    // server-side render transform.
    const res = await fetch(`${base}/wp-json/wp/v2/posts/${post.wordpress_post_id}?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { content?: { raw?: string } } | null
    const wpRaw = data?.content?.raw
    if (typeof wpRaw !== 'string' || !wpRaw) return null

    const ours = htmlToSentences(post.content || '')
    const theirs = htmlToSentences(wpRaw)
    if (ours.length < 3 || theirs.length < 3) return null

    const oursSet = new Set(ours.map(normSentence))
    const theirsSet = new Set(theirs.map(normSentence))

    // Jaccard distance over sentence sets = "how much did the human change".
    const union = new Set([...oursSet, ...theirsSet])
    let shared = 0
    for (const s of oursSet) if (theirsSet.has(s)) shared++
    const change = union.size > 0 ? 1 - shared / union.size : 0
    if (change < MIN_CHANGE || change > MAX_CHANGE) return null

    const removed = ours.filter(s => !theirsSet.has(normSentence(s))).slice(0, MAX_SNIPPETS)
    const added = theirs.filter(s => !oursSet.has(normSentence(s))).slice(0, MAX_SNIPPETS)
    if (removed.length === 0 && added.length === 0) return null
    return { removed, added }
  } catch {
    return null
  }
}

/** Haiku-distill the per-post edit samples into a small standing rule set. */
async function distillEdits(samples: EditSample[], ctx: EditLearnCtx): Promise<string | null> {
  try {
    const blocks = samples
      .map((s, i) => {
        const removed = s.removed.length ? `REMOVED (the creator cut these):\n${s.removed.map(x => `  - ${x}`).join('\n')}` : ''
        const added = s.added.length ? `ADDED (the creator wrote these):\n${s.added.map(x => `  - ${x}`).join('\n')}` : ''
        return `POST ${i + 1}\n${[removed, added].filter(Boolean).join('\n')}`
      })
      .join('\n\n')

    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: 'You analyze how a content creator edits AI-written product reviews — what they consistently cut and what they add — and distill it into a short set of standing style rules for the AI writer to follow next time. Focus on RECURRING patterns across posts, not one-offs. Never use the word "honest".',
      messages: [{
        role: 'user',
        content: `Below are real edits a creator made to AI-written reviews: for each post, the sentences they REMOVED from the draft and the ones they ADDED. Infer what they consistently want and state it as rules the AI should follow on every future draft.

RULES FOR DISTILLING:
- Look for PATTERNS that repeat across posts. If the creator cut the opening line in 3 posts, that's a rule: "Open with the first real point — no scene-setting preamble."
- Translate ADDED content into voice/substance rules ("works in a first-person anecdote about real-world setup", "names the specific use-case").
- Translate REMOVED content into avoid-rules ("drops superlatives like 'game-changer'", "cuts filler transitions").
- Ignore changes that are obviously markup, image swaps, or one-off corrections — only encode taste that recurs.
- Each rule is ONE short imperative line. Output 3-8 rules max as a plain "- " bullet list. Nothing else.

THE EDITS:
${blocks}`.slice(0, 12000),
      }],
    }, { timeout: 30_000 })

    recordAnthropicUsage(msg, {
      userId: ctx.userId,
      tier: ctx.tier ?? null,
      feature: 'blog_edit_learning',
      model: 'claude-haiku-4-5-20251001',
    })

    const text = (msg.content[0] as { type: string; text: string }).text.trim()
    if (!text || text.length < 5 || !text.includes('-')) return null
    return text.slice(0, 1500)
  } catch {
    return null
  }
}

/** Update the cache. When rules is null we stamp only the timestamp (debounce)
 *  and KEEP any previously-learned rules — a quiet 24h doesn't erase taste. */
async function stamp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  rules: string | null,
): Promise<void> {
  const patch = rules
    ? { edit_pattern_feedback: rules, edit_pattern_feedback_at: new Date().toISOString() }
    : { edit_pattern_feedback_at: new Date().toISOString() }
  await supabase.from('brand_profiles').update(patch).eq('user_id', userId)
}

// ── prose extraction ─────────────────────────────────────────────────────────

/** Strip a blog post's HTML down to its prose sentences. Removes Gutenberg
 *  block comments, <style>/<script>, all tags, and decodes the few entities
 *  that matter, then splits on sentence boundaries and drops short fragments
 *  (nav, button labels, list scraps) so the diff compares real writing. */
function htmlToSentences(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')        // Gutenberg block comments
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')                // all remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 25) // skip fragments, headings-as-words, button text
}

/** Normalise a sentence for set comparison: lowercase, strip punctuation,
 *  collapse whitespace. Two sentences that differ only in casing/punctuation
 *  count as "the same" so we don't flag trivial diffs as edits. */
function normSentence(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}
