// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Helper for: "find the user's starred Photobooth headshots for a given face,
// re-host them on fal, and return URLs the thumbnail composer can pass to
// Nano Banana as identity references."
//
// Why this exists: the raw `faces.source_images` are whatever the user
// uploaded when adding their face — sometimes uneven, sometimes weird
// lighting, sometimes from a phone selfie taken in their car. Photobooth
// outputs are CLEAN: neutral background, even studio lighting, the user's
// actual face captured well. So whenever Photobooth shots exist for a
// face, prefer those over the raw uploads for thumbnail identity refs.

import { createAdminClient } from '@/lib/supabase/admin'
import { rehostToFal } from '@/lib/thumbnail-generators'

const SHOTS_BUCKET = 'headshots'
const SIGNED_TTL = 60 * 60 // 1h is enough — the thumbnail composer consumes
                          // these URLs in the same request, no need for longer.
const shotsFolder = (userId: string) => `${userId}/photobooth`

/** Files in the Photobooth bucket are named:
 *    {faceModelId}__{style}__{expression}__{thumbOn|thumbOff}__{ts}-{rand}.png
 *  We need (a) faceModelId match (b) thumbOn flag set. */
function parseShotName(name: string): { faceId: string; style: string; expression: string; thumbOn: boolean } | null {
  const parts = name.replace(/\.png$/i, '').split('__')
  if (parts.length < 2) return null
  return {
    faceId: parts[0] || '',
    style: (parts[1] || 'studio').split('-')[0] || 'studio',
    expression: (parts.length >= 3 && parts[2]) ? parts[2] : 'neutral',
    thumbOn: parts.length >= 4 && parts[3] === 'on',
  }
}

/**
 * Return the user's STARRED Photobooth headshots for a specific face,
 * already re-hosted on fal so Nano Banana can consume the URLs directly.
 *
 * Empty array when:
 *   - The user has no Photobooth shots yet
 *   - No shots match the requested faceId
 *   - None of the matching shots are starred ("use on thumbnails" off)
 *
 * Caller falls back to the raw source_images in any of those cases.
 */
export async function getStarredPhotoboothRefs(
  userId: string,
  faceId: string,
  opts: { maxRefs?: number } = {},
): Promise<string[]> {
  const max = opts.maxRefs ?? 5
  const admin = createAdminClient()

  // List the folder. We use the admin client to bypass RLS — the caller
  // (thumbnail route) has already authed; this is just storage scoping by
  // userId baked into the folder path.
  const { data: files } = await admin.storage.from(SHOTS_BUCKET).list(shotsFolder(userId), {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  if (!files || files.length === 0) return []

  // Filter: this face's shots + starred + (newest-first preserved by list order).
  const matching = files
    .filter(f => f?.name && !f.name.startsWith('.'))
    .map(f => ({ file: f, parsed: parseShotName(String(f.name)) }))
    .filter(x => x.parsed && x.parsed.faceId === faceId && x.parsed.thumbOn)
    .slice(0, max)

  if (matching.length === 0) return []

  // Sign each path so it's publicly fetchable, then re-host on fal.
  const signedUrls: string[] = []
  for (const m of matching) {
    const path = `${shotsFolder(userId)}/${m.file.name}`
    const { data: signed } = await admin.storage.from(SHOTS_BUCKET).createSignedUrl(path, SIGNED_TTL)
    if (signed?.signedUrl) signedUrls.push(signed.signedUrl)
  }
  if (signedUrls.length === 0) return []

  // Re-host on fal so Nano Banana can fetch them at request time (Supabase
  // signed URLs work too, but fal.media is closer to the inference region).
  const rehosted = await Promise.all(signedUrls.map(u => rehostToFal(u)))
  return rehosted.filter((u): u is string => !!u)
}
