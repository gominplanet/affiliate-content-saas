// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/reattach-thumbnails
//
// Self-serve heal: re-uploads the YouTube thumbnail (or the creator's custom
// blog hero) and sets it as the WP featured_media for any of the caller's
// published posts currently missing one. This is the recovery path for posts
// that published thumbnail-less because the host was rejecting media uploads
// (host WAF/security plugin on /wp/v2/media, or the connected WP user losing
// the upload_files capability). Once the host is unblocked, one call backfills
// the gap. The core lives in lib/reattach-thumbnails so the scheduled auto-heal
// cron shares the exact same logic.
//
// Idempotent + safe: skips posts that already have a featured image, sets
// featured_media ONLY (won't disturb scheduled posts), VA-aware.
//
// Body: { siteId?: string|null, limit?: number }  (limit default 40, max 60)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { reattachThumbnailsForOwner } from '@/lib/reattach-thumbnails'

export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  // VA/agency-aware: resources belong to ownerId; the caller may be a VA.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  let body: { siteId?: string | null; limit?: number } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const result = await reattachThumbnailsForOwner(supabase, ownerId, { siteId: body.siteId ?? null, limit: body.limit })
  if (!result.ok && result.error) {
    const status = result.error.includes('No WordPress') ? 400 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result)
}
