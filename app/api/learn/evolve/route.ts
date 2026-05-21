/**
 * POST /api/learn/evolve
 *
 * On-demand trigger for the LEARN-profile auto-evolution helper.
 * Useful for the "Refresh AI suggestions" button on the Learning
 * page — runs the same fire-and-forget evolution the publish path
 * runs, but as a foreground request so the UI can show success / no-op.
 *
 * Bypasses the 6-hour debounce because the user is explicitly asking.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
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

export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data: brand }, { data: intRow }, { count }] = await Promise.all([
    sb.from('brand_profiles').select('learn_profile,author_bio,target_audience').eq('user_id', user.id).single(),
    sb.from('integrations').select('tier').eq('user_id', user.id).single(),
    sb.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'published'),
  ])

  if ((count ?? 0) < 1) {
    return NextResponse.json({
      ok: true,
      evolved: false,
      reason: 'Publish at least 1 post first — the AI needs something to read.',
    })
  }

  const lp = normalizeLearnProfile(brand?.learn_profile)
  // Top-level narrative fields the Learning page also exposes. These are
  // separate columns from learn_profile — the evolve used to ignore them,
  // so "Target Reader" / "About You" never got filled. Now we infer them
  // too (additively — only when empty).
  const needBio = !((brand?.author_bio as string | null)?.trim())
  const needAudience = !((brand?.target_audience as string | null)?.trim())

  if (!hasEmptySlots(lp) && !needBio && !needAudience) {
    return NextResponse.json({
      ok: true,
      evolved: false,
      reason: 'Every field on your profile is already filled — nothing for the AI to add.',
    })
  }

  const { data: posts } = await sb
    .from('blog_posts')
    .select('title,content')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(5)

  const examples = (posts as Array<{ title: string; content: string }> | null)
    ?.map(p => `── "${p.title}" ──\n${stripMarkup(p.content).slice(0, 1500)}`)
    .join('\n\n') ?? ''

  const ctx = { userId: user.id, tier: (intRow?.tier as string) ?? null }

  // Run both inferences in parallel: the structured voice/style profile
  // and the narrative text fields.
  const [learnFilled, textFilled] = await Promise.all([
    hasEmptySlots(lp) ? fillGaps(lp, examples, ctx) : Promise.resolve(null),
    (needBio || needAudience) ? fillTextFields(examples, { author_bio: needBio, target_audience: needAudience }, ctx) : Promise.resolve({} as { author_bio?: string; target_audience?: string }),
  ])

  const merged = learnFilled ? mergeAdditive(lp, learnFilled) : lp
  let changed = countChanges(lp, merged)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {}
  if (changed > 0) update.learn_profile = merged
  if (needBio && textFilled.author_bio) { update.author_bio = textFilled.author_bio; changed++ }
  if (needAudience && textFilled.target_audience) { update.target_audience = textFilled.target_audience; changed++ }

  if (changed === 0) {
    return NextResponse.json({
      ok: true,
      evolved: false,
      reason: 'The AI couldn\'t infer anything new confidently from your posts yet. Try again after a few more publishes.',
    })
  }

  update.learn_profile_evolved_at = new Date().toISOString()
  await sb.from('brand_profiles').update(update).eq('user_id', user.id)

  return NextResponse.json({ ok: true, evolved: true, fieldsFilled: changed })
}

/** Infer the empty narrative text fields (About You / Target Reader) from
 *  the writer's published posts. Additive: only returns fields requested
 *  and confidently inferable. */
