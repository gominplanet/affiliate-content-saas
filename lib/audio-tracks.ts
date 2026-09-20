// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which languages a YouTube video already carries, asked ONCE per video.
//
// WHY THIS EXISTS. Checking for an existing YouTube dub is a POST to the
// ingest service that runs yt-dlp, with a sixty second ceiling, and it was
// being made once per MARKET. Dubbing a video for Spain and Italy asked the
// same question about the same video twice, in parallel; five European markets
// asked it five times. It is also the flakiest dependency in the product,
// because it is the one that meets YouTube's bot wall and needs live cookies.
//
// And for most creators the answer is no. A channel that has never used
// YouTube's auto-dub pays that call, in full, before every single dub, to be
// told nothing each time.
//
// So the answer is remembered on the video. The catalogue drain asks once per
// video already, which means the background grid fills this cache for the
// Launchpad path for free.
//
// A WEEK, because a creator can add a track at any time and the cost of being
// a few days stale is one dub synthesized that could have been pulled. The
// cost of never re-asking would be a track that is there and never used.

import { listYouTubeAudioTracksDetailed } from '@/lib/youtube-ingest'

/** How long a remembered track list stands. */
export const AUDIO_CACHE_DAYS = 7

/** The columns this needs off a youtube_videos row. Select them or the cache
 *  silently never hits and every call goes back to yt-dlp. */
export const AUDIO_COLUMNS = 'id,youtube_video_id,audio_languages,audio_languages_at'

export interface VideoAudioRow {
  id: string
  youtube_video_id?: string | null
  audio_languages?: string[] | null
  audio_languages_at?: string | null
}

/**
 * The language codes this video carries, lowercased, or NULL when nobody could
 * find out.
 *
 * NULL IS NOT "NONE". An empty array means the video was read and carries only
 * its original audio; null means the lookup did not happen, and the two send a
 * caller in opposite directions. Collapsing them is how a service outage turns
 * into "this video has no French track", which is a finding about the video
 * rather than about us.
 */
export async function audioLanguagesFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  video: VideoAudioRow,
): Promise<string[] | null> {
  const at = video.audio_languages_at ? Date.parse(video.audio_languages_at) : 0
  if (Array.isArray(video.audio_languages) && Number.isFinite(at) && at > 0
      && Date.now() - at < AUDIO_CACHE_DAYS * 86_400_000) {
    return video.audio_languages.map((l) => String(l).toLowerCase())
  }

  const yt = (video.youtube_video_id || '').trim()
  // A video that is not on YouTube has no YouTube tracks, and that is an
  // answer, not a failure. Recorded as an empty list so it is never asked again.
  if (!yt) return []

  const { info } = await listYouTubeAudioTracksDetailed(yt)
  // NOBODY LOOKED. Not written, so the next caller tries again rather than
  // inheriting a verdict nobody reached.
  if (!info) return null

  const langs = (info.languages ?? []).map((l) => String(l).toLowerCase())
  try {
    await sb.from('youtube_videos')
      .update({ audio_languages: langs, audio_languages_at: new Date().toISOString() })
      .eq('id', video.id)
  } catch { /* the cache is best-effort; the answer below is still right */ }
  return langs
}

/** Does this list carry `lang`. Prefix match, so fr finds fr-FR and fr-CA. */
export function carriesLanguage(langs: string[] | null, lang: string): boolean {
  if (!langs || !lang) return false
  const want = lang.trim().toLowerCase()
  return langs.some((l) => l.startsWith(want))
}
