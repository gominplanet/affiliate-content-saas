// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Edit-feedback distillation (blog writer Sprint 3, 2026-06-09).
//
// Every time a Pro user hits "Rewrite" and types what was missing, the note
// is persisted to blog_posts.last_rewrite_feedback. Generation pulls the most
// recent 8 of these and injects them RAW into the prompt as "standing user
// feedback." That works, but raw injection has two problems:
//   1. Redundancy — a user who's typed "make the intro shorter" five times
//      across five posts gets five separate lines that say the same thing.
//      The repetition wastes prompt budget AND under-signals (five identical
//      notes should read as ONE strong rule, not five weak ones).
//   2. Contradiction drift — early notes may conflict with later ones, and
//      raw injection gives them equal weight.
//
// This module distills the raw notes into a small set of DEDUPLICATED,
// WEIGHTED standing rules. "Make the intro shorter" × 5 becomes one rule
// flagged as a STRONG recurring preference. Cached to brand_profiles so the
// distillation cost is paid once (not per generation) and refreshed only when
// new feedback has accumulated.
//
// Mirrors lib/learn-evolve.ts exactly: fire-and-forget from the post-publish
// path, debounced, silent failure. Never load-bearing — generation falls back
// to the raw notes when no distilled cache exists.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

const DEBOUNCE_MS = 6 * 60 * 60 * 1000 // 6 hours — same as learn-evolve
const MIN_NOTES = 3                      // below this, raw injection is fine

interface DistillCtx {
  userId: string
  tier?: string | null
}

/**
 * Fire-and-forget post-publish. Pulls the user's accumulated rewrite notes,
 * and IF there are enough of them AND we haven't distilled recently, asks
 * Haiku to collapse them into a deduplicated, weighted rule set cached on
 * brand_profiles.distilled_feedback.
 *
 * Returns true when a distillation actually ran. Caller doesn't await.
 *
 * Requires migration 117 (brand_profiles.distilled_feedback +
 * distilled_feedback_at). Degrades to a silent no-op if the columns don't
 * exist yet — the catch swallows the PostgREST "column not found" error, so
 * shipping this before the migration runs is safe.
 */
export async function maybeDistillFeedback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: DistillCtx,
): Promise<boolean> {
  try {
    // Pull the distill timestamp + ALL rewrite notes (cap 30 — older than
    // that is stale taste) in parallel.
    const [{ data: brand }, { data: noteRows }] = await Promise.all([
      supabase
        .from('brand_profiles')
        .select('distilled_feedback_at')
        .eq('user_id', ctx.userId)
        .maybeSingle(),
      supabase
        .from('blog_posts')
        .select('last_rewrite_feedback,published_at')
        .eq('user_id', ctx.userId)
        .not('last_rewrite_feedback', 'is', null)
        .order('published_at', { ascending: false })
        .limit(30),
    ])

    const notes = (noteRows as Array<{ last_rewrite_feedback: string | null }> | null)
      ?.map(r => (r.last_rewrite_feedback || '').trim())
      .filter(s => s.length > 0) ?? []

    if (notes.length < MIN_NOTES) return false

    const last = brand?.distilled_feedback_at
    if (last && Date.now() - new Date(last).getTime() < DEBOUNCE_MS) return false

    const distilled = await distill(notes, ctx)
    if (!distilled) return false

    await supabase
      .from('brand_profiles')
      .update({
        distilled_feedback: distilled,
        distilled_feedback_at: new Date().toISOString(),
      })
      .eq('user_id', ctx.userId)

    return true
  } catch {
    // Silent — telemetry, not load-bearing. Also catches the
    // "column distilled_feedback does not exist" case pre-migration.
    return false
  }
}

/**
 * Haiku-distill the raw notes into a small deduplicated, weighted rule set.
 * Returns plain text (a short bulleted list) or null on any failure.
 */
async function distill(notes: string[], ctx: DistillCtx): Promise<string | null> {
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: 'You distill a content creator\'s repeated editing feedback into a short, deduplicated set of standing style rules for an AI writer. You merge repeats, weight recurring themes, and drop one-offs that contradict the pattern. Never use the word "honest".',
      messages: [{
        role: 'user',
        content: `Below are the editing notes a creator has left on AI-written product reviews over time (newest first). They typed each one when a draft missed the mark. Collapse them into a SHORT set of clear standing rules the AI should follow on every future draft.

RULES FOR DISTILLING:
- MERGE near-duplicates into one rule. If "make the intro shorter", "intro is too long", and "tighten the opening" all appear, that's ONE rule.
- WEIGHT by frequency. A preference the creator has repeated 3+ times is a STRONG rule — mark it "(strong — repeated)". A one-off is a normal rule.
- DROP contradictions in favor of the more recent / more frequent signal. If early notes say "more detail" but recent + repeated notes say "keep it tight", keep "tight".
- Keep each rule to ONE short imperative line. No preamble, no explanation.
- Output 3-8 rules max as a plain bullet list (use "- "). Nothing else.

THE NOTES (newest first):
${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
      }],
    }, { timeout: 30000 })

    recordAnthropicUsage(msg, {
      userId: ctx.userId,
      tier: ctx.tier ?? null,
      feature: 'blog_feedback_distill',
      model: 'claude-haiku-4-5-20251001',
    })

    const text = (msg.content[0] as { type: string; text: string }).text.trim()
    // Sanity: must look like a bullet list and be non-trivial.
    if (!text || text.length < 5 || !text.includes('-')) return null
    return text.slice(0, 1500)
  } catch {
    return null
  }
}
