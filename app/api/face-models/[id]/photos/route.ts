/**
 * GET /api/face-models/[id]/photos
 *
 * Returns short-lived signed URLs for a face's original uploads and its
 * optimized (beautified) set, so the UI can show them side by side.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'

const BUCKET = 'headshots'
const TTL = 60 * 60 // 1h

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: model } = await supabase
    .from('face_models')
    .select('source_images,optimized_images')
    .eq('id', id).eq('user_id', ownerId).single()
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()
  const sign = async (paths: unknown): Promise<string[]> => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    if (list.length === 0) return []
    try {
      const { data } = await admin.storage.from(BUCKET).createSignedUrls(list, TTL)
      return (data || []).map(d => d.signedUrl).filter((u): u is string => !!u)
    } catch {
      return []
    }
  }

  const [original, optimized] = await Promise.all([
    sign(model.source_images),
    sign(model.optimized_images),
  ])
  return NextResponse.json({ original, optimized })
}
