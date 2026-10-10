/**
 * POST /api/youtube/shorts/hooks  { shortId }
 *
 * HOOK OPTIONS FOR A CLIP'S TITLE CARD (Seb, 2026-10-10: "give users options..
 * maybe even give them options of hooks.. and let them write their own"). The
 * planner writes one hook per clip; this writes a few more from the words the
 * clip actually says, so the creator picks one, or writes their own instead.
 * Nothing is saved: the pick rides on the render request.
 *
 * Returns { hooks: string[] } (the clip's own hook first), or { error }.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { hasVideoTools } from '@/lib/amazon-plan'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubTitle } from '@/lib/scrub'
import { cleanHookOptions } from '@/lib/shorts-hooks'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!hasVideoTools(tier)) return NextResponse.json({ error: 'Clip hooks are part of the Amazon and Pro plans.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { shortId?: string }
    const shortId = String(body.shortId || '').trim()
    if (!shortId) return NextResponse.json({ error: 'Which clip? No clip id was sent.' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: short } = await sb.from('youtube_shorts').select('id,video_id,hook,caption,subtitles').eq('id', shortId).eq('user_id', user.id).maybeSingle()
    if (!short) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })
    const { data: video } = await sb.from('youtube_videos').select('title').eq('id', short.video_id).eq('user_id', user.id).maybeSingle()

    const said = (Array.isArray(short.subtitles) ? short.subtitles : [])
      .map((w: { text?: string }) => String(w?.text || '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500)
    if (!said) return NextResponse.json({ hooks: cleanHookOptions([short.hook]), note: 'This clip has no transcript saved, so MVP cannot write more hooks for it. Write your own instead.' })

    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: 'You write on-screen hook titles for short vertical videos. Return ONLY a JSON array of strings.',
      messages: [{
        role: 'user',
        content: `VIDEO: ${String(video?.title || '').slice(0, 150)}
WHAT THE CLIP SAYS: ${said}

Write 4 different hook titles for the first two seconds of this clip, each a different angle (a bold claim, a question, a number or result, a "you" statement).
- at most 8 words each
- only promise what the clip actually says
- no hashtags, no emojis, no dashes, no years, never the word "honest"
Return ONLY: ["...", "...", "...", "..."]`,
      }],
    })
    try { recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'shorts_hooks', model: MODEL }) } catch { /* telemetry best-effort */ }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    let more: string[] = []
    try { const m = text.match(/\[[\s\S]*\]/); if (m) more = JSON.parse(m[0]) } catch { more = [] }
    const hooks = cleanHookOptions([short.hook, ...more].map((h) => scrubTitle(String(h || ''))))
    if (hooks.length <= 1) return NextResponse.json({ hooks, note: 'MVP could not write more hooks just now. Pick this one or write your own.' })
    return NextResponse.json({ hooks })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not write hooks.' }, { status: 500 })
  }
}
