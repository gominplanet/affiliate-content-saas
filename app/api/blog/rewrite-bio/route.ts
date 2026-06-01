import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { notes } = await req.json()
  if (!notes?.trim()) return NextResponse.json({ error: 'Please write a few notes about yourself first.' }, { status: 400 })

  const { data: brand } = await supabase.from('brand_profiles').select('*').eq('user_id', user.id).single()
  const bp = brand as Record<string, unknown> | null

  const context = [
    bp?.name ? `Blog/brand name: ${bp.name}` : '',
    bp?.tagline ? `Tagline: ${bp.tagline}` : '',
    bp?.website_url ? `Website: ${bp.website_url}` : '',
    bp?.niches ? `Topics: ${(bp.niches as string[]).join(', ')}` : '',
    bp?.author_name ? `Author name: ${bp.author_name}` : '',
  ].filter(Boolean).join('\n')

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your .env.local file to use AI rewrite.' }, { status: 500 })
  }

  let bio: string
  try {
    const anthropic = createAnthropicClient()
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are writing a short, warm "About Me" bio for an affiliate review blog. Write in first person, conversational and genuine — not corporate. 2-3 short paragraphs max, no fluff.

Brand context:
${context}

What the blogger wrote about themselves:
${notes}

Write a polished "About Me" bio based on this. Keep it natural and personal. Do not use bullet points. Output only the bio text, nothing else.`,
      }],
    })
    bio = (message.content[0] as { type: string; text: string }).text.trim()
    // tier is fetched ad-hoc here — no integrations query in this route's
    // happy path, and a single extra select beats leaving the call un-tagged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
    recordAnthropicUsage(message, {
      userId: user.id, tier: intRow?.tier,
      feature: 'rewrite_bio', model: 'claude-sonnet-4-6',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Claude API error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ bio })
}
