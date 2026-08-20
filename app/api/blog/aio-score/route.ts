/**
 * POST /api/blog/aio-score  { html, faqCount?, hasProductSchema?, hasAuthorAuthority?, hasFreshness? }
 *
 * Scores a post's AI-answer readiness (see lib/aio-score) — how likely an AI
 * engine (ChatGPT, Perplexity, Google AI Overviews) is to QUOTE it, not just how
 * it ranks on Google. Pure + cheap: no model call, no external fetch. Powers the
 * AIO readiness badge in the composer and Content Library. Signed-in only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { scoreAio, type AioInput } from '@/lib/aio-score'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<AioInput>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const html = typeof body.html === 'string' ? body.html : ''
  if (!html.trim()) return NextResponse.json({ error: 'Provide the post HTML to score.' }, { status: 400 })

  const result = scoreAio({
    html,
    faqCount: Number.isFinite(body.faqCount as number) ? (body.faqCount as number) : undefined,
    hasProductSchema: body.hasProductSchema,
    hasAuthorAuthority: body.hasAuthorAuthority,
    hasFreshness: body.hasFreshness,
  })
  return NextResponse.json({ ok: true, ...result })
}
