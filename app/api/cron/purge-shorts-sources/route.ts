/**
 * GET /api/cron/purge-shorts-sources — retention sweep for Shorts Studio /
 * Vertical Powerhouse source video files.
 *
 * We never keep the raw source once a creator has cut their clips from it: this
 * deletes fetched/uploaded long-form sources older than a short window from both
 * Supabase Storage and Cloudinary, and clears the DB pointers. Finished rendered
 * Shorts are the deliverable and are NOT touched. Intermediate trim clips are
 * already deleted the moment a Short renders (see shorts/render).
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteVideoAsset } from '@/services/cloudinary'
import { storagePathFromPublicUrl } from '@/lib/storage-url'

export const runtime = 'nodejs'
export const maxDuration = 300

// Keep a fetched/uploaded source around this long so a creator can render
// several clips in one sitting, then purge it.
const RETENTION_HOURS = 24
const BUCKET = 'instagram-videos'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600 * 1000).toISOString()

  // Sources past the retention window. Uploaded rows may lack an uploaded_at
  // timestamp, so also sweep any source whose row hasn't changed since cutoff.
  const { data: rows, error } = await sb.from('youtube_videos')
    .select('id,user_id,source_video_url,cloudinary_source_id,source_video_uploaded_at,updated_at')
    .not('source_video_url', 'is', null)
    .or(`source_video_uploaded_at.lt.${cutoff},and(source_video_uploaded_at.is.null,updated_at.lt.${cutoff})`)
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let storageDeleted = 0, cloudinaryDeleted = 0, cleared = 0
  for (const r of (rows || [])) {
    const path = storagePathFromPublicUrl(r.source_video_url as string, BUCKET)
    if (path) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([path])
      if (!rmErr) storageDeleted++
    }
    if (r.cloudinary_source_id) {
      await deleteVideoAsset(r.cloudinary_source_id as string)
      cloudinaryDeleted++
    }
    const { error: upErr } = await sb.from('youtube_videos')
      .update({ source_video_url: null, source_video_uploaded_at: null, cloudinary_source_id: null })
      .eq('id', r.id)
    if (!upErr) cleared++
  }

  return NextResponse.json({ ok: true, scanned: rows?.length || 0, storageDeleted, cloudinaryDeleted, cleared })
}
