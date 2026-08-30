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
import { buildLearnedVoiceBlock, resolveVoiceFingerprint } from '@/lib/voice-fingerprint'

/** The fields this reads off a brand_profiles row. */
export interface CreatorVoiceFields {
  voice_fingerprint?: string | null
  learn_profile?: unknown
  /** Per-channel fingerprint map (migration 302). Optional. */
  channel_voice_fingerprints?: unknown
}

/** Combine the (per-channel or overall) fingerprint + LEARN profile into one
 *  prompt block. Pass the brand_profiles row; pass `channelId` when the content
 *  comes from a specific channel so its own voice is used when it has one. */
export function creatorVoiceBlock(
  brand: CreatorVoiceFields | null | undefined,
  channelId?: string | null,
): string {
  if (!brand) return ''
  return [
    buildLearnedVoiceBlock(resolveVoiceFingerprint(brand, channelId)),
    learnProfileToPrompt(brand.learn_profile),
  ]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** The columns to add to a brand_profiles select so `creatorVoiceBlock` has
 *  what it needs. Spread or append when building a select string. */
export const CREATOR_VOICE_COLUMNS = 'learn_profile,voice_fingerprint,channel_voice_fingerprints'
