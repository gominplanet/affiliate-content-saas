// GET/POST the signed-in user's account thumbnail headline style. The
// interactive toggles read this on mount and write it on change, so a creator's
// choice becomes their account default — which the automatic surfaces (blog
// hero, background Social Push pins) then honour server-side.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { data } = await supabase
      .from('integrations')
      .select('thumbnail_headline_style')
      .eq('user_id', user.id)
      .maybeSingle()
    const question = (data as { thumbnail_headline_style?: string } | null)?.thumbnail_headline_style === 'question'
    return NextResponse.json({ ok: true, question })
  } catch {
    // Pre-migration / read error — default polished, never error the toggle.
    return NextResponse.json({ ok: true, question: false })
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { question?: boolean }
  const value = body.question === true ? 'question' : 'statement'
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('integrations')
      .update({ thumbnail_headline_style: value })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, question: value === 'question' })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'save failed' }, { status: 500 })
  }
}
