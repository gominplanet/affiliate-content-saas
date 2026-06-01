/**
 * GET/POST /api/learn
 *
 * The LEARN page is the single editing surface for the writer's voice.
 * It owns four free-text columns that used to live on Brand Profile
 * (writing_sample, author_bio, target_audience, words_to_avoid) plus
 * the structured `learn_profile` jsonb. The blog agents read all of it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeLearnProfile } from '@/lib/learn'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await supabase
      .from('brand_profiles')
      .select('writing_sample,author_bio,target_audience,words_to_avoid,learn_profile')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({
      writing_sample: row?.writing_sample ?? '',
      author_bio: row?.author_bio ?? '',
      target_audience: row?.target_audience ?? '',
      words_to_avoid: row?.words_to_avoid ?? '',
      learn_profile: normalizeLearnProfile(row?.learn_profile),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      writing_sample?: string
      author_bio?: string
      target_audience?: string
      words_to_avoid?: string
      learn_profile?: unknown
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : '')

    // The brand_profiles row is created at onboarding; mirror the
    // existing /api/profile convention and UPDATE (not upsert — avoids
    // tripping NOT NULL columns this endpoint doesn't own).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('brand_profiles')
      .update({
        writing_sample: str(body.writing_sample),
        author_bio: str(body.author_bio),
        target_audience: str(body.target_audience),
        words_to_avoid: str(body.words_to_avoid),
        learn_profile: normalizeLearnProfile(body.learn_profile) as never,
      })
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