async function fillTextFields(
  examples: string,
  need: { author_bio: boolean; target_audience: boolean },
  ctx: { userId: string; tier: string | null },
): Promise<{ author_bio?: string; target_audience?: string }> {
  if (!need.author_bio && !need.target_audience) return {}
  const fields: string[] = []
  if (need.author_bio) fields.push('  "author_bio": "<2-4 sentences: who is writing — background, credibility, perspective — inferred from the posts, written in their voice>"')
  if (need.target_audience) fields.push('  "target_audience": "<2-3 sentences: who these posts are written for, what they care about, what they already know>"')
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: 'You infer a writer/brand\'s "About You" and "Target Reader" from their published posts. Return ONLY valid JSON. Omit a field you cannot infer confidently — never invent.',
      messages: [{
        role: 'user',
        content: `Read these recent posts by ONE writer/brand and infer the requested fields.

POSTS:
${examples}

Return JSON (omit any key you can't confidently infer):
{
${fields.join(',\n')}
}`,
      }],
    })
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier, feature: 'learn_textfield_evolve', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return {}
    const parsed = JSON.parse(match[0]) as { author_bio?: unknown; target_audience?: unknown }
    const out: { author_bio?: string; target_audience?: string } = {}
    if (need.author_bio && typeof parsed.author_bio === 'string' && parsed.author_bio.trim()) out.author_bio = parsed.author_bio.trim()
    if (need.target_audience && typeof parsed.target_audience === 'string' && parsed.target_audience.trim()) out.target_audience = parsed.target_audience.trim()
    return out
  } catch {
    return {}
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

async function fillGaps(
  current: LearnProfile,
  examples: string,
  ctx: { userId: string; tier: string | null },
): Promise<Partial<LearnProfile> | null> {
  const emptyVoice = VOICE_QUESTIONS.filter(q => !current.voice[q.key])
  const emptyStyle = STYLE_AXES.filter(a => !current.style[a.key])
  const needsSpeech = current.speech_patterns.length === 0
  const needsThought = current.thought_process.length === 0
  if (emptyVoice.length === 0 && emptyStyle.length === 0 && !needsSpeech && !needsThought) return null

  const voiceQuestions = emptyVoice
    .map(q => `  "${q.key}": "<your read in 1-2 sentences>"`).join(',\n')
  const styleAxes = emptyStyle
    .map(a => `  "${a.key}": "<'${a.left}' | '${a.right}' — pick the one their writing leans>"`).join(',\n')

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
- ONLY fill a field if you have STRONG evidence. Omit the key if uncertain.
- Voice answers in the WRITER's voice ("I find X annoying"). 1-2 sentences each.
- For style axes, pick whichever side their writing demonstrates. Skip if ambiguous.
- For speech_patterns / thought_process, return ONLY the keys with clear evidence.

POSTS:
${examples}

Return JSON (omit any key you can't confidently infer):
{
${voiceQuestions ? `  "voice": {\n${voiceQuestions}\n  },` : ''}
${styleAxes ? `  "style": {\n${styleAxes}\n  },` : ''}
${needsSpeech ? `  "speech_patterns": [/* any of: ${SPEECH_PATTERNS.map(p => `"${p.key}"`).join(', ')} */],` : ''}
${needsThought ? `  "thought_process": [/* any of: ${THOUGHT_PROCESS.map(t => `"${t.key}"`).join(', ')} */]` : ''}
}`,
      }],
    })
    recordAnthropicUsage(msg, {
      userId: ctx.userId, tier: ctx.tier,
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
      if (!out.voice[q.key] && typeof v === 'string' && v.trim()) out.voice[q.key] = v.trim()
    }
  }
  if (suggested.style) {
    for (const a of STYLE_AXES) {
      const v = suggested.style[a.key]
      if (!out.style[a.key] && (v === a.left || v === a.right)) out.style[a.key] = v
    }
  }
  if (Array.isArray(suggested.speech_patterns) && out.speech_patterns.length === 0) {
    const valid = new Set(SPEECH_PATTERNS.map(p => p.key))
    out.speech_patterns = suggested.speech_patterns.filter(s => typeof s === 'string' && valid.has(s as never))
  }
  if (Array.isArray(suggested.thought_process) && out.thought_process.length === 0) {
    const valid = new Set(THOUGHT_PROCESS.map(t => t.key))
    out.thought_process = suggested.thought_process.filter(s => typeof s === 'string' && valid.has(s as never))
  }
  return out
}

function countChanges(before: LearnProfile, after: LearnProfile): number {
  let n = 0
  for (const q of VOICE_QUESTIONS) if (!before.voice[q.key] && after.voice[q.key]) n++
  for (const a of STYLE_AXES) if (!before.style[a.key] && after.style[a.key]) n++
  if (before.speech_patterns.length === 0 && after.speech_patterns.length > 0) n++
  if (before.thought_process.length === 0 && after.thought_process.length > 0) n++
  return n
}
