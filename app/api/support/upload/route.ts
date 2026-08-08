/**
 * POST /api/support/upload — attach a screenshot to a support message.
 *
 * Multipart upload (PNG/JPEG/WebP/GIF, ≤ 5MB) → Supabase Storage bucket
 * `support-attachments`, namespaced per user, returns the public URL. The caller
 * then sends that URL as `imageUrl` when posting the ticket/reply. Open to every
 * signed-in user (support is available on all tiers).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const STORAGE_BUCKET = 'support-attachments'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}. Use PNG, JPEG, WebP, or GIF.` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.` }, { status: 400 })
  }

  const extFromMime: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  }
  const ext = extFromMime[file.type] ?? 'png'
  const path = `${user.id}/${Math.floor(Date.now() / 1000)}-${Math.round(Number(`0.${(file.size % 100000)}`) * 1e6)}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (uploadErr) {
    return NextResponse.json({
      error: `Upload failed: ${uploadErr.message}. The '${STORAGE_BUCKET}' bucket may not exist — create it as public-read in Supabase → Storage.`,
    }, { status: 500 })
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, url: data.publicUrl })
}
