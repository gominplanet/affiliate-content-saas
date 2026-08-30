// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One place that turns a creator's saved voice into a prompt block, so every
// surface (blogs, Articles, social posts, scripts, newsletters, captions) speaks
// in the same voice the same way. Combines, in priority order:
//   1. the continually-learned voice fingerprint (how they actually sound, from
//      their own videos + edits over time — lib/voice-fingerprint), and
//   2. the manual LEARN profile (their hand-tuned taste/style — lib/learn).
// Returns '' when the creator has neither, so prompts aren't padded with empties.

import { learnProfileToPrompt } from '@/lib/learn'
import { buildLearnedVoiceBlock } from '@/lib/voice-fingerprint'

/** The two fields this reads off a brand_profiles row. */
export interface CreatorVoiceFields {
  voice_fingerprint?: string | null
  learn_profile?: unknown
}

/** Combine fingerprint + LEARN profile into one prompt block. Pass the
 *  brand_profiles row (only these two fields are read). */
export function creatorVoiceBlock(brand: CreatorVoiceFields | null | undefined): string {
  if (!brand) return ''
  return [
    buildLearnedVoiceBlock(brand.voice_fingerprint),
    learnProfileToPrompt(brand.learn_profile),
  ]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** The columns to add to a brand_profiles select so `creatorVoiceBlock` has
 *  what it needs. Spread or append when building a select string. */
export const CREATOR_VOICE_COLUMNS = 'learn_profile,voice_fingerprint'
