// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The continually-learning voice agent.
//
// MVP's whole promise is originality: content that sounds like the specific
// creator, not a generic AI blog. The manual Voice Training page (learn_profile)
// captures what a creator can articulate; learn-evolve fills the empty slots
// once. Neither keeps getting better as the creator ships more.
//
// This module does. It maintains a persistent, plain-text "voice fingerprint"
// on brand_profiles.voice_fingerprint and REFINES it incrementally: each run
// folds in the YouTube transcripts it hasn't seen yet (the creator's actual
// spoken voice — the truest signal we have for how they sound) plus a recent
// published post for written-format habits, and rewrites the fingerprint so it
// keeps what's still true and sharpens the rest. The more videos MVP reads, the
// better it understands the creator.
//
// Two hard rules:
//   1. The creator's OWN words are ground truth. Transcripts (spoken) and their
//      writing sample define the voice. MVP-generated posts are only a weak
//      signal for format habits — never the model of the voice itself, or the
//      agent would slowly learn to imitate its own output (echo chamber).
//   2. Additive to, never a replacement for, the manual profile. The fingerprint
//      is separate context; the hand-tuned learn_profile always stands.
//
// Fire-and-forget from the post-publish path, debounced, silent on failure,
// cost-tracked. Requires migration 301; a missing column is swallowed so
// shipping ahead of the migration is a safe no-op.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

const DEBOUNCE_MS = 12 * 60 * 60 * 1000 // 12h — voice drifts slowly; no need to run more often
const MAX_NEW_VIDEOS = 6                 // new transcripts folded in per run (bounds cost)
const MAX_FINGERPRINT_CHARS = 4000       // keep the stored profile compact enough to inject everywhere

interface Ctx {
  userId: string
  tier?: string | null
}

