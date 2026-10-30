/**
 * /api/review-edit/title — the title as it will be on the video (Labs).
 *
 * GET ?text&look&color&size&position  the PNG lib/title-looks draws, the
 * same picture the video server lays over the video, so the page's preview
 * is what is made and never a guess at it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { cleanSettings } from '@/lib/review-edit'
import { drawTitle } from '@/lib/title-looks'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('review_edit', intg?.tier)) return NextResponse.json({ error: 'The review editor is still being tested.' }, { status: 403 })
  const q = new URL(request.url).searchParams
  // Cleaned the same way the saved settings are.
  const t = cleanSettings({ title: { text: q.get('text') || 'Your title here', look: q.get('look'), color: q.get('color'), size: q.get('size'), position: q.get('position') } }).title
  try {
    const { png, width, height } = await drawTitle(t.text || 'Your title here', { look: t.look, color: t.color, size: t.size, position: t.position })
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Width': String(width), 'X-Height': String(height) } })
  } catch (e) {
    return NextResponse.json({ error: `The title could not be drawn: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
  }
}
