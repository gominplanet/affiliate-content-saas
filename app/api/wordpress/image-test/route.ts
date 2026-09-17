// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/wordpress/image-test
//
// Ask the creator's own site whether it will take a picture, and report what it
// actually did.
//
// A creator with 231 published posts asked where to start on a site where posts
// publish and pictures never appear, while a second site he built from scratch
// works. The honest answer at the time was that nobody could tell him, and
// nobody could tell the next person either: the only evidence was
// blog_posts.images_status, which he cannot see and which reads `failed` for
// every cause alike.
//
// So this does the smallest real version of the thing that keeps failing. It
// uploads a tiny picture, fetches it back from the open web, deletes it, and
// reports which of three different problems he has. The three need opposite
// fixes and, until now, looked identical.
//
// Deliberately NOT a health check that returns ok/not-ok. Every step's outcome
// is reported separately, because "refused", "stored but not servable" and
// "everything worked, so it is your theme" are the whole point.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { diagnoseImages, type ImageProbe } from '@/lib/wp-image-diagnosis'

export const dynamic = 'force-dynamic'

/**
 * A 1x1 PNG. Small on purpose: this must not trip an upload size limit, or the
 * test would report a size problem the creator's real images do not have.
 */
const PIXEL_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await request.json().catch(() => ({})) as { siteId?: string }

  const site = await getWordPressCredentials(supabase, ownerId, body.siteId)
  if (!site?.wordpress_url) {
    return NextResponse.json({
      ok: false,
      verdict: 'no-site',
      headline: 'No WordPress site is connected.',
      detail: 'Connect a site first, then this can ask it whether it accepts pictures.',
    })
  }

  const wp = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  const probe: ImageProbe = { uploaded: false }
  let mediaId: number | null = null

  // ── 1. will it take the file at all ──────────────────────────────────────
  try {
    const media = await wp.uploadImageFromBase64(PIXEL_B64, `mvp-image-test-${Date.now()}.png`, 'image/png')
    probe.uploaded = true
    probe.mediaUrl = media.source_url || media.link || null
    mediaId = media.id ?? null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    probe.uploadError = msg
    // The service folds the status into its message; pull it back out so the
    // diagnosis can distinguish a 403 from a 413 from a 500, which is the
    // difference between a permission, a host limit and a broken plugin.
    const m = msg.match(/\b(4\d\d|5\d\d)\b/)
    probe.uploadStatus = m ? Number(m[1]) : null
  }

  // ── 2. and will it hand the file back ────────────────────────────────────
  //
  // Skipped when nothing was stored. Asked from here rather than from the
  // browser on purpose: a fetch from the creator's own machine can succeed
  // against a cache or a local network that the open web cannot reach, which
  // would report a working site to somebody whose readers see nothing.
  if (probe.uploaded && probe.mediaUrl) {
    try {
      const res = await fetchWithTimeout(probe.mediaUrl, { method: 'GET', timeoutMs: 15_000 })
      probe.mediaStatus = res.status
      probe.mediaContentType = res.headers.get('content-type')
      probe.mediaFetched = res.ok && /^image\//i.test(probe.mediaContentType ?? '')
    } catch {
      probe.mediaFetched = false
    }
  }

  // ── 3. clean up after ourselves ──────────────────────────────────────────
  //
  // Best effort, and never allowed to change the verdict. A creator running a
  // diagnostic should not be left with test files in their media library, but a
  // failed delete is a tidiness problem and the answer above is what they came
  // for.
  let leftBehind = false
  if (mediaId) {
    try {
      await wp.deleteMedia(mediaId)
    } catch {
      leftBehind = true
    }
  }

  const diagnosis = diagnoseImages(probe)

  return NextResponse.json({
    ok: true,
    ...diagnosis,
    site: site.wordpress_url,
    // The raw steps, so a support conversation has something to read rather
    // than only the sentence we chose.
    steps: {
      upload: probe.uploaded
        ? { ok: true }
        : { ok: false, status: probe.uploadStatus ?? null, error: (probe.uploadError ?? '').slice(0, 400) },
      serve: probe.uploaded
        ? { ok: probe.mediaFetched ?? null, status: probe.mediaStatus ?? null, contentType: probe.mediaContentType ?? null, url: probe.mediaUrl ?? null }
        : null,
    },
    ...(leftBehind ? { note: 'A one pixel test image could not be removed from your media library. It is harmless and you can delete it yourself.' } : {}),
  })
}
