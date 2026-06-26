// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/brand-recap/polish — optional "Polish with AI" for the
// Share-with-brand message. Rewrites the creator's draft in the chosen tone
// while preserving every link EXACTLY (URLs must survive verbatim) and the
// brand/product names. Cheap (Haiku), best-effort: on any failure the caller
// keeps the original draft.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { recordUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TONE_HINT: Record<string, string> = {
  warm: 'warm, friendly, genuine — like a creator who actually liked the product',
  professional: 'polished and professional, concise, business-appropriate',
  casual: 'relaxed and casual, conversational, a little playful',
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { message, tone } = await request.json() as { message?: string; tone?: string }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Nothing to polish' }, { status: 400 })
    }

    // Pull out every URL so we can verify the model kept them all intact.
    const urls = message.match(/https?:\/\/[^\s)]+/g) ?? []
    const toneHint = TONE_HINT[tone || 'warm'] || TONE_HINT.warm

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Rewrite this short outreach note a content creator is sending to a brand whose product they just reviewed. Make it ${toneHint}.

HARD RULES:
- Keep EVERY link/URL exactly as-is, on their own lines, unchanged. Do not drop, shorten, or reword any URL.
- Keep the brand name and product name as written.
- Keep it brief (it's a quick note, not a pitch). No subject line, no markdown, no emojis.
- Keep the sign-off (name + site) at the end.
- Output ONLY the rewritten note, nothing else.

NOTE TO REWRITE:
"""
${message.slice(0, 4000)}
"""`,
      }],
    })

    let out = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    out = scrubBanned(out)

    // Safety: if the model dropped any link, fall back to the original draft so
    // the user never loses a URL to a "polish".
    const keptAll = urls.every(u => out.includes(u))
    if (!keptAll || !out) {
      return NextResponse.json({ message, polished: false })
    }

    try {
      const u = resp.usage
      recordUsage({ userId: user.id, feature: 'brand_recap_polish', model: 'claude-haiku-4-5-20251001', input: u.input_tokens, output: u.output_tokens })
    } catch { /* telemetry best-effort */ }

    return NextResponse.json({ message: out, polished: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[brand-recap/polish]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
