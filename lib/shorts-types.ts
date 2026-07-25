// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Shared types for Shorts Studio (turn one long-form video into short vertical
 * clips). Kept in one place so the planner lib, the API routes, and the client
 * modal all agree on the shape — the generated Supabase types (lib/types/
 * database.ts) intentionally lag new tables (the codebase casts through `any`
 * for fresh migrations), so this is the hand-authored contract in the meantime.
 */

/** One timestamped line of a transcript, normalised to SECONDS on the source
 *  video's timeline. `end` is `start + duration`. */
export interface TranscriptCue {
  start: number
  end: number
  text: string
}

/** A caption chunk to burn on the clip, timed RELATIVE to the clip start
 *  (0 = the first frame of the clip), in seconds. */
export interface CaptionChunk {
  startSec: number
  endSec: number
  text: string
}

/** A clip Claude proposes from the transcript. Timestamps are on the SOURCE
 *  video timeline (seconds). */
export interface ClipSuggestion {
  startSec: number
  endSec: number
  /** Punchy on-clip title / the reason a scroller stops. */
  hook: string
  /** A ready-to-paste caption for the post (with an FTC-safe tone). */
  caption: string
  /** Why this moment works as a Short (for the creator to judge). */
  reason: string
  /** 0–100 self-scored virality/curiosity estimate. */
  score: number
  hashtags: string[]
  /** Clip-relative subtitle timeline (0 = clip start). Verbatim from the
   *  transcript — the no-fabrication guarantee. */
  subtitles: CaptionChunk[]
}

/** Subtitle looks the render supports. Kept small + burned server-side. */
export type SubtitleStyle = 'bold-white' | 'yellow-pop' | 'boxed'

export const SUBTITLE_STYLES: SubtitleStyle[] = ['bold-white', 'yellow-pop', 'boxed']

/** A persisted short (DB row → client), mirrors youtube_shorts. */
export interface ShortRow {
  id: string
  videoId: string
  youtubeVideoId: string | null
  startSec: number
  endSec: number
  hook: string
  caption: string
  reason: string
  score: number
  hashtags: string[]
  subtitles: CaptionChunk[]
  status: 'suggested' | 'rendered' | 'failed'
  renderedUrl: string | null
  subtitleStyle: SubtitleStyle
  renderError: string | null
  // Cross-post history: ISO timestamp of when this clip was published to each
  // platform, or null if it hasn't been. Drives the "posted" pill state.
  postedTiktok: string | null
  postedInstagram: string | null
  postedYoutube: string | null
}

export type ShortPlatform = 'tiktok' | 'instagram' | 'youtube'