function stripMarkup(html: string): string {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Refine (or bootstrap) the creator's voice fingerprint from any transcripts we
 * haven't learned from yet. Returns true when it actually ran + saved.
 * Caller doesn't await — fire-and-forget.
 */
export async function maybeUpdateVoiceFingerprint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: Ctx,
): Promise<boolean> {
  try {
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('voice_fingerprint,voice_fingerprint_updated_at,voice_fingerprint_sources,voice_fingerprint_seen,writing_sample')
      .eq('user_id', ctx.userId)
      .single()

    // Debounce: don't re-run within the window (a creator shipping a burst of
    // posts shouldn't fire this on every one).
    const last = brand?.voice_fingerprint_updated_at
    if (last && Date.now() - new Date(last).getTime() < DEBOUNCE_MS) return false

    const seen: string[] = Array.isArray(brand?.voice_fingerprint_seen)
      ? (brand.voice_fingerprint_seen as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    const seenSet = new Set(seen)

    // Pull recent transcribed videos and keep only the ones not yet folded in.
    // Newest first so the fingerprint tracks how the creator sounds lately.
    const { data: vids } = await supabase
      .from('youtube_videos')
      .select('id,title,transcript,transcript_fetched_at')
      .eq('user_id', ctx.userId)
      .not('transcript', 'is', null)
      .order('transcript_fetched_at', { ascending: false, nullsFirst: false })
      .limit(40)

    const newVideos = (Array.isArray(vids) ? vids : [])
      .filter((v: { id: string; transcript: string | null }) => v.id && !seenSet.has(v.id) && (v.transcript || '').trim().length > 200)
      .slice(0, MAX_NEW_VIDEOS)

    // Nothing new to learn from → skip. (The manual profile + existing
    // fingerprint already cover the writer's needs.)
    if (newVideos.length === 0) return false

    // One recent published post as a SECONDARY signal for written-format habits
    // only (headings, list use, link style). Never the model of the voice.
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('title,content')
      .eq('user_id', ctx.userId)
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const recentPost = (Array.isArray(posts) && posts[0])
      ? `── "${posts[0].title}" ──\n${stripMarkup(posts[0].content as string).slice(0, 1200)}`
      : ''

    const transcriptBlock = newVideos
      .map((v: { title: string; transcript: string }) => `── VIDEO: ${v.title || 'Untitled'} ──\n${(v.transcript || '').replace(/\s+/g, ' ').trim().slice(0, 2500)}`)
      .join('\n\n')

    const current = (brand?.voice_fingerprint as string | null)?.trim() || ''
    const writingSample = ((brand?.writing_sample as string) || '').trim().slice(0, 800)

    const anthropic = createAnthropicClient()
    const system = `You study how ONE creator actually sounds and maintain a living style guide MVP's writers follow so their blog posts read like the creator wrote them, not like generic AI. You return ONLY the updated style guide as plain text, no preamble, no markdown headings syntax, no code fence.`

    const prompt = `${current
      ? `Here is the CURRENT voice fingerprint for this creator. Refine it with the new evidence below: keep what still holds true, sharpen vague parts, and add anything new the transcripts reveal. Do not discard earlier observations unless the new evidence contradicts them.\n\nCURRENT VOICE FINGERPRINT:\n"""\n${current}\n"""\n`
      : `Build the FIRST voice fingerprint for this creator from the evidence below.`}

GROUND TRUTH = the creator's OWN spoken words in the transcripts below. That is how they actually talk, and the written voice should echo it. ${recentPost ? 'The published post is only for written-format habits (how they use headings, lists, links); do not treat its wording as the voice, since MVP may have drafted it.' : ''} ${writingSample ? 'The writing sample is the creator\'s own, treat it as voice signal too.' : ''}

Capture, concretely and only where the evidence supports it:
- Signature phrases, filler words, and turns of phrase they actually use.
- Vocabulary level and any recurring slang or jargon.
- Sentence rhythm (short and punchy vs long and winding), and how they open and close a thought.
- How they show opinion, humor, skepticism, or enthusiasm.
- Pacing: do they tease, digress, compare, tell stories, ask rhetorical questions?
- Pet peeves / things they'd never say.

Write it as a direct, practical guide (2nd person: "You tend to...", "You open with..."). Be specific with examples pulled from the evidence. Do NOT invent traits you can't see. Keep it under ${Math.floor(MAX_FINGERPRINT_CHARS * 0.9)} characters.

${writingSample ? `WRITING SAMPLE (creator's own):\n"""${writingSample}"""\n\n` : ''}NEW TRANSCRIPTS (creator speaking — primary evidence):
${transcriptBlock}
${recentPost ? `\nRECENT PUBLISHED POST (format habits only):\n${recentPost}` : ''}`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, {
      userId: ctx.userId, tier: ctx.tier ?? null,
      feature: 'voice_fingerprint', model: 'claude-haiku-4-5-20251001',
    })

    let text = ''
    for (const b of msg.content) if (b.type === 'text') text += b.text
    text = text.trim().slice(0, MAX_FINGERPRINT_CHARS)
    if (text.length < 120) return false

    // Fold the new video ids into `seen` (cap the stored list so it can't grow
    // without bound) and bump the learned-from counter.
    const nextSeen = [...newVideos.map((v: { id: string }) => v.id), ...seen].slice(0, 500)
    const nextSources = (Number(brand?.voice_fingerprint_sources) || 0) + newVideos.length

    await supabase
      .from('brand_profiles')
      .update({
        voice_fingerprint: text,
        voice_fingerprint_updated_at: new Date().toISOString(),
        voice_fingerprint_sources: nextSources,
        voice_fingerprint_seen: nextSeen,
      })
      .eq('user_id', ctx.userId)

    return true
  } catch {
    // Silent — telemetry, not load-bearing. Also swallows the missing-column
    // error when running ahead of migration 301.
    return false
  }
}

/**
 * Render the stored fingerprint into a writer-prompt block. Returns '' when the
 * creator has no fingerprint yet, so prompts aren't padded with an empty header.
 */
export function buildLearnedVoiceBlock(fingerprint?: string | null): string {
  const fp = (fingerprint || '').trim()
  if (fp.length < 120) return ''
  return `WHAT MVP HAS LEARNED ABOUT HOW THIS CREATOR SOUNDS (from their own videos over time — write so a regular reader would recognize it as them):
${fp}`
}
