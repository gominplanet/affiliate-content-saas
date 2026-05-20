/**
 * Face Models API
 *
 * POST /api/face-models      — create + start training a new LoRA from
 *                              10-20 uploaded headshots (Pro+ only)
 * GET  /api/face-models      — list this user's face models
 *
 * Per-model endpoints live in ./[id]/route.ts (status poll + delete).
 *
 * Pipeline:
 *   1. Client uploads 10-20 images to Supabase storage
 *      under `headshots/face-training/{user_id}/{slug}/{idx}.{ext}`.
 *   2. Client POSTs here with the storage paths + a name.
 *   3. Server downloads each image, ZIPs them in-memory (Fal's
 *      LoRA training expects a single ZIP URL), uploads the ZIP back
 *      to Supabase storage, and kicks off `fal-ai/flux-lora-fast-training`.
 *   4. Server inserts a face_models row with status=training and the
 *      Fal request id. Client polls /api/face-models/[id].
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { TIERS, type Tier } from '@/lib/tier'
import { fal } from '@fal-ai/client'
import JSZip from 'jszip'
import { recordUsage } from '@/lib/ai-usage'

export const maxDuration = 60

const MIN_IMAGES = 10
const MAX_IMAGES = 20
const STORAGE_BUCKET = 'headshots'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('face_models')
    .select('id,name,trigger_token,status,lora_url,failure_reason,source_images,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ models: data || [] })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Pro/Admin gate ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'free'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: `Face training is a Pro feature. Upgrade to ${TIERS.pro.label} to train your face for thumbnails.`,
      limitReached: true,
      cap: 'face_training',
      currentTier: tier,
      upgrade: { tier: 'pro', label: TIERS.pro.label, limit: null },
    }, { status: 403 })
  }

  const { name, imagePaths } = await request.json() as {
    name?: string
    /** Supabase storage paths under the `headshots` bucket. Client
     *  uploads first, then sends the paths so this endpoint stays
     *  small and the upload UX is responsive. */
    imagePaths?: string[]
  }

  const trimmedName = (name || '').trim()
  if (!trimmedName) return NextResponse.json({ error: 'Name is required (e.g. "Me")' }, { status: 400 })
  if (!Array.isArray(imagePaths) || imagePaths.length < MIN_IMAGES) {
    return NextResponse.json({ error: `At least ${MIN_IMAGES} images required. You sent ${imagePaths?.length || 0}.` }, { status: 400 })
  }
  if (imagePaths.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Up to ${MAX_IMAGES} images. You sent ${imagePaths.length}.` }, { status: 400 })
  }

  // ── Generate a per-model trigger token ────────────────────────────────────
  // Format: short slug of the name + 4 hex chars for uniqueness. Avoids
  // collisions when the user trains multiple faces called "Me".
  const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'face'
  const triggerToken = `${slug}${Math.random().toString(16).slice(2, 6)}`

  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json({ error: 'Face training is temporarily unavailable (FAL_KEY missing).' }, { status: 500 })
  }
  fal.config({ credentials: falKey })

  // ── Build a ZIP of the uploaded images, upload it for Fal ─────────────────
  // Fal's flux-lora-fast-training endpoint expects `images_data_url`: a
  // single ZIP archive URL. We assemble it in-memory from the client-
  // uploaded paths, then upload the ZIP to Fal's blob storage so the
  // training job can fetch it.
  let zipBlob: Blob
  try {
    const zip = new JSZip()
    for (let i = 0; i < imagePaths.length; i++) {
      const path = imagePaths[i]
      const { data: file, error } = await supabase.storage.from(STORAGE_BUCKET).download(path)
      if (error || !file) throw new Error(`Couldn't download ${path}: ${error?.message || 'unknown'}`)
      const arrayBuf = await file.arrayBuffer()
      const ext = (path.split('.').pop() || 'jpg').toLowerCase()
      zip.file(`image_${String(i + 1).padStart(2, '0')}.${ext}`, arrayBuf)
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' })
    zipBlob = new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' })
  } catch (err) {
    return NextResponse.json({
      error: `Couldn't assemble training set: ${err instanceof Error ? err.message : 'unknown'}`,
    }, { status: 500 })
  }

  const falZipUrl = await fal.storage.upload(zipBlob)

  // ── Kick off the LoRA training job ────────────────────────────────────────
  // Fal queues this — typical run time 5-15 minutes. We don't wait
  // synchronously; we return immediately with the queue id and let the
  // client poll /api/face-models/[id] for status.
  let requestId: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queued = await (fal as any).queue.submit('fal-ai/flux-lora-fast-training', {
      input: {
        images_data_url: falZipUrl,
        trigger_word: triggerToken,
        // 1000 steps is Fal's recommended default for "fast" training.
        // Higher = better fidelity, but more cost + time. Sticking with
        // the default keeps cost predictable (~$1.50/run).
        steps: 1000,
        // is_style: false → identity training (faces), not style transfer.
        is_style: false,
        // create_masks: true → Fal auto-masks the face area so background
        // variation in the training set doesn't poison the model.
        create_masks: true,
      },
    })
    requestId = queued.request_id as string
  } catch (err) {
    return NextResponse.json({
      error: `Fal training failed to start: ${err instanceof Error ? err.message : 'unknown'}`,
    }, { status: 502 })
  }

  // Telemetry — training is a one-time fixed cost (~$1-2). Tag it so
  // /admin/costs reflects face-training spend separately from inference.
  recordUsage({
    userId: user.id, tier,
    feature: 'face_lora_training', model: 'fal-flux-lora-fast-training', images: 0,
  })

  // ── Persist the face_models row ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: insertErr } = await (supabase as any)
    .from('face_models')
    .insert({
      user_id: user.id,
      name: trimmedName,
      trigger_token: triggerToken,
      status: 'training',
      fal_request_id: requestId,
      source_images: imagePaths,
    })
    .select()
    .single()
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, model: row })
}
