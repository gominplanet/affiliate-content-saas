// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/social-launch-kit/generate  { platform: 'facebook' | 'pinterest' }
//
// Generates ready-to-paste profile copy — names, @handles, short + long bio,
// category, search keywords, a first post, and (Pinterest) starter boards —
// personalized from the user's Brand Profile and LEARN voice. Text only; the
// banner + avatar come from /api/social-launch-kit/image.

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@/lib/supabase/server'
import { spendGate } from '@/lib/ai-spend'
import { learnProfileToPrompt } from '@/lib/learn'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { LAUNCH_PLATFORMS, type LaunchPlatform, type SocialKit } from '@/lib/social-launch-kit'
import type { Tier } from '@/lib/tier'

export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { platform?: string }
  const platform = body.platform as LaunchPlatform
  const spec = platform ? LAUNCH_PLATFORMS[platform] : undefined
  if (!spec) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (intRow?.tier as Tier) ?? 'trial'
  // Labs — Pro-only until it graduates public (same gate as MVP x LTK).
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'The Social Launch Kit is a Pro Labs feature.' }, { status: 403 })
  }

  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any).from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
  if (!brand) {
    return NextResponse.json({ error: 'Set up your Brand Profile first (name + niche) so MVP can personalize the kit.' }, { status: 400 })
  }

  const b = brand as Record<string, unknown>
  const brandName = String(b.name || '').trim() || 'my brand'
  const niches = (Array.isArray(b.niches) ? b.niches : []).filter(Boolean).join(', ') || 'product reviews'
  const tagline = String(b.tagline || '').trim()
  const audience = String(b.target_audience || '').trim()
  const tone = (Array.isArray(b.tone) ? b.tone : []).filter(Boolean).join(', ')
  const website = String(b.website_url || '').trim()
  const learnBlock = learnProfileToPrompt(b.learn_profile)

  const boardsAsk = spec.boards
    ? `\n- "boards": exactly ${spec.boards} starter boards, each an object {"name","description"}. Board names are short and searchable; each description is 1-2 keyword-rich sentences (this is how Pinterest ranks them).`
    : ''

  const system = `You set up a creator's ${spec.label} profile so it looks professional and gets discovered. You write in THEIR voice, grounded in their real brand — never generic, never invented. ${BANNED_RULE}
Return ONLY a single JSON object. No prose, no markdown fences.`

  const userMsg = `BRAND
- Name: ${brandName}
- Niche(s): ${niches}
${tagline ? `- Tagline: ${tagline}\n` : ''}${audience ? `- Audience: ${audience}\n` : ''}${tone ? `- Tone: ${tone}\n` : ''}${website ? `- Website: ${website}\n` : ''}${learnBlock ? `\n${learnBlock}\n` : ''}
TASK — produce a ${spec.label} launch kit as a JSON object with these keys:
- "names": 3 profile/Page name ideas (each <= ${spec.nameMax} characters). The first is the safe, obvious choice.
- "handles": 3 username ideas (letters, numbers, dots or underscores only — no spaces — each <= 30 characters).
- "bioShort": a punchy one-line bio/tagline, <= ${spec.bioShortMax} characters.
- "bioLong": a fuller about/description, <= ${spec.bioLongMax} characters, saying who they help and what they post. 1-2 relevant emoji are fine.
- "category": the single best ${spec.label} category for this creator.
- "keywords": 6-10 search keywords/interests to add so ${spec.label} surfaces them.
- "firstPost": a warm, on-voice first post introducing the page (2-4 sentences).${boardsAsk}
Everything must be specific to THIS brand and niche.`

  let raw = ''
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      // Headroom so adaptive-thinking tokens + the Pinterest boards array can't
      // truncate the JSON mid-object (you only pay for tokens actually used).
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: userMsg }],
    })
    const msg = await stream.finalMessage()
    raw = msg.content.filter(c => c.type === 'text').map(c => (c as Anthropic.TextBlock).text).join('')
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'social-launch-kit', model: 'claude-opus-4-8' })
  } catch (e) {
    return NextResponse.json({ error: `Generation failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  // Parse the JSON object — slice from the first { to the last } as a fallback.
  let parsed: Record<string, unknown>
  try {
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
    parsed = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : raw)
  } catch {
    return NextResponse.json({ error: 'Could not read the generated kit — try again.' }, { status: 502 })
  }

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => scrubBanned(String(x))).filter(Boolean) : [])
  const str = (v: unknown): string => scrubBanned(String(v ?? '')).trim()
  const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n).trim() : v)

  const kit: SocialKit = {
    names: arr(parsed.names).slice(0, 3).map(n => clip(n, spec.nameMax)),
    // Handles are not prose — strip to a valid handle instead of scrubbing.
    handles: (Array.isArray(parsed.handles) ? parsed.handles : [])
      .map(h => String(h).replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30))
      .filter(Boolean)
      .slice(0, 3),
    bioShort: clip(str(parsed.bioShort), spec.bioShortMax),
    bioLong: clip(str(parsed.bioLong), spec.bioLongMax),
    category: str(parsed.category),
    keywords: arr(parsed.keywords).slice(0, 10),
    firstPost: str(parsed.firstPost),
  }
  if (spec.boards && Array.isArray(parsed.boards)) {
    kit.boards = (parsed.boards as unknown[])
      .map(x => (x ?? {}) as Record<string, unknown>)
      .map(x => ({ name: str(x.name), description: str(x.description) }))
      .filter(bd => bd.name)
      .slice(0, spec.boards)
  }

  return NextResponse.json({ ok: true, platform, kit })
}
