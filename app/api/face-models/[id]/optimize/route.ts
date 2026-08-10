/**
 * POST /api/face-models/[id]/optimize
 *
 * Runs a light, identity-preserving retouch (CodeFormer) over the face's
 * uploaded selfies and saves the results as a second "optimized" set. The
 * creator can then toggle use_optimized to generate from the cleaned-up photos
 * instead of the raw uploads.
 *
 * Everything fails soft: any photo that can't be enhanced keeps its original.
 * If nothing succeeds we mark optimized_status='failed' and leave the raw set
 * untouched, so generation is never broken by this.
 */
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { fal } from '@fal-ai/client'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { enhanceFaceImage } from '@/lib/face-enhance'

const BUCKET = 'headshots'
// CodeFormer over ~20 photos, a few at a time — give generous headroom.
export const maxDuration = 300

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  if (process.env.FAL_KEY) fal.config({ credentials: process.env.FAL_KEY })

  // Confirm ownership + grab the source paths.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: model } = await supabase
    .from('face_models')
    .select('source_images,optimized_status')
    .eq('id', id).eq('user_id', ownerId).single()
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Only enhance a handful of photos: generation uses ONE face reference, so
  // there's no benefit to running the enhancer over all 14–20, and doing so
  // blew past the 5-minute function limit. A small set finishes fast.
  const MAX_TO_OPTIMIZE = 6
  const sourcePaths = ((model.source_images as string[]) || [])
    .filter(p => typeof p === 'string')
    .slice(0, MAX_TO_OPTIMIZE)
  if (sourcePaths.length === 0) {
    return NextResponse.json({ error: 'This face has no photos to optimize.' }, { status: 400 })
  }
  // Note: we intentionally DON'T hard-block when status==='processing'. A prior
  // run that timed out leaves the row stuck on 'processing' forever, so blocking
  // would lock the creator out. Re-running is safe (storage writes upsert).

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('face_models')
    .update({ optimized_status: 'processing', optimize_error: null, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', ownerId)

  // Enhance one source path → { path, error }. path is null on failure and
  // error carries WHY (so the UI can show the real reason, not a generic fail).
  const enhanceOne = async (path: string, idx: number): Promise<{ path: string | null; error: string | null }> => {
    try {
      // 1. Download the original from storage.
      const { data: file } = await admin.storage.from(BUCKET).download(path)
      if (!file) return { path: null, error: 'could not read the source photo' }
      const bytes = new Uint8Array(await file.arrayBuffer())
      // 2. Host it so CodeFormer can fetch it.
      const inputUrl = await fal.storage.upload(new Blob([bytes], { type: 'image/png' }))
      // 3. Enhance.
      const { url: enhancedUrl, error } = await enhanceFaceImage(inputUrl)
      if (!enhancedUrl) return { path: null, error: error || 'enhancer returned nothing' }
      // 4. Pull the result back.
      const enhancedBytes = await fetch(enhancedUrl, { signal: AbortSignal.timeout(30000) })
        .then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
      if (!enhancedBytes) return { path: null, error: 'could not download the enhanced photo' }
      // 5. Downscale + compress before storing. CodeFormer upscales, so the raw
      // result is often several MB — too big for the storage bucket's size cap.
      // A reference photo only needs ~1024px, so cap the long edge and JPEG it.
      const outBuf = await sharp(Buffer.from(enhancedBytes))
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer()
      const outPath = `${ownerId}/optimized/${id}/${idx}.jpg`
      const { error: upErr } = await admin.storage.from(BUCKET)
        .upload(outPath, outBuf, { contentType: 'image/jpeg', upsert: true })
      if (upErr) return { path: null, error: `storage: ${upErr.message}` }
      return { path: outPath, error: null }
    } catch (e) {
      return { path: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Two at a time — CodeFormer is rate-sensitive, and hammering it (especially
  // with a second face optimizing at the same time) is what caused most photos
  // to fail. Slower but reliable.
  const CONCURRENCY = 2
  const optimizedPaths: string[] = []
  let firstError: string | null = null
  try {
    for (let i = 0; i < sourcePaths.length; i += CONCURRENCY) {
      const batch = sourcePaths.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((p, j) => enhanceOne(p, i + j)))
      for (const r of results) {
        if (r.path) optimizedPaths.push(r.path)
        else if (!firstError && r.error) firstError = r.error
      }
    }
  } catch (e) { if (!firstError) firstError = e instanceof Error ? e.message : String(e) }

  if (optimizedPaths.length === 0) {
    const reason = firstError ? `Optimize failed: ${firstError}`.slice(0, 300) : 'Could not enhance any photos.'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('face_models')
      .update({ optimized_status: 'failed', optimize_error: reason, updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', ownerId)
    return NextResponse.json({ error: reason }, { status: 502 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('face_models')
    .update({
      optimized_images: optimizedPaths,
      optimized_status: 'ready',
      optimize_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('user_id', ownerId)

  return NextResponse.json({ ok: true, optimized_status: 'ready', count: optimizedPaths.length })
}
