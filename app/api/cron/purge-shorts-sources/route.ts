/**
 * GET /api/cron/purge-shorts-sources — retention sweep for Shorts Studio /
 * Clip Factory source video files.
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
  const cutoffMs = Date.now() - RETENTION_HOURS * 3600 * 1000
  const cutoff = new Date(cutoffMs).toISOString()

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
    // SECURITY: source_video_url is user-writable (RLS), and this runs as the
    // service role (RLS-bypassing). Only ever delete a file that lives under
    // this row's OWN user-id folder, so a user can't point their row at another
    // user's storage path and have the cron delete it for them.
    if (path && path.split('/')[0] === r.user_id) {
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

  // --- Storage sweep: Shop Burner uploads + orphaned trim clips ---------------
  // burner-* (upload-to-burn inputs) and clip-* (intermediate trims) aren't held
  // by a durable DB column, so we find them by listing and age them out. Exclude
  // any upload a still-pending batch job references (schedules run up to 30 days
  // out) so we never delete a file a queued job still needs. ingest-* is left to
  // the DB-driven purge above, which nulls the row pointer as it deletes.
  const excluded = new Set<string>()
  try {
    const { data: jobs } = await sb.from('ig_burn_jobs')
      .select('source_video_url').in('status', ['pending', 'processing']).limit(5000)
    for (const j of (jobs || [])) {
      const p = storagePathFromPublicUrl(j.source_video_url as string, BUCKET)
      if (p) excluded.add(p)
    }
  } catch { /* if we can't read the queue, skip the sweep to stay safe */ }

  let sweptFiles = 0
  try {
    const { data: folders } = await admin.storage.from(BUCKET).list('', { limit: 1000 })
    for (const folder of (folders || [])) {
      // Top-level entries with an id are stray files; the user-id folders we want
      // to descend into come back with id === null.
      if (folder.id) continue
      const { data: files } = await admin.storage.from(BUCKET).list(folder.name, { limit: 1000 })
      const stale = (files || []).filter((f) => {
        if (!f.id || !f.name) return false                        // skip sub-folders
        if (!/^(burner|clip|source)-/.test(f.name)) return false  // transient inputs + orphaned clip sources (never `short-` deliverables)
        const created = f.created_at ? new Date(f.created_at).getTime() : 0
        if (!created || created >= cutoffMs) return false  // still within window
        return !excluded.has(`${folder.name}/${f.name}`)
      }).map((f) => `${folder.name}/${f.name}`)
      if (stale.length) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(stale)
        if (!rmErr) sweptFiles += stale.length
      }
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, scanned: rows?.length || 0, storageDeleted, cloudinaryDeleted, cleared, sweptFiles })
}
