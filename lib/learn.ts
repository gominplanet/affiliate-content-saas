// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Single source of truth for the LEARN voice-training profile.
 *
 * The LEARN page renders these definitions, the /api/learn route
 * validates against them, and `learnProfileToPrompt` turns a saved
 * profile into the instruction block the blog agents read on every
 * generation. Keep questions here so the set can evolve in one place.
 */

export const VOICE_QUESTIONS = [
  { key: 'sounds_fake', label: 'What sounds fake to you?' },
  { key: 'sounds_intelligent', label: 'What sounds intelligent to you?' },
  { key: 'sounds_weak', label: 'What sounds weak?' },
  { key: 'sounds_cringe', label: 'What sounds cringe?' },
  { key: 'sounds_trustworthy', label: 'What sounds trustworthy?' },
  { key: 'stops_reading', label: 'What makes you stop reading?' },
] as const

export const STYLE_AXES = [
  { key: 'blunt_diplomatic', left: 'blunt', right: 'diplomatic' },
  { key: 'concise_detailed', left: 'concise', right: 'detailed' },
  { key: 'emotional_analytical', left: 'emotional', right: 'analytical' },
  { key: 'casual_polished', left: 'casual', right: 'polished' },
  { key: 'optimistic_skeptical', left: 'optimistic', right: 'skeptical' },
  { key: 'teacher_storyteller', left: 'teacher', right: 'storyteller' },
  { key: 'fastpaced_reflective', left: 'fast-paced', right: 'reflective' },
] as const

export const SPEECH_PATTERNS = [
  { key: 'rhetorical_questions', label: 'Rhetorical questions' },
  { key: 'strong_contrast', label: 'Strong contrast statements' },
  { key: 'short_observations', label: 'Short impactful observations' },
  { key: 'conversational_pivots', label: 'Conversational pivots' },
  { key: 'real_world_framing', label: '"Real-world" framing' },
] as const

export const THOUGHT_PROCESS = [
  { key: 'start_with_story', label: 'Start with a story' },
  { key: 'start_with_conclusion', label: 'Start with the conclusion' },
  { key: 'start_with_question', label: 'Start with a question' },
  { key: 'compare_things', label: 'Compare things' },
  { key: 'use_analogies', label: 'Use analogies' },
  { key: 'challenge_assumptions', label: 'Challenge assumptions first' },
] as const

type VoiceKey = (typeof VOICE_QUESTIONS)[number]['key']
type StyleKey = (typeof STYLE_AXES)[number]['key']

export interface LearnProfile {
  voice: Partial<Record<VoiceKey, string>>
  /** Each axis: the chosen side's word, or null/absent when unset. */
  style: Partial<Record<StyleKey, string | null>>
  speech_patterns: string[]
  thought_process: string[]
}

export function emptyLearnProfile(): LearnProfile {
  return { voice: {}, style: {}, speech_patterns: [], thought_process: [] }
}

/** Defensive parse — never trust the jsonb blob's shape. */
export function normalizeLearnProfile(raw: unknown): LearnProfile {
  const lp = emptyLearnProfile()
  if (!raw || typeof raw !== 'object') return lp
  const r = raw as Record<string, unknown>

  if (r.voice && typeof r.voice === 'object') {
    for (const q of VOICE_QUESTIONS) {
      const v = (r.voice as Record<string, unknown>)[q.key]
      if (typeof v === 'string' && v.trim()) lp.voice[q.key] = v.trim()
    }
  }
  if (r.style && typeof r.style === 'object') {
    for (const a of STYLE_AXES) {
      const v = (r.style as Record<string, unknown>)[a.key]
      if (v === a.left) lp.style[a.key] = a.left
      else if (v === a.right) lp.style[a.key] = a.right
    }
  }
  const validPatterns = new Set(SPEECH_PATTERNS.map(p => p.key))
  if (Array.isArray(r.speech_patterns)) {
    lp.speech_patterns = r.speech_patterns.filter(
      (x): x is string => typeof x === 'string' && validPatterns.has(x as never),
    )
  }
  const validThought = new Set(THOUGHT_PROCESS.map(t => t.key))
  if (Array.isArray(r.thought_process)) {
    lp.thought_process = r.thought_process.filter(
      (x): x is string => typeof x === 'string' && validThought.has(x as never),
    )
  }
  return lp
}

/**
 * Render the profile into a prompt instruction block. Returns '' when
 * nothing has been filled in (so the prompt isn't padded with empties).
 */
export function learnProfileToPrompt(raw: unknown): string {
  const lp = normalizeLearnProfile(raw)
  const sections: string[] = []

  const voiceLines = VOICE_QUESTIONS
    .filter(q => lp.voice[q.key])
    .map(q => `- ${q.label} → ${lp.voice[q.key]}`)
  if (voiceLines.length) {
    sections.push(
      `THE WRITER'S TASTE — internalize this. Avoid everything in "fake/weak/cringe/stop reading"; lean into "intelligent/trustworthy":\n${voiceLines.join('\n')}`,
    )
  }

  const styleLines = STYLE_AXES
    .filter(a => lp.style[a.key])
    .map(a => `- ${lp.style[a.key]}`)
  if (styleLines.length) {
    sections.push(`COMMUNICATIVE STYLE — write this way:\n${styleLines.join('\n')}`)
  }

  if (lp.speech_patterns.length) {
    const labels = SPEECH_PATTERNS
      .filter(p => lp.speech_patterns.includes(p.key))
      .map(p => p.label)
    sections.push(`NATURAL SPEECH PATTERNS — use these devices: ${labels.join(', ')}.`)
  }

  if (lp.thought_process.length) {
    const labels = THOUGHT_PROCESS
      .filter(t => lp.thought_process.includes(t.key))
      .map(t => t.label.toLowerCase())
    sections.push(
      `THOUGHT PROCESS — structure reasoning like the writer does: ${labels.join('; ')}.`,
    )
  }

  if (!sections.length) return ''
  return `\n═══════════════════════════════════════\nWRITER VOICE PROFILE (LEARN) — HIGH PRIORITY\n═══════════════════════════════════════\n${sections.join('\n\n')}\n`
}
