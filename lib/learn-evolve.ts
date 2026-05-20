/**
 * Auto-fill EMPTY slots in a user's LEARN profile by reading their
 * most-recently-published posts and asking Haiku to infer their voice.
 *
 * Crucial semantic: ADDITIVE only. Slots the user has already filled
 * by hand are never touched — we only fill the gaps the AI can
 * confidently read from their writing. Manual entries always win.
 *
 * Triggered fire-and-forget after a successful publish when:
 *   • user has ≥ 5 published posts, AND
 *   • at least one slot in their LEARN profile is empty, AND
 *   • we haven't evolved their profile in the last 6 hours
 *     (debounce so a user shipping 10 posts in a row doesn't fire
 *     the helper 10 times).
 *
 * Failures are silent — telemetry, not load-bearing.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import {
  VOICE_QUESTIONS,
  STYLE_AXES,
  SPEECH_PATTERNS,
  THOUGHT_PROCESS,
  normalizeLearnProfile,
  type LearnProfile,
} from '@/lib/learn'

const DEBOUNCE_MS = 6 * 60 * 60 * 1000 // 6 hours
const MIN_POSTS = 5

interface EvolveCtx {
  userId: string
  tier?: string | null
}

/**
 * Returns true when an evolution actually ran. Caller doesn't need to
 * await — fire-and-forget from post-publish paths.
 */
export async function maybeEvolveLearnProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: EvolveCtx,
): Promise<boolean> {
  try {
    // Pull profile + post count + last-evolve timestamp in parallel.
    const [{ data: brand }, { count }] = await Promise.all([
      supabase
        .from('brand_profiles')
        .select('learn_profile,learn_profile_evolved_at')
        .eq('user_id', ctx.userId)
        .single(),
      supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .eq('status', 'published'),
    ])

    if ((count ?? 0) < MIN_POSTS) return false

    const lp = normalizeLearnProfile(brand?.learn_profile)
    if (!hasEmptySlots(lp)) return false

    const last = brand?.learn_profile_evolved_at
    if (last && Date.now() - new Date(last).getTime() < DEBOUNCE_MS) return false

    // Pull last 5 posts as evidence.
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('title,content')
      .eq('user_id', ctx.userId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(5)

    const examples = (posts as Array<{ title: string; content: string }> | null)
      ?.map(p => `── "${p.title}" ──\n${stripMarkup(p.content).slice(0, 1500)}`)
      .join('\n\n') ?? ''
    if (!examples) return false

    const filled = await askAgentToFillGaps(lp, examples, ctx)
    if (!filled) return false

    // Merge — never overwrite an already-filled slot.
    const merged = mergeAdditive(lp, filled)

    await supabase
      .from('brand_profiles')
      .update({
        learn_profile: merged,
        learn_profile_evolved_at: new Date().toISOString(),
      })
      .eq('user_id', ctx.userId)

    return true
  } catch {
    return false
  }
}

function hasEmptySlots(lp: LearnProfile): boolean {
  for (const q of VOICE_QUESTIONS) if (!lp.voice[q.key]) return true
  for (const a of STYLE_AXES) if (!lp.style[a.key]) return true
  if (lp.speech_patterns.length === 0) return true
  if (lp.thought_process.length === 0) return true
  return false
}

function stripMarkup(html: string): string {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Returns a partial LearnProfile with only the slots the agent had
 *  high confidence about. null on any failure. */
async function askAgentToFillGaps(
  current: LearnProfile,
  examples: string,
  ctx: EvolveCtx,
): Promise<Partial<LearnProfile> | null> {
  const emptyVoice = VOICE_QUESTIONS.filter(q => !current.voice[q.key])
  const emptyStyle = STYLE_AXES.filter(a => !current.style[a.key])
  const needsSpeech = current.speech_patterns.length === 0
  const needsThought = current.thought_process.length === 0

  // Nothing to do.
  if (emptyVoice.length === 0 && emptyStyle.length === 0 && !needsSpeech && !needsThought) {
    return null
  }

  const voiceQuestions = emptyVoice
    .map(q => `  "${q.key}": "<your read in 1-2 sentences, based on what you see in their posts>"`).join(',\n')
  const styleAxes = emptyStyle
    .map(a => `  "${a.key}": "<one of: '${a.left}' | '${a.right}' — pick the one their writing leans toward>"`).join(',\n')

  const anthropic = createAnthropicClient()
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: 'You read a writer\'s published posts and infer their voice. Return ONLY valid JSON. Skip any field you are not confident about — be honest rather than inventing answers.',
      messages: [{
        role: 'user',
        content: `Read these recent posts by ONE writer. Then infer answers for the empty slots in their voice profile.

CRITICAL RULES:
- ONLY fill a field if you have STRONG evidence from the posts. Skip the field entirely (omit the key, don't return null) if uncertain.
- Write voice answers in the WRITER's voice ("I find X annoying" not "The writer finds X annoying"). 1-2 sentences each.
- For style axes, pick whichever side their writing actually demonstrates. Skip if ambiguous.
- For speech_patterns / thought_process, return ONLY the keys you see clear evidence of.

POSTS:
${examples}

Return JSON in this shape (omit any key you can't confidently infer):
{
${voiceQuestions ? `  "voice": {\n${voiceQuestions}\n  },` : ''}
${styleAxes ? `  "style": {\n${styleAxes}\n  },` : ''}
${needsSpeech ? `  "speech_patterns": [/* any of: ${SPEECH_PATTERNS.map(p => `"${p.key}"`).join(', ')} */],` : ''}
${needsThought ? `  "thought_process": [/* any of: ${THOUGHT_PROCESS.map(t => `"${t.key}"`).join(', ')} */]` : ''}
}`,
      }],
    })
    recordAnthropicUsage(msg, {
      userId: ctx.userId, tier: ctx.tier ?? null,
      feature: 'learn_profile_evolve', model: 'claude-haiku-4-5-20251001',
    })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0]) as Partial<LearnProfile>
  } catch {
    return null
  }
}

/** Merge AI suggestions into the current profile. Existing values
 *  ALWAYS win — we only fill empty slots. */
function mergeAdditive(current: LearnProfile, suggested: Partial<LearnProfile>): LearnProfile {
  const out: LearnProfile = {
    voice: { ...current.voice },
    style: { ...current.style },
    speech_patterns: [...current.speech_patterns],
    thought_process: [...current.thought_process],
  }
  if (suggested.voice) {
    for (const q of VOICE_QUESTIONS) {
      const v = suggested.voice[q.key]
      if (!out.voice[q.key] && typeof v === 'string' && v.trim()) {
        out.voice[q.key] = v.trim()
      }
    }
  }
  if (suggested.style) {
    for (const a of STYLE_AXES) {
      const v = suggested.style[a.key]
      if (!out.style[a.key] && (v === a.left || v === a.right)) {
        out.style[a.key] = v
      }
    }
  }
  if (Array.isArray(suggested.speech_patterns) && out.speech_patterns.length === 0) {
    const valid = new Set(SPEECH_PATTERNS.map(p => p.key))
    out.speech_patterns = suggested.speech_patterns
      .filter(s => typeof s === 'string' && valid.has(s as never))
  }
  if (Array.isArray(suggested.thought_process) && out.thought_process.length === 0) {
    const valid = new Set(THOUGHT_PROCESS.map(t => t.key))
    out.thought_process = suggested.thought_process
      .filter(s => typeof s === 'string' && valid.has(s as never))
  }
  return out
}
