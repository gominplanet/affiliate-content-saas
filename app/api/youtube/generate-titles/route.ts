/**
 * POST /api/youtube/generate-titles
 *
 * Pre-generation title options for the thumbnail headline picker. The studio's
 * "Who writes the thumbnail headline?" modal calls this on open so the creator
 * picks the line BEFORE the thumbnail is composed (the AI then knows to leave
 * the right negative space). Distinct from the post-generation 5-title swap in
 * the generate-thumbnail route — those are intentionally generic for variety;
 * THESE are intentionally specific to the product / video.
 *
 * Input:  { videoTitle, videoDescription?, asin?, count? }
 * Output: { ok: true, titles: string[] }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateProductTitleOptions } from '@/lib/title-options'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    videoTitle?: string; videoDescription?: string; asin?: string; count?: number
  }
  const videoTitle = (body.videoTitle || '').trim()
  if (!videoTitle) return NextResponse.json({ error: 'videoTitle required' }, { status: 400 })

  // Read the user's tier so usage gets billed to the right bucket.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations')
    .select('tier').eq('user_id', user.id).single()
  const tier = (integ?.tier as string) ?? 'trial'

  const titles = await generateProductTitleOptions({
    videoTitle,
    videoDescription: body.videoDescription ?? null,
    asin: body.asin ?? null,
    count: body.count ?? 5,
    ctx: { userId: user.id, tier },
  })

  return NextResponse.json({ ok: true, titles })
}
