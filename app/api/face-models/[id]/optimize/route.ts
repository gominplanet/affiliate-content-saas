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

  // Enhance one source path → returns the NEW storage path, or null on failure.
  const enhanceOne = async (path: string, idx: number): Promise<string | null> => {
    try {
      // 1. Download the original from storage.
      const { data: file } = await admin.storage.from(BUCKET).download(path)
      if (!file) return null
      const bytes = new Uint8Array(await file.arrayBuffer())
      // 2. Host it so CodeFormer can fetch it.
      const inputUrl = await fal.storage.upload(new Blob([bytes], { type: 'image/png' }))
      // 3. Enhance.
      const enhancedUrl = await enhanceFaceImage(inputUrl)
      if (!enhancedUrl) return null
      // 4. Pull the result back and save it under an /optimized path.
      const enhancedBytes = await fetch(enhancedUrl, { signal: AbortSignal.timeout(30000) })
        .then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
      if (!enhancedBytes) return null
      const outPath = `${ownerId}/optimized/${id}/${idx}.png`
      const { error: upErr } = await admin.storage.from(BUCKET)
        .upload(outPath, Buffer.from(enhancedBytes), { contentType: 'image/png', upsert: true })
      if (upErr) return null
      return outPath
    } catch {
      return null
    }
  }

  // Process a few at a time so we don't hammer fal or blow the time budget.
  const CONCURRENCY = 4
  const optimizedPaths: string[] = []
  try {
    for (let i = 0; i < sourcePaths.length; i += CONCURRENCY) {
      const batch = sourcePaths.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((p, j) => enhanceOne(p, i + j)))
      for (const r of results) if (r) optimizedPaths.push(r)
    }
  } catch { /* fall through to the status update below */ }

  if (optimizedPaths.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('face_models')
      .update({ optimized_status: 'failed', optimize_error: 'Could not enhance any photos.', updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', ownerId)
    return NextResponse.json({ error: 'Could not optimize the photos. Your originals are untouched.' }, { status: 502 })
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
