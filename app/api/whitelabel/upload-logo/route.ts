/**
 * POST /api/whitelabel/upload-logo
 *
 * Multipart upload for a Pro user's brand logo. Accepts PNG/JPEG/WebP/SVG
 * up to 2MB, stores in Supabase Storage under `whitelabel-logos/<user_id>/<timestamp>.<ext>`,
 * returns the public URL.
 *
 * Caller then PATCHes /api/whitelabel with that URL as `logoUrl`. We split
 * upload + persist into two steps so the user can preview before committing
 * (drop in, preview, "Save changes" patches the URL).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const STORAGE_BUCKET = 'whitelabel-logos'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — Pro/admin only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'White-label branding requires the Pro tier',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({
      error: `Unsupported file type: ${file.type}. Use PNG, JPEG, WebP, or SVG.`,
    }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 2MB.`,
    }, { status: 400 })
  }

  // Path: <user_id>/<timestamp>.<ext> — namespaced by user so RLS on the
  // bucket can enforce per-user access. Timestamp prefix lets the user
  // overwrite their logo without filename collisions.
  const extFromMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  }
  const ext = extFromMime[file.type] ?? 'png'
  const timestamp = Math.floor(Date.now() / 1000)
  const path = `${user.id}/${timestamp}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
      // Allow overwrites — the user often re-uploads while iterating.
      upsert: true,
    })

  if (uploadErr) {
    // The bucket might not exist on a fresh deploy. Surface a clear error
    // so the operator can create it (it's named whitelabel-logos, public-read).
    return NextResponse.json({
      error: `Storage upload failed: ${uploadErr.message}. The 'whitelabel-logos' bucket may not exist — create it as public-read in Supabase Dashboard → Storage.`,
    }, { status: 500 })
  }

  const { data: publicUrlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path)

  return NextResponse.json({
    ok: true,
    url: publicUrlData.publicUrl,
  })
}
