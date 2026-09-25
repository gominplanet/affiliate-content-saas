// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which YouTube channel a Liftoff batch uploads to, checked with YouTube.
//
// WHY A CHECK AND NOT A SETTING. The uploader used whichever channel was
// marked default, and the name on that row is only what MVP wrote down when
// it was connected. A Google login can upload to a different channel than the
// row is named after (a Brand Account picks its channel at sign-in), so the
// only trustworthy answer to "where will these go" is to ask YouTube, with the
// very login the uploader will use, which channel it is. That is what this
// does, before launch and again before every upload.

import { getChannelOAuthToken, listYouTubeChannels } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export interface LiveChannel { id: string; title: string; thumbnail: string | null }

/** A connected channel the uploader could use, as MVP has it written down. */
export interface PushChannel { key: string; channelId: string; title: string; isDefault: boolean }

/** The channels this creator can upload to: the ones with a login saved. */
export async function pushChannels(sb: Sb, userId: string): Promise<PushChannel[]> {
  const list = await listYouTubeChannels(sb, userId)
  return list.filter((c) => c.hasOAuth).map((c) => ({
    key: c.id, channelId: c.channelId, title: c.channelTitle, isDefault: c.isDefault,
  }))
}

/**
 * Ask YouTube which channel the login for `channelId` really uploads to.
 *
 * `channelId` null means the default, which is what the uploader used before
 * a batch could name its own. Never throws: a failed check is returned as an
 * error, so the caller can refuse rather than guess.
 */
export async function liveUploadChannel(
  sb: Sb, userId: string, channelId: string | null,
): Promise<{ live: LiveChannel | null; error: string | null }> {
  try {
    const token = await getChannelOAuthToken(sb, userId, channelId)
    if (!token) return { live: null, error: 'No login is saved for that channel, so nothing can be uploaded to it. Connect it under Settings.' }
    const live = await new YouTubeOAuthService(token).getMyChannel()
    if (!live) return { live: null, error: 'That login has no YouTube channel.' }
    return { live, error: null }
  } catch (e) {
    return { live: null, error: `YouTube did not answer the check: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }
  }
}

/**
 * The sentence for a login that uploads somewhere other than it is named.
 * The one mistake this whole file exists to catch, so it names both channels.
 */
export function wrongChannelMessage(expectedTitle: string, liveTitle: string): string {
  return `The login saved for "${expectedTitle}" uploads to "${liveTitle}". Nothing was uploaded. Reconnect "${expectedTitle}" under Settings and choose that channel when Google asks.`
}

/**
 * The batch's confirmed channel, read on its own so a batch still loads before
 * migration 372 is run. `undefined` means the column does not exist yet.
 */
export async function batchChannelId(sb: Sb, batchId: string): Promise<string | null | undefined> {
  const { data, error } = await sb.from('launch_batches').select('youtube_channel_id').eq('id', batchId).maybeSingle()
  if (error) return undefined
  return String(data?.youtube_channel_id || '').trim() || null
}
