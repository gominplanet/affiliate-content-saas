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

// LoRA training retired (2026-05-22): gpt-image-1/2 uses the uploaded photos
// directly as identity references at generation time — no training job, no
// Fal cost, no 10-minute wait. A "face model" is now just a saved set of
// reference photos, ready to use immediately.
export const maxDuration = 30

const MIN_IMAGES = 4
const MAX_IMAGES = 12

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
  const tier = (intRow?.tier as Tier) ?? 'trial'
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

  // No training step. gpt-image uses these photos directly as identity
  // references, so the model is ready the moment the photos are saved.
  // trigger_token is kept only for back-compat with old rows; it's unused.
  const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'face'
  const triggerToken = `${slug}${Math.random().toString(16).slice(2, 6)}`

  // ── Persist the face_models row (ready immediately) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: insertErr } = await (supabase as any)
    .from('face_models')
    .insert({
      user_id: user.id,
      name: trimmedName,
      trigger_token: triggerToken,
      status: 'ready',
      source_images: imagePaths,
    })
    .select()
    .single()
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, model: row })
}
