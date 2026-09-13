/**
 * POST /api/youtube/upload-video — publish a full (horizontal) video to the
 * creator's YouTube channel. This is the "MVP as origin" publish step: the
 * creator uploads a file into MVP, we burn the CTA, and this pushes the finished
 * cut straight to their channel. Same OAuth + scope rules as upload-short, minus
 * the #Shorts classification.
 *
 * Body: { videoUrl, title, description?, tags?, privacyStatus?, channelId? }
 * Returns: { ok, videoId, url } | { error, reconnectRequired?, notEnabled? }
 *
 * Pro-only. Gated on the youtube.upload scope (reconnectRequired) and the
 * feature flag (notEnabled) until Google verifies the scope.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { youtubeUploadEnabled } from '@/lib/feature-flags'
import { recordUsage } from '@/lib/ai-usage'
import { recordReachSample } from '@/lib/reach-pulse'
import { fetchWithTimeout, UPLOAD_TIMEOUT_MS } from '@/lib/fetch-timeout'

export const runtime = 'nodejs'
export const maxDuration = 300

// What this FUNCTION can survive, which is not the same as what the bucket
// accepts. Storage and the Launchpad uploader both take 500MB, and Amazon is
// happy with that, but publishing to YouTube holds the video in memory here and
// the function has a fixed allowance.
//
// Peak is now about 2x the file: one copy from arrayBuffer, plus whatever undici
// needs to send it. It was 4x, which is what OOM-killed the function and
// produced a 500 with an HTML body. 300MB leaves real headroom under the default
// allowance on top of the Node and Next baseline.
//
// Raising this means giving the function more memory, and the obvious way to do
// that (a `functions` block in vercel.json) failed the deployment twice, so it
// is not worth trading a working deploy for a file size almost nobody hits.
// Streaming the upload in resumable chunks would remove the ceiling properly.
const MAX_BYTES = 300 * 1024 * 1024

/** Say the actual size, not just the limit, and say what to do. "Video is over
 *  500MB" leaves the creator guessing whether they missed by a megabyte or by
 *  four hundred, and gives them nothing to act on. */
function sizeError(bytes: number): string {
  const mb = Math.round(bytes / (1024 * 1024))
  const cap = Math.round(MAX_BYTES / (1024 * 1024))
  return `This video is ${mb}MB and publishing to YouTube from here tops out at ${cap}MB. Export it at a lower bitrate and try again. Your Amazon storefronts are not affected and take the video as it is.`
}

export async function POST(request: Request) {
  try {
    return await handleUpload(request)
  } catch (e) {
    // Guarantee a JSON error on ANY uncaught crash so the client shows a real
    // reason instead of a bare "Publish failed" from a 500 HTML page.
    const msg = (e instanceof Error && e.message) ? e.message : 'Upload crashed.'
    console.error('[upload-video] uncaught:', msg)
    return NextResponse.json({ error: `Publish failed: ${msg}` }, { status: 500 })
  }
}

async function handleUpload(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoUrl?: string; title?: string; description?: string; tags?: string[]; privacyStatus?: 'public' | 'unlisted' | 'private'; channelId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })
  const title = (body.title || '').trim().slice(0, 100)
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Publishing to YouTube is a Pro feature.', tierRequired: 'pro' }, { status: 403 })
  }
  // Dark to the public until Google verifies the youtube.upload scope. Admins
  // pass so we can dogfood + record the verification demo.
  if (!youtubeUploadEnabled({ tier })) {
    return NextResponse.json({ error: "Publishing to YouTube isn't available yet — it's coming soon.", notEnabled: true }, { status: 403 })
  }

  const token = await getChannelOAuthToken(supabase, user.id, body.channelId ?? null)
  if (!token) {
    return NextResponse.json({ error: "YouTube isn't connected. Connect it first.", reconnectRequired: true }, { status: 412 })
  }

  // Pull the rendered video bytes (the CTA render lives on our storage).
  //
  // COUNT THE COPIES. This route used to hold the whole video in memory three
  // times over and the service made a fourth, which is what produced a 500 with
  // an HTML body: the platform OOM-killed the function, so the guaranteed-JSON
  // wrapper above never ran and the creator was shown a stripped Next.js error
  // page ("500: Internal Server Error body{color:#000...}") in a toast.
  //
  //   res.arrayBuffer()      one copy, unavoidable
  //   Buffer.from(ab)        no copy, it wraps
  //   new Uint8Array(buf)    A SECOND COPY, and pointless: a Node Buffer already
  //                          IS a Uint8Array
  //   videoBytes.buffer.slice(...) in uploadShort  a THIRD, removed there too
  //
  // Now one copy plus whatever undici needs to send it.
  let bytes: Uint8Array
  try {
    // A whole video off a CDN. The 30s default is an API-call ceiling and would
    // abort a legitimate large download, so this gets the upload budget.
    const res = await fetchWithTimeout(videoUrl, { timeoutMs: UPLOAD_TIMEOUT_MS })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    // Refuse on the header BEFORE pulling the body into memory. Downloading half
    // a gigabyte in order to discover it is half a gigabyte is how a size check
    // becomes the thing it is guarding against.
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > MAX_BYTES) return NextResponse.json({ error: sizeError(len) }, { status: 400 })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: sizeError(buf.byteLength) }, { status: 400 })
    bytes = buf
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the video: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const description = (body.description || '').trim().slice(0, 4900)
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t)).filter(Boolean).slice(0, 15) : []

  try {
    const yt = new YouTubeOAuthService(token)
    // uploadShort is a generic resumable video upload; the only "Short" part is
    // the caller's metadata, so it publishes a full horizontal video just as well.
    const { id, channelId } = await yt.uploadShort(bytes, { title, description, tags, privacyStatus: body.privacyStatus || 'public' })
    recordUsage({ userId: user.id, tier, feature: 'youtube_video_upload', model: 'youtube-data-api', images: 1 })
    void recordReachSample({
      userId: user.id, platform: 'youtube', mediaId: id,
      caption: description,
      hashtags: tags.map(t => (t.startsWith('#') ? t : `#${t}`)),
      productText: title,
    }).catch(() => {})
    // channelId lets the caller build a Studio link scoped to the owning channel.
    return NextResponse.json({ ok: true, videoId: id, channelId, url: `https://youtube.com/watch?v=${id}` })
  } catch (e) {
    // Never return an empty reason (a thrown Error with no message became a bare
    // "Publish failed" on the client). Fall back to a stringified error.
    const msg = (e instanceof Error && e.message) ? e.message
      : (typeof e === 'string' && e) ? e
      : (() => { try { return JSON.stringify(e) } catch { return '' } })() || 'YouTube upload failed.'
    const reconnectRequired = /403|insufficient|insufficientPermissions|scope/i.test(msg)
    return NextResponse.json({
      error: reconnectRequired ? 'Reconnect YouTube to grant upload permission, then try again.' : `YouTube upload failed: ${msg}`,
      reconnectRequired,
    }, { status: reconnectRequired ? 412 : 502 })
  }
}
